// =============================================================================
// CostDashboard — 驾驶舱「执行成本」卡片
// 数据源：网关 GET /api/cost（聚合 .dsh/gateway-log 审计账本）。
// 展示：总 token / 总耗时 / 总请求次数 / 工具调用数；hasTokenData=false 时
// 明确标注「token 未统计（数据源无 usage）」；单价已配置时显示估算金额。
// 阶段级用横向 bar 展示耗时 / token 分布。
// 近 7 天趋势条（成本角标）：日级迷你 bar（token 可用时画 token，否则画执行次数），
// 顶部给 7 天合计小徽标（token / 次数，随 hasTokenData 自适应）。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { useStageStore } from '../../store/stageStore';
import { useProjectStore } from '../../store/projectStore';
import { useToastStore } from '../../store/toastStore';
import { Button, EmptyState, Icon } from '../ui';
import { I } from '../ui/icons';
import type { CostData, CostTrendDay } from '../../utils/ipc';
import { STAGE_TABLE } from '../../data/stage-mapping';

/** 毫秒 → 人类可读耗时（省略高位零，与项目时间约定一致） */
function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** 千分位格式化 */
function fmtNum(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('zh-CN') : '0';
}

/** 估算金额：tokens × 单价（每百万）。单价 0 → null（不估金额）。 */
function estCost(data: CostData, isInput: boolean): number | null {
  const price = isInput ? data.pricePerMillion.input : data.pricePerMillion.output;
  if (!price || price <= 0) return null;
  const tokens = isInput ? data.totals.promptTokens : data.totals.completionTokens;
  return (tokens / 1_000_000) * price;
}

/** 近 7 天趋势条（成本角标）：token 可用时画 token，否则画执行次数。
 *  每日迷你 bar + 顶部 7 天合计小徽标；空日（runs:0）灰条占位，不喧宾夺主。 */
