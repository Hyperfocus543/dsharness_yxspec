// @vitest-environment node
// =============================================================================
// gitTrace.ts 纯逻辑单测（阶段留痕 diff 基线派生）
// 只测无 DOM 的导出函数：base commit 查找 / seq 索引。不渲染组件。
// =============================================================================

import { describe, it, expect } from 'vitest';
import { gitTraceBase, gitTraceBySeq, hasStageTag, recentCommitDiffs, traceAtTime, traceBaseAt } from './gitTrace';
import type { GitRecentCommit, GitStageTrace, TrajectoryAllEntry } from './ipc';

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

function recent(partial: Partial<GitRecentCommit>): GitRecentCommit {
  return { hash: 'abc1234', message: '提交说明', at: '2026-08-29T00:00:00.000Z', ...partial };
}

/** 轨迹流行构造（TrajectoryAllEntry 精简；trajectory-all 已合并 git 字段）。 */
function entry(partial: Partial<TrajectoryAllEntry>): TrajectoryAllEntry {
  return {
    stage: 'swe_req',
    seq: 1,
    sessionId: 's1',
    status: 'passed',
    stageLabel: '需求分析',
    aspice: 'SWE.1',
    command: '',
    group: 'SWE',
    startedAt: 1756000000000,
    finishedAt: null,
    commit: 'abc1234',
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

describe('traceAtTime（自迭代轮次 ↔ 阶段执行检查点对齐）', () => {
  const t1 = trace({ seq: 1, commit: 'aaa1111', startedAt: '2026-08-29T01:00:00.000Z' });
  const t2 = trace({ seq: 2, commit: 'bbb2222', startedAt: '2026-08-29T02:00:00.000Z' });
  const t3 = trace({ seq: 3, commit: 'ccc3333', startedAt: '2026-08-29T03:00:00.000Z' });

  it('空 / null / 无时间 → null（不渲染 git 徽标）', () => {
    expect(traceAtTime(null, '2026-08-29T01:30:00.000Z')).toBeNull();
    expect(traceAtTime([], '2026-08-29T01:30:00.000Z')).toBeNull();
    expect(traceAtTime([t1, t2], null)).toBeNull();
    expect(traceAtTime([t1, t2], '')).toBeNull();
    expect(traceAtTime([t1, t2], 'bad-date')).toBeNull();
  });

  it('取 startedAt ≤ at 的最近一次执行（不晚于打分的最后检查点）', () => {
    expect(traceAtTime([t1, t2, t3], '2026-08-29T01:30:00.000Z')).toBe(t1);
    expect(traceAtTime([t1, t2, t3], '2026-08-29T02:59:00.000Z')).toBe(t2);
    expect(traceAtTime([t1, t2, t3], '2026-08-29T03:00:00.000Z')).toBe(t3);
  });

  it('at 早于所有执行 / 晚于全部执行 → 最近边界检查点', () => {
    expect(traceAtTime([t2, t3], '2026-08-29T00:00:00.000Z')).toBeNull(); // 早于全部 → 无检查点
    expect(traceAtTime([t1, t2], '2026-08-29T10:00:00.000Z')).toBe(t2); // 晚于全部 → 最新
  });

  it('同时刻多次执行 → 取较新 seq（打分通常对齐最后一次）', () => {
    const a = trace({ seq: 1, commit: 'aaa1111', startedAt: '2026-08-29T01:00:00.000Z' });
    const b = trace({ seq: 2, commit: 'bbb2222', startedAt: '2026-08-29T01:00:00.000Z' });
    expect(traceAtTime([a, b], '2026-08-29T01:30:00.000Z')).toBe(b);
  });

  it('乱序输入也取最近检查点（不依赖数组顺序）', () => {
    expect(traceAtTime([t3, t1, t2], '2026-08-29T02:30:00.000Z')).toBe(t2);
  });

  it('无 startedAt 的记录跳过（不阻塞检查点查找）', () => {
    const noStart = trace({ seq: 0, commit: 'zzz0000', startedAt: null });
    expect(traceAtTime([noStart, t1], '2026-08-29T01:30:00.000Z')).toBe(t1);
  });
});

describe('recentCommitDiffs（最近提交 diff 对派生）', () => {
  it('空 / null → []（无提交不预览）', () => {
    expect(recentCommitDiffs(null)).toEqual([]);
    expect(recentCommitDiffs([])).toEqual([]);
    expect(recentCommitDiffs(undefined)).toEqual([]);
  });

  it('单条提交 → []（无更早提交可对比，首条降级提示）', () => {
    expect(recentCommitDiffs([recent({ hash: 'abc1234' })])).toEqual([]);
  });

  it('相邻两条 → 1 对：旧 commit 为 base，新 commit 为 target', () => {
    const commits = [recent({ hash: 'bbb2222' }), recent({ hash: 'aaa1111' })];
    expect(recentCommitDiffs(commits)).toEqual([
      { base: 'aaa1111', target: 'bbb2222', hash: 'bbb2222', message: '提交说明' },
    ]);
  });

  it('多条（新→旧）：每条取后一条较旧 commit 为 base，首条无 base', () => {
    const commits = [
      recent({ hash: 'ccc3333', message: '第三条' }),
      recent({ hash: 'bbb2222', message: '第二条' }),
      recent({ hash: 'aaa1111', message: '第一条' }),
    ];
    const diffs = recentCommitDiffs(commits);
    expect(diffs).toHaveLength(2);
    expect(diffs[0]).toMatchObject({ base: 'bbb2222', target: 'ccc3333', hash: 'ccc3333' });
    expect(diffs[1]).toMatchObject({ base: 'aaa1111', target: 'bbb2222', hash: 'bbb2222' });
  });
});

describe('traceBaseAt（全局轨迹流相邻执行 diff 基线）', () => {
  const t1 = entry({ seq: 1, startedAt: 1756000000000, commit: 'aaa1111' });
  const t2 = entry({ seq: 2, startedAt: 1756003600000, commit: 'bbb2222' });
  const t3 = entry({ seq: 3, startedAt: 1756007200000, commit: 'ccc3333' });
  // 网关按 startedAt 时间降序返回（新→旧）
  const rows = [t3, t2, t1];

  it('空 / null / target 缺 commit / startedAt → null', () => {
    expect(traceBaseAt(null, t2)).toBeNull();
    expect(traceBaseAt([], t2)).toBeNull();
    expect(traceBaseAt(rows, null)).toBeNull();
    expect(traceBaseAt(rows, entry({ seq: 9, commit: null }))).toBeNull();
    expect(traceBaseAt(rows, entry({ seq: 9, startedAt: undefined, commit: 'ddd4444' }))).toBeNull();
  });

  it('取时间上相邻的上一次执行 commit（跨阶段，不依赖 seq/stage）', () => {
    expect(traceBaseAt(rows, t3)).toBe('bbb2222'); // t2 是 t3 之前最近一次执行
    expect(traceBaseAt(rows, t2)).toBe('aaa1111');
  });

  it('最旧一条（无更早执行）→ null（首条降级提示）', () => {
    expect(traceBaseAt(rows, t1)).toBeNull();
  });

  it('目标不在 rows（自迭代等只读场景）→ 按时间找相邻更早执行', () => {
    const ghost = entry({ seq: 9, startedAt: 1756005000000, commit: 'fff9999' }); // 在 t2/t3 之间
    expect(traceBaseAt(rows, ghost)).toBe('bbb2222'); // 更早的最近一次执行 = t2
  });

  it('乱序输入也按时间判定（不依赖数组顺序）', () => {
    const shuffled = [t1, t3, t2];
    expect(traceBaseAt(shuffled, t3)).toBe('bbb2222');
    expect(traceBaseAt(shuffled, t2)).toBe('aaa1111');
  });

  it('更早执行与 target 同一 commit → 跳过（无增量），继续往前找', () => {
    const same = entry({ seq: 2, startedAt: 1756003600000, commit: 'ccc3333' }); // 与 t3 同 commit
    const mixed = [t3, same, t1];
    expect(traceBaseAt(mixed, t3)).toBe('aaa1111'); // same 被跳过，取 t1
  });

  it('无 commit 的中间行跳过（不阻塞基线查找）', () => {
    const noCommit = entry({ seq: 2, startedAt: 1756003600000, commit: null });
    const mixed = [t3, noCommit, t1];
    expect(traceBaseAt(mixed, t3)).toBe('aaa1111');
  });

  it('base 与 target 同 commit（期间无新提交）→ null（无增量 diff 可看）', () => {
    const t2same = entry({ seq: 2, startedAt: 1756003600000, commit: 'ccc3333' });
    const rows2 = [t3, t2same];
    expect(traceBaseAt(rows2, t3)).toBeNull();
  });
});

describe('hasStageTag（该次执行是否真正打了阶段收尾 tag）', () => {
  it('无 tag / null / undefined → false', () => {
    expect(hasStageTag(null)).toBe(false);
    expect(hasStageTag(undefined)).toBe(false);
    expect(hasStageTag({ tag: null })).toBe(false);
    expect(hasStageTag({ tag: '' })).toBe(false);
  });

  it('tagCommit 与 commit 逐字一致 → true', () => {
    expect(hasStageTag({ tag: 'yxspec/swe_req/1', tagCommit: 'abc1234', commit: 'abc1234' })).toBe(true);
  });

  it('tagCommit 为完整 hash、commit 为 7 位短 hash（前缀比对）→ true', () => {
    expect(hasStageTag({ tag: 'yxspec/swe_req/1', tagCommit: 'abc1234def5678', commit: 'abc1234' })).toBe(true);
  });

  it('tagCommit 与 commit 不一致（旧 tag 滞后挂在更晚提交上）→ false', () => {
    expect(hasStageTag({ tag: 'yxspec/swe_req/1', tagCommit: 'def5678', commit: 'abc1234' })).toBe(false);
  });

  it('tagCommit 缺省（老网关无 peeled 信息）→ 退化为 tag 存在即算', () => {
    expect(hasStageTag({ tag: 'yxspec/swe_req/1', tagCommit: null, commit: 'abc1234' })).toBe(true);
    expect(hasStageTag({ tag: 'yxspec/swe_req/1', commit: 'abc1234' })).toBe(true);
  });
});
