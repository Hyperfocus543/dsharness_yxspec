// =============================================================================
// selfIterationSummary — 自迭代 run 汇总纯逻辑（SelfIterationCard 汇总徽标行数据源）
// 数据源 = SelfIterationCard 已拉取的 SelfIterationOverview（/api/self-iteration），
// 本模块只做无 DOM 的派生计算，可单测；不新增任何接口/后端改动。
// 目标：给「自迭代评分」卡一个跨阶段横截面 —— 一眼看清哪些阶段收敛、哪些还在
// 跑、哪些退化，以及每个阶段的最佳分/最差轮次（diff 基线聚合与趋势条同源同口径）。
// 展示口径与 ScoreTrend/StageBlock 保持一致：
//   · 阶段 best = 该阶段全部有总分轮次的 max（与 ScoreTrend maxTotal 同口径）
//   · 阶段最差轮 = 该阶段总分最低的轮（= 该阶段 diff 基线，重新自迭代起点）
//   · 阶段收敛 = latest verdict 为 converge / converge_by_maxiter（与网关 converged 同口径）
//   · 退化 = 任一有总分轮次被判 degrade（stage 级最差信号）
// 空 stages / 空 rounds → 各函数返回空数组/空串，不抛错（未跑过自迭代静默降级）。
// UI 基线：design-taste skill — 纯数据，色/图标由调用方组件负责。
// =============================================================================

import type { SelfIterationOverview, SelfIterationRound, SelfIterationStage } from './ipc';

/** 有总分（total 为有限数字）的轮次 —— 与 ScoreTrend scoredRounds 同口径。 */
function scoredRounds(s: SelfIterationStage): SelfIterationRound[] {
  return (s?.rounds ?? []).filter((r) => r.total != null && Number.isFinite(r.total));
}

/** 单阶段汇总：best = 最高总分轮；worst = 最低总分轮（含退化信号）。 */
export interface StageRunSummary {
  token: string;
  /** 最高总分轮（无有分轮 → null） */
  best: SelfIterationRound | null;
  /** 最低总分轮（无有分轮 → null） */
  worst: SelfIterationRound | null;
  /** 是否已收敛（latest verdict converge / converge_by_maxiter） */
  converged: boolean;
  /** 是否退化过（任一分轮被判 degrade） */
  degraded: boolean;
}

/**
 * 汇总一个阶段的自迭代 run 结果。
 * 判定口径与现有组件严格一致：
 *   · converged = s.converged（网关按 latest verdict 算）
 *   · degraded  = 该阶段任一有分轮 verdict==='degrade'
 *   · best/worst = 最高/最低 total 的轮次（并列取较新轮）
 */
export function summarizeStage(s: SelfIterationStage): StageRunSummary {
  const scored = scoredRounds(s);
  let best: SelfIterationRound | null = null;
  let worst: SelfIterationRound | null = null;
  for (const r of scored) {
    const t = r.total as number;
    if (!best || t > (best.total as number) || (t === best.total && r.round > best.round)) best = r;
    if (!worst || t < (worst.total as number) || (t === worst.total && r.round > worst.round)) worst = r;
  }
  return {
    token: s.token,
    best,
    worst,
    converged: s.converged === true,
    degraded: scored.some((r) => r.verdict === 'degrade'),
  };
}

/** 全部阶段汇总（仅存在留痕的阶段；空 → 空数组）。 */
export function summarizeStages(data: SelfIterationOverview | null | undefined): StageRunSummary[] {
  return (data?.stages ?? []).map(summarizeStage);
}

/** 已收敛阶段数（无数据 → 0）。 */
export function convergedCount(summaries: StageRunSummary[]): number {
  return summaries.filter((s) => s.converged).length;
}

/** 仍在跑/未收敛阶段数（无数据 → 0）。 */
export function runningCount(summaries: StageRunSummary[]): number {
  return summaries.filter((s) => !s.converged && !s.degraded).length;
}

/** 退化阶段数（无数据 → 0）。 */
export function degradedCount(summaries: StageRunSummary[]): number {
  return summaries.filter((s) => s.degraded).length;
}

/** 阶段最佳分徽标文案：`R<n> <总分>`（有 best 轮 → 短串；无 → 空串不渲染）。 */
export function bestBadgeLabel(s: StageRunSummary): string {
  return s.best ? `R${s.best.round} ${s.best.total}` : '';
}

/** 阶段最差轮徽标文案：`R<n> <总分>`（有 worst 轮 → 短串；无 → 空串不渲染）。 */
export function worstBadgeLabel(s: StageRunSummary): string {
  return s.worst ? `R${s.worst.round} ${s.worst.total}` : '';
}