const TrendStrip: React.FC<{ trend: CostTrendDay[]; hasTokenData: boolean }> = ({ trend, hasTokenData }) => {
  if (trend.length === 0) return null;
  // 展示口径随数据源自适应：token 可用 → token/日；否则 → 执行次数/日（老账本无 usage）
  const metricOf = (d: CostTrendDay): number =>
    hasTokenData ? d.promptTokens + d.completionTokens : d.runs;
  const sum7 = trend.reduce((acc, d) => acc + metricOf(d), 0);
  const maxV = Math.max(1, ...trend.map((d) => metricOf(d)));
  const weekday = (key: string): string => {
    const d = new Date(`${key}T00:00:00`);
    if (!Number.isFinite(d.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-CN', { weekday: 'narrow' }).format(d);
  };
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
        <span className="inline-flex items-center gap-1">
          <Icon name={I.chartBar} size={12} />
          近 7 天 {hasTokenData ? 'token' : '执行次数'}趋势
        </span>
        <span className="tabular-nums text-zinc-500" title="7 天合计（与顶部统计可能不同：仅取有记录的日）">
          合计 <span className="font-semibold text-zinc-700">{fmtNum(sum7)}</span>
        </span>
      </div>
      <div className="flex items-end gap-1.5 h-9" role="img" aria-label={`近 7 天${hasTokenData ? ' token' : ' 执行次数'}趋势柱状图`}>
        {trend.map((d) => {
          const v = metricOf(d);
          const pct = Math.max(v > 0 ? 10 : 0, Math.round((v / maxV) * 100));
          return (
            <div key={d.date} className="flex-1 min-w-0 flex flex-col items-center gap-0.5 group" title={`${d.date}：${hasTokenData ? fmtNum(v) + ' token' : v + ' 次执行'}`}>
              <div className="w-full flex items-end justify-center flex-1" style={{ height: 'calc(100% - 14px)' }}>
                <div
                  className={`w-full max-w-[14px] rounded-sm transition-all ${
                    v > 0 ? 'bg-emerald-500 group-hover:bg-emerald-600' : 'bg-zinc-100'
                  }`}
                  style={{ height: v > 0 ? `${pct}%` : '3px' }}
                />
              </div>
              <span className="text-[9px] text-zinc-400 tabular-nums leading-none">{weekday(d.date)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const CostDashboard: React.FC = () => {
  const costData = useStageStore((s) => s.costData);
  const loadCost = useStageStore((s) => s.loadCost);
  const lastUpdate = useStageStore((s) => s.lastUpdate);
  const eventsConnected = useStageStore((s) => s.eventsConnected);
  const project = useProjectStore((s) => s.current);
  const pushToast = useToastStore((s) => s.push);
  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await loadCost();
      pushToast('success', '已刷新执行成本数据');
    } catch (e: any) {
      pushToast('error', `刷新失败: ${e?.message || e}`);
    } finally {
      setRefreshing(false);
    }
  };

  if (!project) {
    return (
      <div className="border border-zinc-200 rounded-lg bg-white">
        <EmptyState icon={I.chartBar} title="未选择项目" hint="请先选择项目，再查看执行成本统计" />
      </div>
    );
  }

  if (!costData) {
    return (
      <div className="border border-zinc-200 rounded-lg bg-white">
        <EmptyState
          icon={I.chartBar}
          title="暂无成本数据"
          hint="网关未启动或审计账本为空。启动网关后点「刷新」拉取 /api/cost。"
        />
        <div className="pb-4 flex justify-center">
          <Button variant="secondary" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <Icon name={I.refresh} size={14} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? '刷新中' : '刷新'}
          </Button>
        </div>
      </div>
    );
  }

  const { totals, perStage, hasTokenData, pricePerMillion, note, trend } = costData;
  const hasPrice = (pricePerMillion.input > 0) || (pricePerMillion.output > 0);
  const totalTokens = totals.promptTokens + totals.completionTokens;
  const costIn = estCost(costData, true);
  const costOut = estCost(costData, false);
  const totalCost = (costIn ?? 0) + (costOut ?? 0);

  // 阶段级耗时分布 bar（取最大耗时归一化）
  const maxElapsed = perStage.reduce((m, s) => Math.max(m, s.elapsedMs), 0) || 1;

  return (
    <div className="space-y-3">
      {/* 标题 + 刷新 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
            <span className="text-emerald-600">
              <Icon name={I.chartBar} size={16} weight="fill" />
            </span>
            执行成本
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5 inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  eventsConnected ? 'bg-sage-500' : 'bg-zinc-300'
                }`}
                title={eventsConnected ? '已实时订阅网关事件' : '未连接'}
              />
              {eventsConnected ? '实时' : '离线'}
            </span>
            <span>
              数据更新于 {lastUpdate ? new Date(lastUpdate).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'}
            </span>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
            >
              <Icon name={I.refresh} size={12} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? '刷新中' : '刷新'}
            </button>
          </p>
        </div>
      </div>

      {/* 顶部统计磁贴 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatTile
          label="总 Token"
          value={hasTokenData ? fmtNum(totalTokens) : '未统计'}
          sub={!hasTokenData ? '数据源无 usage' : undefined}
          icon={I.coins}
          tone="main"
        />
        <StatTile
          label="总耗时"
          value={fmtMs(totals.elapsedMs)}
          icon={I.timer}
          tone="neutral"
        />
        <StatTile
          label="执行次数"
          value={fmtNum(totals.runs)}
          icon={I.play}
          tone="neutral"
        />
        <StatTile
          label="工具调用"
          value={fmtNum(totals.toolCalls)}
          icon={I.wrench}
          tone="neutral"
        />
      </div>

      {/* 近 7 天趋势（成本角标）：日级迷你 bar；老网关无 trend 字段时静默隐藏 */}
      {Array.isArray(trend) && <TrendStrip trend={trend} hasTokenData={hasTokenData} />}

      {/* 金额估算（仅当单价已配置）*/}
      {hasPrice && (
        <div className="bg-sage-50 border border-sage-200 rounded-lg px-3 py-2.5 text-xs text-sage-800">
          <div className="flex items-center gap-1.5 font-medium">
            <Icon name={I.wallet} size={14} weight="fill" />
            估算金额（单价：输入 ¥{pricePerMillion.input}/M · 输出 ¥{pricePerMillion.output}/M）
          </div>
          <div className="mt-1 font-mono text-base font-bold">
            ¥{totalCost.toFixed(4)}
          </div>
          <div className="mt-0.5 text-sage-700/80">
            输入 ¥{(costIn ?? 0).toFixed(4)} · 输出 ¥{(costOut ?? 0).toFixed(4)}
          </div>
        </div>
      )}

      {/* token 数据缺口说明 */}
      {!hasTokenData && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-2">
          Token 未统计：审计账本未记录模型 usage（token 列恒 0）。当前展示耗时 / 次数 / 工具调用为真实执行负载。
        </div>
      )}

      {/* 阶段级分布 */}
      <div>
        <div className="text-xs font-semibold text-zinc-600 mb-1.5 flex items-center justify-between">
          <span className="inline-flex items-center gap-1">
            <Icon name={I.chartBar} size={13} />
            阶段耗时分布
          </span>
          <span className="text-[11px] text-zinc-400 font-normal">按累计耗时</span>
        </div>
        <div className="space-y-1.5">
          {perStage.length === 0 ? (
            <div className="text-xs text-zinc-400 py-2">审计账本暂无数据（runs: 0）</div>
          ) : (
            perStage.slice(0, 12).map((s) => {
              const aspice = STAGE_TABLE[s.token as keyof typeof STAGE_TABLE]?.aspice || '';
              const pct = Math.max(2, Math.round((s.elapsedMs / maxElapsed) * 100));
              return (
                <div key={s.token} className="flex items-center gap-2 text-xs">
                  <span className="w-36 shrink-0 font-mono text-zinc-600 truncate" title={`${s.token}${aspice ? ` · ${aspice}` : ''}`}>
                    {s.token === '_general' ? '通用咨询' : s.token}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="h-2.5 bg-zinc-100 rounded overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded"
                        style={{ width: `${pct}%` }}
                        title={`${s.token} 耗时 ${fmtMs(s.elapsedMs)}`}
                      />
                    </div>
                  </div>
                  <span className="w-16 shrink-0 text-right text-zinc-500 tabular-nums">
                    {fmtMs(s.elapsedMs)}
                  </span>
                  <span className="w-12 shrink-0 text-right text-zinc-400 tabular-nums" title="工具调用次数">
                    ×{s.toolCalls}
                  </span>
                  {hasTokenData && (
                    <span className="w-14 shrink-0 text-right text-zinc-400 tabular-nums" title="token 数">
                      {fmtNum(s.promptTokens + s.completionTokens)}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 数据缺口说明 */}
      {note && (
        <div className="text-[11px] text-zinc-400 leading-relaxed">{note}</div>
      )}
    </div>
  );
};

const StatTile: React.FC<{
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  tone: 'main' | 'neutral';
}> = ({ label, value, sub, icon, tone }) => {
  const tones = {
    main: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    neutral: 'border-zinc-200 bg-white text-zinc-800',
  };
  return (
    <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-2.5 ${tones[tone]}`}>
      <span className={tone === 'main' ? 'text-emerald-600' : 'text-zinc-400'}>
        <Icon name={icon} size={18} weight="fill" />
      </span>
      <div className="min-w-0">
        <div className="text-base font-bold leading-none tabular-nums truncate" title={value}>
          {value}
        </div>
        <div className="text-xs mt-1 opacity-80 truncate">{label}</div>
        {sub && <div className="text-[10px] opacity-60 truncate">{sub}</div>}
      </div>
    </div>
  );
};
