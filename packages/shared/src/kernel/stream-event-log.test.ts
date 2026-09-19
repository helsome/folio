// Stream Event Protocol v1 — 持久化事件日志单测（issue #75）。

import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { StreamEvent } from '@finagent/core';
import { StreamEventHistory } from './stream-history.ts';
import { StreamEventLog } from './stream-event-log.ts';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-log-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function make(runId: string, sequence: number, type: StreamEvent['type'] = 'text_delta'): StreamEvent {
  return {
    protocolVersion: 1,
    runId,
    sequence,
    type,
    timestamp: '2026-09-11T00:00:00.000Z',
    payload: {} as never,
  };
}

describe('StreamEventLog', () => {
  it('append → load 往返：事件按写入顺序无损恢复', () => {
    const log = new StreamEventLog(dir);
    log.append(make('run-1', 1));
    log.append(make('run-1', 2));
    log.append(make('run-2', 1, 'run_started'));

    const result = log.load();
    expect(result.skipped).toBe(0);
    expect(result.events.map((e) => [e.runId, e.sequence])).toEqual([
      ['run-1', 1],
      ['run-1', 2],
      ['run-2', 1],
    ]);
  });

  it('load 不存在的目录 → 空结果且不抛错', () => {
    const log = new StreamEventLog(join(dir, 'does-not-exist'));
    const result = log.load();
    expect(result.events).toEqual([]);
    expect(result.skipped).toBe(0);
  });

  it('坏行被跳过（损坏容忍），其余行正常恢复', () => {
    const log = new StreamEventLog(dir);
    log.append(make('run-1', 1));
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    // 追加一条损坏行与一条字段缺失行。
    writeFileSync(join(dir, 'stream-events.jsonl'), `not-json\n${JSON.stringify({ runId: 'x' })}\n`, {
      flag: 'a',
    });
    log.append(make('run-1', 2));

    const result = log.load();
    expect(result.skipped).toBe(2);
    expect(result.events.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('超过 maxRuns 时收缩：仅保留最近 maxRuns 个 run', () => {
    const log = new StreamEventLog(dir, { maxRuns: 2 });
    for (let i = 1; i <= 4; i += 1) {
      log.append(make(`run-${i}`, 1));
      log.append(make(`run-${i}`, 2));
    }

    const result = log.load();
    expect(result.events.map((e) => e.runId)).toEqual(['run-3', 'run-3', 'run-4', 'run-4']);
    // 收缩已重写文件：再次 load 结果一致（磁盘有界）。
    const again = log.load();
    expect(again.events).toEqual(result.events);
  });

  it('连续 3 次重启：只恢复不写回，文件行数不增长且 replay 保持连续', () => {
    const log = new StreamEventLog(dir);
    log.append(make('run-1', 1, 'run_started'));
    log.append(make('run-1', 2));
    log.append(make('run-1', 3, 'run_completed'));
    const file = join(dir, 'stream-events.jsonl');
    const lineCount = () =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '').length;
    expect(lineCount()).toBe(3);

    // 模拟连续 3 次进程重启：每次只新建 log + history（不发任何新事件）。
    for (let restart = 1; restart <= 3; restart += 1) {
      const nextLog = new StreamEventLog(dir);
      const loaded = nextLog.load();
      expect(loaded.duplicates).toBe(0);
      expect(loaded.events.length).toBe(3);
      const history = new StreamEventHistory({ log: nextLog, persisted: loaded.events });

      const full = history.replay('run-1', 0);
      expect(full.recoverable).toBe(true);
      expect(full.events.map((e) => e.sequence)).toEqual([1, 2, 3]);
      expect(full.atEnd).toBe(true);
      // 中间游标（断在 1）同样保持连续。
      const tail = history.replay('run-1', 1);
      expect(tail.recoverable).toBe(true);
      expect(tail.events.map((e) => e.sequence)).toEqual([2, 3]);
      expect(tail.atEnd).toBe(true);

      expect(lineCount()).toBe(3);
    }
  });

  it('已有重复 seq 夹具：load 幂等丢弃重复行，replay 不受污染', () => {
    const file = join(dir, 'stream-events.jsonl');
    // 直接写一个被历史缺陷污染的文件：[1,2] 被写回成 [1,2,1,2]。
    writeFileSync(
      file,
      [make('run-1', 1, 'run_started'), make('run-1', 2), make('run-1', 1, 'run_started'), make('run-1', 2)]
        .map((e) => `${JSON.stringify(e)}\n`)
        .join(''),
      'utf8'
    );

    const log = new StreamEventLog(dir);
    const loaded = log.load();
    expect(loaded.duplicates).toBe(2);
    expect(loaded.events.map((e) => e.sequence)).toEqual([1, 2]);

    const history = new StreamEventHistory({ log, persisted: loaded.events });
    const full = history.replay('run-1', 0);
    expect(full.recoverable).toBe(true);
    expect(full.events.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('写失败降级：failures() 累计且不抛错（内存链路不受影响）', () => {
    // logDir 指向一个已存在的"文件"，append 的目录创建/写会失败。
    const fileAsDir = join(dir, 'blocked');
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(fileAsDir, 'i am a file');
    const log = new StreamEventLog(fileAsDir);

    log.append(make('run-1', 1));
    log.append(make('run-1', 2));

    expect(log.failures()).toBeGreaterThan(0);
    // 读侧也容错：load 不炸。
    const result = log.load();
    expect(result.events.length).toBeLessThanOrEqual(1); // 无论如何不崩溃
  });
});