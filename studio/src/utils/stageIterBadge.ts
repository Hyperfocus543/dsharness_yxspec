// =============================================================================
// stageIterBadge — 阶段自迭代徽标纯逻辑（驾驶舱 25 阶段卡片 × 自迭代联动）
// 数据源 = StagePanorama 已拉取的 SelfIterationOverview（/api/self-iteration，
// 与「自迭代评分」功能卡同接口），本模块只做无 DOM 的派生计算，可单测。
// 目标：给每张阶段卡一个「该阶段跑过自迭代」的迷你证据徽标 —— 一眼看出哪些
// 阶段被自迭代打磨过、最终收敛还是退化，与卡片状态色互补，不重复展示。
// 口径与 SelfIterationCard（ScoreTrend/StageRunBadge）严格一致：
//   · 总分   = 该阶段有分轮次的 max total（best 轮，与 StageRunSummary.best 同口径）
//   · 判定色 = latest verdict：converge*/converge_by_maxiter → sage（收敛，正绿）
//              degrade → red（退化，低于基线回滚）；continue → amber（仍在迭代）
//   · 轮次   = 有分轮次数（rounds 里 total 为有限数字的条数）
// 未跑过自迭代（stages 里无该 token / rounds 空）→ null，卡片不渲染徽标（静默降级）。
// UI 基线：design-taste skill — 纯数据，色/文案由调用方组件负责。
// =============================================================================

import type { SelfIterationOverview, SelfIterationRound, SelfIterationStage } from './ipc';

/** 判定三态 → 徽标文案 + 色标（与 SelfIterationCard VERDICT_STYLE 语义一致）：
 *  converge 绿 / continue 琥珀 / degrade 红。 */
export type IterBadgeTone = 'converged' | 'running' | 'degraded';

export interface StageIterBadge {
  /** 阶段 token（调用方对齐用） */
  token: string;
  /** 最佳总分（有分轮次的 max；无 → null，不渲染） */
  total: number | null;
  /** 有分轮次数 */
  rounds: number;
  /** 判定三态 */
  tone: IterBadgeTone;
  /** 最新判定原文（verdict，tooltip 展示；无 → null） */
  verdict: string | null;
  /** 最新轮次判定 reason（tooltip 展示；无 → null） */
  reason: string | null;
}

/** 有分值（total 为有限数字）的轮次，按轮去重成一条 —— 与 ScoreTrend scoredRounds 同口径：
 *  每轮 score 与 round 两条留痕合并，round 判定留痕优先（同轮总分一致），每轮恒一条。 */
function scoredRounds(s: SelfIterationStage): SelfIterationRound[] {
  const byRound = new Map<number, SelfIterationRound>();
  for (const r of s?.rounds ?? []) {
    if (r.total == null || !Number.isFinite(r.total)) continue;
    const cur = byRound.get(r.round);
    if (!cur || r.type === 'round') byRound.set(r.round, r); // 已有同轮 → round 判定留痕优先
  }
  return [...byRound.values()];
}

function toneOf(s: SelfIterationStage): IterBadgeTone {
  const v = s?.latest?.verdict;
  if (v === 'converge' || v === 'converge_by_maxiter') return 'converged';
  if (v === 'degrade') return 'degraded';
  return 'running';
}

/**
 * 单阶段自迭代徽标数据（有分轮才给徽标；未跑/无分 → null）。
 * 判定色与自迭代卡一致：latest verdict 收敛 → 绿，退化 → 红，其余（continue/无）→ 琥珀。
 */
export function stageIterBadge(
  data: SelfIterationOverview | null | undefined,
  token: string,
): StageIterBadge | null {
  const s = (data?.stages ?? []).find((st) => st.token === token);
  if (!s) return null;
  const scored = scoredRounds(s);
  if (scored.length === 0) return null;
  const best = scored.reduce((acc, r) => Math.max(acc, r.total as number), 0);
  return {
    token,
    total: best,
    rounds: scored.length,
    tone: toneOf(s),
    verdict: s.latest?.verdict ?? null,
    reason: s.latest?.reason ?? null,
  };
}

/** 全部阶段徽标索引（token → 徽标；StagePanorama 构建传给每张卡片）。 */
export function stageIterBadges(
  data: SelfIterationOverview | null | undefined,
): Map<string, StageIterBadge> {
  const m = new Map<string, StageIterBadge>();
  for (const s of data?.stages ?? []) {
    const b = stageIterBadge(data, s.token);
    if (b) m.set(s.token, b);
  }
  return m;
}
