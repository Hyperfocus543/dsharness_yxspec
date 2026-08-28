// =============================================================================
// SelfIterationCard — 「自迭代评分」功能卡
// 数据源：网关 /api/self-iteration（只读 @yxspec/self-iteration 插件落盘的
//   run-state.json + runtime-data/trajectory/self_iteration/*.jsonl）。
// 能力：
//   · 顶部：当前 run 摘要（阶段/轮次/基线/目标/收敛状态）+ 刷新
//   · 轮次瀑布：每阶段一条评分线（总分 + 等级 + 弱项 + 门禁），带 verdict 判定
//     （continue 琥珀 / converge 绿 / degrade 红），score 与 round 分色标识
//   · 空态：从未跑过自迭代 → 「尚未执行自迭代」提示（不阻塞驾驶舱）
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { EmptyState, Icon, SectionLabel } from '../ui';
import { I } from '../ui/icons';
import {
  fetchSelfIteration,
  type SelfIterationOverview,
  type SelfIterationRound,
  type SelfIterationStage,
} from '../../utils/ipc';

/** verdict → 文案 + 色标（与轨迹面板语义对齐：continue 琥珀 / converge 绿 / degrade 红） */
const VERDICT_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
  continue: { label: '继续', cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  converge: { label: '收敛', cls: 'bg-sage-100 text-sage-700', dot: 'bg-sage-500' },
  converge_by_maxiter: { label: '用满收敛', cls: 'bg-sage-100 text-sage-700', dot: 'bg-sage-500' },
  degrade: { label: '降级', cls: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
};

function verdictStyle(v: string | null): { label: string; cls: string; dot: string } {
  return (v && VERDICT_STYLE[v]) || { label: v || '—', cls: 'bg-zinc-100 text-zinc-500', dot: 'bg-zinc-400' };
}

/** run 状态 → 中文（running / converged / dropped / stopped） */
const RUN_STATUS: Record<string, string> = {
  running: '进行中',
  converged: '已收敛',
  dropped: '已放弃',
  stopped: '已停止',
};

/** 等级 A~D → 色标（弱项色语义；A 深绿 / B 绿 / C 琥珀 / D 红） */
const LEVEL_STYLE: Record<string, string> = {
  A: 'bg-sage-100 text-sage-700 border-sage-300',
  B: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  C: 'bg-amber-100 text-amber-700 border-amber-300',
  D: 'bg-red-100 text-red-700 border-red-300',
};

/** 有分值的轮次（total 为数字）——评分趋势条数据源（纯读，无新接口）。 */
function scoredRounds(s: SelfIterationStage): SelfIterationRound[] {
  return s.rounds.filter((r) => r.total != null && Number.isFinite(r.total));
}

/**
 * 阶段评分趋势条：把各轮 total 画成一条迷你柱状趋势（新→旧），
 * 一眼看清自迭代分数是在涨还是跌。数据源 = 该阶段已有轮次留痕（纯前端聚合）。
 *   · 只画有 total 的轮次；单轮/无分值 → 不渲染（不喧宾夺主）
 *   · 柱高 = 分值 / 该阶段历史最高（高分满格，跨阶段可比）
 *   · 趋势徽标：末轮 ≥ 历史峰值 → 绿色「新高」；末轮 < 峰值 → 琥珀「回落」；
 *     与基线相比涨跌用「↑/↓/＝」标在标题行
 *   · 每个柱 tooltip = R<N> + 总分 + 等级 + 收敛态；末轮判定 reason 尾行展示
 * UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
 */
const ScoreTrend: React.FC<{ s: SelfIterationStage }> = ({ s }) => {
  const rows = scoredRounds(s);
  if (rows.length < 2) return null; // 单轮无趋势可看，保持静默
  const totals = rows.map((r) => r.total as number);
  const baseline = totals[0]; // 首轮打分 = 基线（与判定逻辑同口径）
  const last = totals[totals.length - 1];
  const maxTotal = Math.max(...totals);
  const lastRow = rows[totals.length - 1]; // 末轮留痕（含判定），tooltip/reason 汇总用
  const isPeak = last >= maxTotal;
  const dirLabel = last > baseline ? '↑' : last < baseline ? '↓' : '＝';
  const dirTitle = `末轮 ${last} 相对首轮基线 ${baseline}：${last > baseline ? '提升' : last < baseline ? '回落' : '持平'}`;

  // 柱高阈值：分值 0~100 时给最低可见高度，避免"有分但柱不可见"（纯 UI 保障）
  const pct = (v: number) => Math.max(v > 0 ? 6 : 0, Math.round((v / maxTotal) * 100));

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-2.5 py-2 space-y-1">
      <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
        <span className="inline-flex items-center gap-1 shrink-0">
          评分趋势
          <span className="text-zinc-300">·</span>
          <span className="tabular-nums">R{rows[0].round}→R{rows[rows.length - 1].round}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 tabular-nums shrink-0" title={dirTitle}>
          <span
            className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded font-medium ${
              isPeak
                ? 'bg-sage-100 text-sage-700'
                : 'bg-amber-100 text-amber-700'
            }`}
            title={isPeak ? `末轮 ${last} = 历史峰值，趋势向好` : `末轮 ${last} 低于历史峰值 ${maxTotal}（本轮回落）`}
          >
            {isPeak ? '新高' : '回落'}
            <span className="font-mono">{last}</span>
          </span>
          <span className="text-zinc-400">{dirLabel}</span>
          <span className="text-zinc-300">·</span>
          <span className="text-zinc-500">最佳 <span className="font-semibold text-zinc-600">{maxTotal}</span></span>
        </span>
      </div>
      <div className="flex items-end gap-1.5 h-7" role="img" aria-label={`阶段 ${s.token} 评分趋势：${rows.length} 轮，基线 ${baseline}，末轮 ${last}`}>
        {rows.map((r) => {
          const v = r.total as number;
          return (
            <div key={`${r.round}-${r.type}`} className="relative flex-1 min-w-0 flex flex-col items-center gap-0.5 group">
              <div className="w-full flex items-end justify-center flex-1" style={{ height: 'calc(100% - 12px)' }}>
                <div
                  className={`w-full max-w-[16px] rounded-sm transition-all ${
                    isPeak && v >= maxTotal ? 'bg-emerald-500 group-hover:bg-emerald-600' : 'bg-zinc-300 group-hover:bg-zinc-400'
                  }`}
                  style={{ height: `${pct(v)}%` }}
                />
              </div>
              <span className="text-[9px] text-zinc-400 tabular-nums leading-none">R{r.round}</span>
              <span
                className="absolute -top-6 left-1/2 -translate-x-1/2 z-30 whitespace-nowrap rounded border border-zinc-200 bg-white shadow px-1.5 py-0.5 text-[10px] tabular-nums opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              >
                R{r.round} 总分 <span className="font-semibold text-zinc-700">{v}</span>
                {r.level ? (
                  <span className={`ml-1 px-0.5 rounded text-[9px] font-semibold border ${LEVEL_STYLE[r.level] || 'bg-zinc-100 text-zinc-500 border-zinc-200'}`}>
                    {r.level}
                  </span>
                ) : null}
                {r.verdict === 'converge' || r.verdict === 'converge_by_maxiter' ? (
                  <span className="ml-1 text-sage-700">收敛</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      {lastRow?.reason ? (
        <div className="text-[10px] text-zinc-400 truncate leading-tight" title={lastRow.reason}>
          {lastRow.reason}
        </div>
      ) : null}
    </div>
  );
};

/** ISO → 相对时间文案（刚刚 / N 分钟前 / N 小时前 / N 天前） */
function relTimeOf(ts: string | null | undefined): string {
  if (!ts) return '—';
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return '—';
  const diffMin = Math.floor((Date.now() - t) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} 小时前`;
  return `${Math.floor(diffH / 24)} 天前`;
}

/** 单条轮次留痕行：round + 类型（评分/判定）+ 总分 + 等级 + 弱项 + verdict */
const RoundRow: React.FC<{ r: SelfIterationRound }> = ({ r }) => {
  const v = verdictStyle(r.verdict);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs hover:border-emerald-300 transition-all group">
      <span className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 font-mono" title={`第 ${r.round} 轮`}>
        R{r.round}
      </span>
      <span
        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
          r.type === 'score' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-50 text-zinc-500 border-zinc-200'
        }`}
        title={r.type === 'score' ? '确定性打分留痕（score_aggregate.py）' : '轮次判定留痕（状态机）'}
      >
        {r.type === 'score' ? '打分' : '判定'}
      </span>
      {r.total != null && (
        <span className="shrink-0 font-mono font-semibold text-zinc-800 tabular-nums" title="总分">
          {r.total}
        </span>
      )}
      {r.level && (
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${LEVEL_STYLE[r.level] || 'bg-zinc-100 text-zinc-500 border-zinc-200'}`} title="等级">
          {r.level}
        </span>
      )}
      <span className="shrink-0 inline-flex items-center gap-1">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${v.dot}`} aria-hidden />
        <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${v.cls}`}>{v.label}</span>
      </span>
      {r.baselineTotal != null && r.round > 1 && (
        <span className="shrink-0 text-[10px] text-zinc-400 tabular-nums" title="比较基线（首轮打分冻结）">
          基线 {r.baselineTotal}
        </span>
      )}
      {r.weak.length > 0 && (
        <span className="min-w-0 truncate text-[10px] text-zinc-400" title={`弱项：${r.weak.join('、')}`}>
          弱项 {r.weak.join('、')}
        </span>
      )}
      <span className="ml-auto shrink-0 text-[10px] text-zinc-400 tabular-nums">{relTimeOf(r.at)}</span>
    </div>
  );
};

