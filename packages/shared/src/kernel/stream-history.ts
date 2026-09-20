// Stream Event Protocol v1 — 运行期内存事件历史（reconnect/重连补发）。
//
// 依据维护者 #43 review 与 ADR 0001：reconnect 需要一个明确的 replay
// source + “无法恢复”的失败路径。v1 采用 run 级内存缓冲：
// - append 时按 run 累积（每 run 上限 MAX_EVENTS_PER_RUN，超出截断最旧）；
// - replay(runId, lastSequence) 只补发“连续且已存在”的段；
// - 截断/未知 run/段不连续 → recoverable=false，调用方应呈现明确失败。
//
// issue #75 review：磁盘恢复（restore）与实时追加（append）必须是两条路径。
// 恢复只装入内存、绝不回写日志，否则每次启动都会把刚读出的历史再写一遍
// （[1,2] → [1,2,1,2] → …），第二次重启起 replay 连续性检查即失败。

import type { StreamEvent } from '@finagent/core';
import type { StreamEventLog } from './stream-event-log.ts';

/** 保留的最大 run 数（最久未活跃的 run 被淘汰）。 */
const MAX_RUNS = 32;
/** 单 run 内存缓冲的事件上限（截断后无法从头恢复 → 明确不可恢复）。 */
const MAX_EVENTS_PER_RUN = 2000;

export interface StreamEventHistoryOptions {
  /** 磁盘恢复的事件（issue #75：跨重启补齐历史）。只装入内存，不落盘。 */
  persisted?: Iterable<StreamEvent>;
  /** 挂载的持久化日志：append 时与内存并行落盘。 */
  log?: StreamEventLog;
}

export interface StreamReplayResult {
  /** true：补发成功；false：内存中已无连续段/未知 run，明确不可恢复。 */
  recoverable: boolean;
  /** 连续补发的事件（lastSequence 之后）。不可恢复时为 []。 */
  events: StreamEvent[];
  /** 该 run 是否已结束（最后事件为终端事件：run_completed / cancelled / error）。 */
  atEnd: boolean;
}

const TERMINAL_TYPES = new Set<StreamEvent['type']>(['run_completed', 'cancelled', 'error']);

export class StreamEventHistory {
  private readonly runs = new Map<string, StreamEvent[]>();
  /** LRU 顺序（队尾 = 最近活跃），用于淘汰最久未更新的 run。 */
  private readonly order: string[] = [];
  private readonly log?: StreamEventLog;

  constructor(options: StreamEventHistoryOptions = {}) {
    this.log = options.log;
    // 恢复路径：只装入内存，不触发任何磁盘写入（见文件头说明）。
    for (const event of options.persisted ?? []) {
      this.restore(event);
    }
  }

  /** 装入一条已持久化的历史事件；不落盘（启动恢复专用）。 */
  restore(event: StreamEvent): void {
    this.push(event);
  }

  /**
   * 追加一条实时事件：先入内存，成功后再落盘（内存是事实来源，磁盘跟随）。
   * @returns true 表示已接受；false 表示被幂等去重拒绝（同 run 非递增 seq）。
   */
  append(event: StreamEvent): boolean {
    if (!this.push(event)) return false;
    // 与内存缓冲并行持久化；磁盘失败由 log 自吞（降级内存-only）。
    this.log?.append(event);
    return true;
  }

  /**
   * 写入内存缓冲。同一 run 内只接受严格递增的 sequence：重复/倒退的
   * seq（例如旧版本恢复时写回的重复行）被幂等拒绝，避免 replay 的
   * 连续性检查被重复记录破坏。
   */
  private push(event: StreamEvent): boolean {
    const list = this.runs.get(event.runId);
    if (list) {
      const last = list[list.length - 1];
      if (event.sequence <= last.sequence) return false;
      list.push(event);
      // 已有 run 再次成功追加 → 刷新到 LRU 队尾（issue #146）：否则淘汰
      // 实际按首次出现顺序 FIFO，最近仍活跃的 run 会先于陈旧 run 被淘汰。
      const orderIndex = this.order.indexOf(event.runId);
      if (orderIndex >= 0) this.order.splice(orderIndex, 1);
      this.order.push(event.runId);
      if (list.length > MAX_EVENTS_PER_RUN) {
        list.splice(0, list.length - MAX_EVENTS_PER_RUN);
      }
      return true;
    }
    this.runs.set(event.runId, [event]);
    this.order.push(event.runId);
    while (this.order.length > MAX_RUNS) {
      const evicted = this.order.shift();
      if (evicted) this.runs.delete(evicted);
    }
    return true;
  }

  /** 从 lastSequence 之后的位置补发；段缺失/未知 run 判为不可恢复。 */
  replay(runId: string, lastSequence: number): StreamReplayResult {
    const list = this.runs.get(runId);
    if (!list || list.length === 0) {
      return { recoverable: false, events: [], atEnd: true };
    }

    const last = list[list.length - 1];
    // 游标超前（lastSequence 超过已知最大 sequence）：客户端状态与历史
    // 分歧，不可能由正常事件流到达 —— 明确不可恢复，不能静默当作已同步。
    if (lastSequence > last.sequence) {
      return { recoverable: false, events: [], atEnd: TERMINAL_TYPES.has(last.type) };
    }

    const tail = list.filter((e) => e.sequence > lastSequence);
    const contiguous =
      tail.length === 0 ||
      (tail[0].sequence === lastSequence + 1 &&
        tail.every((e, i) => i === 0 || e.sequence === tail[i - 1].sequence + 1));
    if (!contiguous) {
      return { recoverable: false, events: [], atEnd: false };
    }

    return {
      recoverable: true,
      events: tail,
      atEnd: TERMINAL_TYPES.has(last.type),
    };
  }
}