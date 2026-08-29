// =============================================================================
// CostBadge — 驾驶舱工具栏「本周成本」迷你角标（成本折叠区外的常驻速览）
// 数据源 = stageStore.costData.trend（近 7 天 CostTrendDay[]，/api/cost 已在
// 启动时聚合进 stageStore，零额外请求）。
// 能力：
//   · 紧凑一行：coins 图标 + 7 天合计（token 口径带单位，执行次数口径不带）
//   · 趋势箭头：近 3 天 vs 前 3 天（↑ 走高 / ↓ 回落 / ＝ 持平），hover tooltip 给全说明
//   · hover 展开 7 天迷你日列表（周一~周日 + 每日口径值），一眼看出哪天最重
//   · 无 trend（老网关/空账本）→ 静默返回 null，不占工具栏空间
// 与「成本」折叠按钮的关系：角标 = 速览，折叠面板 = 完整分布；点击角标同「成本」按钮
// （展开完整面板）。UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji。
// =============================================================================

import React from 'react';
import { useStageStore } from '../../store/stageStore';
import { Icon } from '../ui';
import { I } from '../ui/icons';
import type { CostTrendDay } from '../../utils/ipc';
import {
  dayMetric,
  weekTotal,
  weekTrend,
  badgeLabel,
  weekSummary,
  trendSuffix,
  weekEstCost,
  estCostLabel,
  type TrendDirection,
} from '../../utils/costBadge';

/** 趋势方向 → 箭头/颜色（emerald 走高 / amber 回落 / zinc 持平） */
const DIR_STYLE: Record<TrendDirection, { arrow: string; cls: string; title: string }> = {
  up: { arrow: '↑', cls: 'text-emerald-700', title: '走高' },
  down: { arrow: '↓', cls: 'text-amber-700', title: '回落' },
  flat: { arrow: '＝', cls: 'text-zinc-400', title: '持平' },
};

/** 单日行：周名 + 日期 + 口径值（hover 明细用）。 */
const DayRow: React.FC<{ d: CostTrendDay; hasTokenData: boolean }> = ({ d, hasTokenData }) => {
  const dt = new Date(`${d.date}T00:00:00`);
  const valid = Number.isFinite(dt.getTime());
  const weekday = valid
    ? new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(dt)
    : '—';
  const v = dayMetric(d, hasTokenData);
  return (
    <div className="flex items-center gap-2 text-[11px] leading-tight">
      <span className="w-7 shrink-0 text-zinc-500">{weekday}</span>
      <span className="shrink-0 text-zinc-300 font-mono">{d.date.slice(5)}</span>
      <span className="ml-auto tabular-nums text-zinc-600">
        {hasTokenData ? `${v.toLocaleString('zh-CN')} tok` : `${v.toLocaleString('zh-CN')} 次`}
      </span>
    </div>
  );
};

export const CostBadge: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const costData = useStageStore((s) => s.costData);
  const trend = Array.isArray(costData?.trend) ? costData.trend : null;
  const hasTokenData = costData?.hasTokenData === true;

  // 无近 7 天数据（老网关无 trend / 空账本）→ 静默不渲染，不占工具栏
  const show = React.useMemo(() => (trend ? trend.length > 0 : false), [trend]);

  if (!show) return null;

  const total = weekTotal(trend!, hasTokenData);
  const dir = weekTrend(trend!, hasTokenData);
  const st = DIR_STYLE[dir];
  // 费用估算（¥）：单价已配置才给金额；否则 null（角标只显示 token/次数 + 趋势，
  // 不把「未配置单价」误显示成 ¥0.0000）。单价已配置但账本无 token（hasTokenData=false）
  // → token 列恒 0，估算为 ¥0.0000 —— 这种"有价无 token"的账本与 CostDashboard 同口径
  // （estCost 算出 0），角标如实展示 0 元，tooltip 有「未统计 usage」补充说明。
  const estCost = weekEstCost(trend, costData?.pricePerMillion);
  const estShown = estCost != null; // 单价已配置（金额可算），不论是否 0 元
  const tooltip = [
    weekSummary(total, hasTokenData),
    estShown ? `近 7 天费用估算：${estCostLabel(estCost)}` : '未配置 token 单价：不估算金额',
    trendSuffix(dir),
    '',
    '近 7 天每日（最新在前）：',
    ...trend!.slice(0, 7).map((d) => {
      const v = dayMetric(d, hasTokenData);
      return `${d.date}：${hasTokenData ? `${v.toLocaleString('zh-CN')} tok` : `${v.toLocaleString('zh-CN')} 次`}`;
    }),
    '',
    '点击展开完整执行成本面板',
  ].join('\n');

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative shrink-0 inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:bg-emerald-50/40 transition-all active:scale-[0.98] group"
      title={tooltip}
      aria-label={`本周成本：${weekSummary(total, hasTokenData)}（${trendSuffix(dir)}）`}
    >
      <Icon name={I.coins} size={13} className="text-zinc-400 group-hover:text-emerald-600 transition-colors" />
      <span className="tabular-nums text-zinc-600">{badgeLabel(total, hasTokenData)}</span>
      {/* 费用估算迷你 chip：单价已配置才显示（金额可算）。w 是文案基准宽度，视觉上
          金额与 token 合计对齐。老网关无 trend → 整角标不渲染，自然不显示金额。 */}
      {estShown && (
        <span
          className="shrink-0 inline-flex items-center gap-0.5 pl-1.5 border-l border-zinc-200 text-[10px] text-emerald-700 tabular-nums font-medium"
          title={`近 7 天费用估算（单价 输入 ¥${costData?.pricePerMillion.input}/M · 输出 ¥${costData?.pricePerMillion.output}/M）`}
        >
          <Icon name={I.wallet} size={10} weight="fill" />
          {estCostLabel(estCost)}
        </span>
      )}
      <span className={`text-[10px] leading-none ${st.cls}`}>{st.arrow}</span>
      {/* hover 明细浮层：近 7 天每日口径（新→旧），与角标紧凑成一体 */}
      <span className="absolute top-full right-0 mt-1 z-30 rounded-lg border border-zinc-200 bg-white shadow-lg p-2.5 space-y-1 opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity">
        <div className="text-[10px] text-zinc-400 mb-0.5">近 7 天（新→旧）</div>
        {trend!.slice(0, 7).map((d) => (
          <DayRow key={d.date} d={d} hasTokenData={hasTokenData} />
        ))}
      </span>
    </button>
  );
};
