// =============================================================================
// gitTrace — 阶段留痕（GitStageTrace）纯逻辑聚合
// 数据源：网关 GET /api/git/commits（阶段 ↔ commit/tag 对照，Git 工作区管控卡
//   与轨迹瀑布共用）。本模块只做无 DOM 的派生计算，可单测。
// =============================================================================

import type { GitRecentCommit, GitStageTrace, TrajectoryAllEntry } from './ipc';

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

/**
 * 全局轨迹流 diff 基线：取「时间上比 target 更早的最近一次执行」的 commit。
 * 数据源 = GET /api/trajectory-all 的 rows（网关按 startedAt 时间降序 新→旧）。
 * 语义与阶段留痕 gitTraceBase 一致：相邻两次执行 = 一个 diff 单元，base 为前一次
 * 执行时刻的最新 commit。仅当 base 与 target 指向同一 commit 时跳过该执行
 * （期间无新提交 → 无增量 diff 可看，继续往前找真正产生改动的相邻执行）。
 * @param rows 轨迹流（时间降序；跨阶段混排，不依赖 stage/seq）
 * @param target 目标执行记录（其 commit 作为 diff target）
 */
export function traceBaseAt(
  rows: TrajectoryAllEntry[] | null | undefined,
  target: TrajectoryAllEntry | null | undefined,
): string | null {
  if (!rows || rows.length === 0 || !target || !target.startedAt || !target.commit) return null;
  const t = Math.floor(target.startedAt / 1000); // startedAt 毫秒 → 秒，对齐 commit 时间戳口径
  const seen = new Set<string>([target.commit]); // 与 target 同 commit → 无增量 diff，跳过
  // 取时间上最接近 t 的更早执行（不依赖数组顺序；rows 乱序也能找对）
  let best: { sec: number; commit: string } | null = null;
  for (const r of rows) {
    if (r === target) continue;
    if (!r.startedAt || !r.commit) continue;
    const rs = Math.floor(r.startedAt / 1000);
    if (rs >= t) continue; // 严格更早
    if (seen.has(r.commit)) continue; // 与 target 同 commit → 无增量，继续往前找
    if (!best || rs > best.sec) best = { sec: rs, commit: r.commit };
  }
  return best?.commit ?? null;
}
