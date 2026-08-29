// =============================================================================
// gitTrace — 阶段留痕（GitStageTrace）纯逻辑聚合
// 数据源：网关 GET /api/git/commits（阶段 ↔ commit/tag 对照，Git 工作区管控卡
//   与轨迹瀑布共用）。本模块只做无 DOM 的派生计算，可单测。
// =============================================================================

import type { GitRecentCommit, GitStageTrace } from './ipc';

/**
 * 某条留痕的 diff 对比基线 commit：取「比目标 seq 更早的最近一条留痕」的 commit
 * （数组按 seq 升序；首条/无更早记录 → null）。
 * 语义与 Git 工作区管控卡一致：相邻两条留痕 = 一个 diff 单元，base 为前一条的 commit。
 * @param traces 该阶段全部留痕（任意顺序，内部按 seq 排序保证健壮）
 * @param seq 目标留痕序号
 */
export function gitTraceBase(
  traces: GitStageTrace[] | null | undefined,
  seq: number,
): string | null {
  if (!traces || traces.length === 0) return null;
  // 网关返回按 startedAt 升序；seq 单调递增时二者等价。此处显式按 seq 排，
  // 即便个别记录时间戳异常也不影响"更早一条"的判定。
  const sorted = [...traces].sort((a, b) => a.seq - b.seq);
  const idx = sorted.findIndex((t) => t.seq === seq);
  if (idx <= 0) return null;
  return sorted[idx - 1]?.commit ?? null;
}

/** 留痕 → 按 seq 建立索引（瀑布行按 seq 对齐 commit/tag；无留痕 → 空 Map）。 */
export function gitTraceBySeq(
  traces: GitStageTrace[] | null | undefined,
): Map<number, GitStageTrace> {
  const m = new Map<number, GitStageTrace>();
  for (const t of traces ?? []) m.set(t.seq, t);
  return m;
}

/**
 * 某时间点对应的阶段执行检查点：取 startedAt ≤ at 的最近一次执行留痕
 * （同时刻取较新 seq；无留痕 / at 缺失或非法 → null）。
 * 语义：自迭代轮次打分发生在某次执行之后，其评分对应的 git 快照 =
 * 最近一次已开始执行时的 commit（与网关 getStageRecords 同口径：
 * commit = 执行 startedAt 时刻的最新提交）。
 */
export function traceAtTime(
  traces: GitStageTrace[] | null | undefined,
  atISO: string | null | undefined,
): GitStageTrace | null {
  if (!traces || traces.length === 0 || !atISO) return null;
  const t = new Date(atISO).getTime();
  if (!Number.isFinite(t)) return null;
  let best: GitStageTrace | null = null;
  let bestStart = -Infinity;
  for (const tr of traces) {
    if (!tr.startedAt) continue;
    const st = new Date(tr.startedAt).getTime();
    if (!Number.isFinite(st) || st > t) continue;
    if (st < bestStart) continue;
    if (st === bestStart && best && tr.seq < best.seq) continue; // 同时刻取较新执行
    best = tr;
    bestStart = st;
  }
  return best;
}

/** 最近提交 diff 对：相邻两条提交组成一个 diff 单元（旧 commit 为 base，新 commit 为 target）。
 *  数据源 = GitStatus.recentCommits（网关按时间倒序 新→旧；空 → []）。
 *  与阶段留痕 diff 同口径（gitTraceBase 的"相邻留痕 = 一个 diff 单元"），
 *  首条（最新）无更早提交可对比 → 不下发，由 GitDiffPreview 的首条降级提示承接。 */
export function recentCommitDiffs(
  commits: GitRecentCommit[] | null | undefined,
): Array<{ base: string | null; target: string; hash: string; message: string }> {
  const list = commits ?? [];
  return list.slice(0, -1).map((cur, i) => {
    const prev = list[i + 1] ?? null;
    return {
      base: prev?.hash ?? null,
      target: cur.hash,
      hash: cur.hash,
      message: cur.message,
    };
  });
}