/** 单阶段评分线：阶段名 + 最近状态 + 轮次瀑布（新→旧 或 全部） */
const StageBlock: React.FC<{ s: SelfIterationStage }> = ({ s }) => {
  // 轮次留痕时间升序，展示新→旧（最近一次判定在最上）
  const rows = [...s.rounds].reverse();
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-mono text-xs" title={s.token}>
          {s.token}
        </span>
        {s.aspice && <span className="shrink-0 text-[10px] text-zinc-400 font-mono">{s.aspice}</span>}
        {s.converged && (
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-sage-100 text-sage-700 border border-sage-200 text-[10px] font-medium inline-flex items-center gap-1" title="已收敛（goal 达成或轮次用满）">
            <Icon name={I.check} size={10} weight="fill" />
            已收敛
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-zinc-400 tabular-nums">{s.rounds.length} 轮留痕</span>
      </div>
      {/* 评分趋势（≥2 轮有分值才渲染）：一眼看清自迭代分数走向 */}
      <ScoreTrend s={s} />
      <div className="space-y-1">
        {rows.map((r, i) => (
          <RoundRow key={`${r.round}-${r.type}-${i}`} r={r} />
        ))}
      </div>
    </div>
  );
};

export const SelfIterationCard: React.FC = () => {
  const [data, setData] = React.useState<SelfIterationOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    setLoadError(null);
    const d = await fetchSelfIteration();
    if (d) {
      setData(d);
    } else {
      setData(null);
      setLoadError('网关未响应或未启动');
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSelfIteration()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        if (!d) setLoadError('网关未响应或未启动');
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setLoadError('加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await load({ quiet: true });
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div
        className="border border-zinc-200 rounded-lg bg-white p-3 space-y-2"
        role="status"
        aria-busy="true"
        aria-label="正在加载自迭代评分"
      >
        <div className="h-4 bg-zinc-200 rounded animate-pulse w-1/3" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 bg-zinc-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="p-4 space-y-3">
        <div className="border border-zinc-200 rounded-lg bg-white">
          <EmptyState
            icon={I.chartBar}
            title="自迭代评分不可用"
            hint="网关未响应或未启动（/api/self-iteration 拿不到数据）。确认 server.mjs 运行中，再点下方重试。"
          />
        </div>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-60"
          >
            <Icon name={I.refresh} size={11} />
            重试
          </button>
        </div>
      </div>
    );
  }

  const { state, stages } = data;
  const empty = stages.length === 0;

  return (
    <div className="p-4 space-y-4">
      {/* 标题行 + 刷新 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-emerald-600">
            <Icon name={I.chartBar} size={15} weight="fill" />
          </span>
          <span className="text-sm font-bold text-zinc-800">自迭代评分</span>
          {state && (
            <span className="text-xs text-zinc-400">
              （{state.stage || '—'} · 第 {state.currentRound} 轮）
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
          title="刷新自迭代评分"
        >
          <Icon name={I.refresh} size={11} />
          {refreshing ? '刷新中…' : '刷新'}
        </button>
      </div>

      {/* 当前 run 摘要（有 run-state 才展示） */}
      {state && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Icon name={I.timer} size={13} />
              当前自迭代
            </div>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
                state.converged ? 'bg-sage-100 text-sage-700' : 'bg-amber-100 text-amber-700'
              }`}
              title={state.status}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${state.converged ? 'bg-sage-500' : 'bg-amber-500'}`} aria-hidden />
              {RUN_STATUS[state.status] || state.status || '—'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <SummaryTile label="阶段" value={state.stage || '—'} mono />
            <SummaryTile label="轮次" value={state.currentRound ? `R${state.currentRound}/${state.maxIter}` : '—'} />
            <SummaryTile label="基线" value={state.baselineTotal != null ? String(state.baselineTotal) : '—'} mono />
            <SummaryTile label="最优" value={state.bestTotal != null ? String(state.bestTotal) : '—'} mono />
          </div>
          {state.goal && (
            <div className="text-[11px] text-zinc-400 truncate" title={state.goal}>
              目标：{state.goal}
            </div>
          )}
          {state.lastScore && (
            <div className="text-[11px] text-zinc-500">
              本轮打分暂存：总分 <span className="font-mono font-semibold text-emerald-700">{state.lastScore.total ?? '—'}</span>
              {state.lastScore.level && (
                <span className={`ml-1 px-1 py-0.5 rounded text-[10px] font-semibold border ${LEVEL_STYLE[state.lastScore.level] || 'bg-zinc-100 text-zinc-500 border-zinc-200'}`}>
                  {state.lastScore.level}
                </span>
              )}
              {state.lastScore.weak.length > 0 && (
                <span className="text-zinc-400"> · 弱项 {state.lastScore.weak.join('、')}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* 阶段评分瀑布 */}
      <div className="space-y-3">
        <SectionLabel>阶段评分</SectionLabel>
        {empty ? (
          <div className="text-xs text-zinc-400 py-6 text-center border border-dashed border-zinc-200 rounded-lg space-y-1">
            <div>尚未执行过自迭代（无留痕记录）</div>
            <div className="text-[11px]">
              派活 /yxspec:self-iterate 命令后，每轮打分与判定会写入 runtime-data/trajectory/self_iteration/。
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {stages.map((s) => (
              <StageBlock key={s.token} s={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const SummaryTile: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="rounded-lg border border-zinc-200 bg-white px-2.5 py-2">
    <div className={`text-sm font-bold leading-none tabular-nums truncate text-zinc-800 ${mono ? 'font-mono' : ''}`} title={value}>
      {value}
    </div>
    <div className="text-[11px] mt-1 text-zinc-400 truncate">{label}</div>
  </div>
);
