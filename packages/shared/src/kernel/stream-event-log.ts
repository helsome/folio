// Stream Event Protocol v1 — 持久化事件日志（issue #75）。
//
// ADR 0001 open question #1：v1 的 replay 数据源是纯内存 StreamEventHistory，
// 进程重启后即丢。本模块补上磁盘层：
// - append 同步追加 JSONL（一行一条 StreamEvent，与内存缓冲并行落盘）；
// - load 恢复最近 maxRuns 个 run，使 replayStream 跨重启可用；
// - 坏行跳过、重复/倒退的 (runId, sequence) 幂等丢弃（损坏容忍，启动不崩）；
// - 超限 run 在 load 时收缩重写，磁盘占用有界；
// - 任何磁盘读/写失败一律降级为内存-only：绝不阻塞实时事件链路。

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { StreamEvent } from '@finagent/core';

/** 日志保留的最大 run 数（load 时收缩，防止磁盘无界增长）。 */
export const DEFAULT_MAX_LOG_RUNS = 64;

export interface StreamEventLogLoadResult {
  /** 从磁盘恢复的事件（按写入顺序，受 maxRuns 限制）。 */
  events: StreamEvent[];
  /** 解析失败被跳过的坏行数。 */
  skipped: number;
  /** 因 (runId, sequence) 重复/倒退被丢弃的条目数（幂等去重）。 */
  duplicates: number;
}

export class StreamEventLog {
  private readonly file: string;
  private readonly maxRuns: number;
  /** 写失败累计次数（>0 = 已降级为内存-only，供诊断）。 */
  private writeFailures = 0;

  constructor(logDir: string, options: { maxRuns?: number } = {}) {
    this.maxRuns = options.maxRuns ?? DEFAULT_MAX_LOG_RUNS;
    this.file = join(logDir, 'stream-events.jsonl');
  }

  /** 追加一条事件；写失败计入 writeFailures 并继续（不抛出、不阻塞）。 */
  append(event: StreamEvent): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify(event)}\n`, 'utf8');
    } catch {
      this.writeFailures += 1;
    }
  }

  /**
   * 读取并解析日志：坏行跳过；同 run 重复/倒退的 seq 只保留第一条；
   * 仅返回最近 maxRuns 个 run，超限时收缩文件。
   */
  load(): StreamEventLogLoadResult {
    if (!existsSync(this.file)) return { events: [], skipped: 0, duplicates: 0 };
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return { events: [], skipped: 0, duplicates: 0 };
    }

    const events: StreamEvent[] = [];
    let skipped = 0;
    let duplicates = 0;
    const runOrder: string[] = [];
    const seen = new Set<string>();
    // 每个 run 已接受的最大 sequence：磁盘里的重复行（历史缺陷或并发写回）
    // 在此被幂等丢弃，避免恢复出的重复 seq 破坏 replay 的连续性检查。
    const lastSeqByRun = new Map<string, number>();
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (
          typeof parsed.runId !== 'string' ||
          typeof parsed.sequence !== 'number' ||
          typeof parsed.type !== 'string' ||
          typeof parsed.protocolVersion !== 'number'
        ) {
          skipped += 1;
          continue;
        }
        const event = parsed as unknown as StreamEvent;
        const lastSeq = lastSeqByRun.get(event.runId);
        if (lastSeq !== undefined && event.sequence <= lastSeq) {
          duplicates += 1;
          continue;
        }
        lastSeqByRun.set(event.runId, event.sequence);
        events.push(event);
        if (!seen.has(event.runId)) {
          seen.add(event.runId);
          runOrder.push(event.runId);
        }
      } catch {
        skipped += 1;
      }
    }

    // 收缩：只保留最近 maxRuns 个 run（按首次出现顺序），并重写文件控制磁盘。
    // 注意：这是 load 唯一的写路径，且只裁剪超限 run；恢复历史本身绝不回写
    // （issue #75 review），因此连续重启不会让文件增长。
    if (runOrder.length > this.maxRuns) {
      const keep = new Set(runOrder.slice(-this.maxRuns));
      const kept = events.filter((e) => keep.has(e.runId));
      try {
        writeFileSync(this.file, kept.map((e) => `${JSON.stringify(e)}\n`).join(''), 'utf8');
      } catch {
        // 收缩失败不影响已解析结果；下次 load 会再尝试。
      }
      return { events: kept, skipped, duplicates };
    }
    return { events, skipped, duplicates };
  }

  /** 累积的写失败次数（>0 = 持久化不可用但实时链路照常）。 */
  failures(): number {
    return this.writeFailures;
  }
}