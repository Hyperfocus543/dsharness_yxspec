// @vitest-environment node
// =============================================================================
// gitTrace.ts 纯逻辑单测（阶段留痕 diff 基线派生）
// 只测无 DOM 的导出函数：base commit 查找 / seq 索引。不渲染组件。
// =============================================================================

import { describe, it, expect } from 'vitest';
import { gitTraceBase, gitTraceBySeq } from './gitTrace';
import type { GitStageTrace } from './ipc';

function trace(partial: Partial<GitStageTrace>): GitStageTrace {
  return {
    seq: 1,
    commit: 'abc1234',
    tag: null,
    status: 'passed',
    startedAt: '2026-08-29T00:00:00.000Z',
    finishedAt: null,
    ...partial,
  };
}

describe('gitTraceBase（相邻留痕 diff 基线）', () => {
  it('空数组 / null → null（无对比基线）', () => {
    expect(gitTraceBase(null, 1)).toBeNull();
    expect(gitTraceBase([], 1)).toBeNull();
  });

  it('首条留痕（seq 最小）→ null（无更早记录，降级提示）', () => {
    const traces = [trace({ seq: 1, commit: 'aaa1111' }), trace({ seq: 2, commit: 'bbb2222' })];
    expect(gitTraceBase(traces, 1)).toBeNull();
  });

  it('取比目标 seq 更早的最近一条 commit', () => {
    const traces = [
      trace({ seq: 1, commit: 'aaa1111' }),
      trace({ seq: 2, commit: 'bbb2222' }),
      trace({ seq: 3, commit: 'ccc3333' }),
    ];
    expect(gitTraceBase(traces, 2)).toBe('aaa1111');
    expect(gitTraceBase(traces, 3)).toBe('bbb2222');
  });

  it('乱序输入也按 seq 判定（不依赖网关返回顺序）', () => {
    const traces = [
      trace({ seq: 3, commit: 'ccc3333' }),
      trace({ seq: 1, commit: 'aaa1111' }),
      trace({ seq: 2, commit: 'bbb2222' }),
    ];
    expect(gitTraceBase(traces, 2)).toBe('aaa1111');
    expect(gitTraceBase(traces, 3)).toBe('bbb2222');
  });

  it('目标 seq 不存在 → null（找不到对齐留痕）', () => {
    const traces = [trace({ seq: 1, commit: 'aaa1111' })];
    expect(gitTraceBase(traces, 99)).toBeNull();
  });

  it('base 取自更早一条留痕的 commit（目标自身无 commit 不影响基线查找，target 由调用方把关）', () => {
    const traces = [trace({ seq: 1, commit: 'aaa1111' }), trace({ seq: 2, commit: '' })];
    expect(gitTraceBase(traces, 2)).toBe('aaa1111');
  });
});

describe('gitTraceBySeq（seq → 留痕索引）', () => {
  it('建立 seq 映射（瀑布行按 seq 对齐）', () => {
    const traces = [
      trace({ seq: 1, commit: 'aaa1111' }),
      trace({ seq: 2, commit: 'bbb2222' }),
    ];
    const m = gitTraceBySeq(traces);
    expect(m.size).toBe(2);
    expect(m.get(1)?.commit).toBe('aaa1111');
    expect(m.get(2)?.commit).toBe('bbb2222');
  });

  it('null / 空 → 空 Map（行内不渲染 git 徽标）', () => {
    expect(gitTraceBySeq(null).size).toBe(0);
    expect(gitTraceBySeq([]).size).toBe(0);
  });
});
