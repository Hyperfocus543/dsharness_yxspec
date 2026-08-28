// =============================================================================
// gitTrace — 阶段留痕（GitStageTrace）纯逻辑聚合
// 数据源：网关 GET /api/git/commits（阶段 ↔ commit/tag 对照，Git 工作区管控卡
//   与轨迹瀑布共用）。本模块只做无 DOM 的派生计算，可单测。
// =============================================================================

import type { GitStageTrace } from './ipc';

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
