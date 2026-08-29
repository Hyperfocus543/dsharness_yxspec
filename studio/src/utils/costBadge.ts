// =============================================================================
// costBadge — 「本周成本」角标纯逻辑（驾驶舱工具栏迷你角标数据源）
// 数据源 = stageStore.costData.trend（近 7 天 CostTrendDay[]，网关 /api/cost 已聚合），
// 本模块只做纯函数聚合，无 DOM 依赖，可单测。
// 展示口径与 CostDashboard TrendStrip 保持一致：
//   · hasTokenData → token/日（prompt+completion）；否则 → 执行次数/日
//   · 趋势箭头 = 近 3 天 vs 前 3 天（同口径合计），持平给「＝」（±5% 内）
// 老网关无 trend 字段 / 空数组 → 返回 null，角标静默不渲染（不喧宾夺主）。
// UI 基线：design-taste skill — 纯数据，色/图标由调用方组件负责。
// =============================================================================

import type { CostTrendDay } from '../utils/ipc';

/** 单日负载口径（与 TrendStrip 一致：token 可用 → token；否则 → 执行次数）。 */
export function dayMetric(d: CostTrendDay, hasTokenData: boolean): number {
  return hasTokenData ? d.promptTokens + d.completionTokens : d.runs;
}

/** 近 7 天合计（trend 是时间倒序 新→旧；空 → 0）。 */
export function weekTotal(trend: CostTrendDay[], hasTokenData: boolean): number {
  let sum = 0;
  for (const d of trend) sum += dayMetric(d, hasTokenData);
  return sum;
}

export type TrendDirection = 'up' | 'down' | 'flat';

/** 趋势方向：最近 3 天 vs 前 3 天（同口径合计）；±5% 内持平。
 *  trend 时间倒序（新→旧）：后 3 位 = 最近 3 天，其前 3 位 = 前 3 天。
 *  任一侧不足 1 天/全为 0 → 'flat'（无对比意义，不误报涨跌）。 */
export function weekTrend(trend: CostTrendDay[], hasTokenData: boolean): TrendDirection {
  const recent = trend.slice(0, 3);
  const prior = trend.slice(3, 6);
  if (recent.length === 0 || prior.length === 0) return 'flat';
  const r = recent.reduce((acc, d) => acc + dayMetric(d, hasTokenData), 0);
  const p = prior.reduce((acc, d) => acc + dayMetric(d, hasTokenData), 0);
  if (p <= 0 || r <= 0) return 'flat';
  const ratio = r / p;
  if (ratio > 1.05) return 'up';
  if (ratio < 0.95) return 'down';
  return 'flat';
}

/** 角标文案（千分位；token 口径带单位，执行次数口径不带——短角标不放单位）。 */
export function badgeLabel(total: number, hasTokenData: boolean): string {
  const n = Number.isFinite(total) ? total.toLocaleString('zh-CN') : '0';
  return hasTokenData ? `${n}` : n;
}

/** 角标 tooltip 首行：7 天合计口径说明（token / 执行次数）。 */
export function weekSummary(total: number, hasTokenData: boolean): string {
  const n = Number.isFinite(total) ? total.toLocaleString('zh-CN') : '0';
  return `近 7 天${hasTokenData ? ' token' : '执行次数'}：${n}${hasTokenData ? ' tok' : ' 次'}`;
}

/** 趋势方向 → 徽标文案（工具栏角标用；flat 也给出中立文案，避免裸「＝」无解释）。 */
export const TREND_LABEL: Record<TrendDirection, string> = {
  up: '↑ 较前段走高',
  down: '↓ 较前段回落',
  flat: '＝ 与前段持平',
};

/** 趋势方向 → tooltip 尾部文案（近 3 天 vs 前 3 天，同口径合计）。 */
export function trendSuffix(trend: TrendDirection): string {
  return TREND_LABEL[trend];
}

/** 单价（每百万 token，¥）——与网关 /api/cost pricePerMillion 同形。 */
export interface CostPrice {
  input: number;
  output: number;
}

/**
 * 近 7 天费用估算：逐日 prompt/completion token 按各自单价折算求和（¥）。
 * 单价均 ≤ 0（未配置）→ null（角标不渲染金额，避免误估 0 元）。
 * 口径与 CostDashboard estCost 严格一致：token / 1_000_000 × 单价。
 */
export function weekEstCost(
  trend: CostTrendDay[] | null | undefined,
  price: CostPrice | null | undefined,
): number | null {
  if (!price || (price.input <= 0 && price.output <= 0)) return null;
  let cost = 0;
  for (const d of trend ?? []) {
    cost += (d.promptTokens / 1_000_000) * price.input;
    cost += (d.completionTokens / 1_000_000) * price.output;
  }
  return Number.isFinite(cost) ? cost : null;
}

/** 金额文案：¥ + toFixed(4)（与 CostDashboard 估算金额同格式）；null → 不渲染占位。 */
export function estCostLabel(cost: number | null | undefined): string {
  if (cost == null || !Number.isFinite(cost)) return '—';
  return `¥${cost.toFixed(4)}`;
}
