// =============================================================================
// SelfIterationCard — 「自迭代评分」功能卡
// 数据源：网关 /api/self-iteration（只读 @yxspec/self-iteration 插件落盘的
//   run-state.json + runtime-data/trajectory/self_iteration/*.jsonl）。
// 能力：
//   · 顶部：当前 run 摘要（阶段/轮次/基线/目标/收敛状态）+ 刷新
//   · 启动表单默认阶段预填：表单为空时优先取当前 run 阶段（run-state.stage），
//     其次取驾驶舱当前阶段（defaultStage prop；废弃/变体阶段排除），手动改过后不再覆盖
//   · 启动表单轮数 run 预算预填：同阶段 run 进行中（断点恢复已默认勾选）时，轮数框
//     预填该 run 的 maxIter 预算 + 「续跑预算」角标——续跑时插件用表单值覆盖预算，
//     默认 3 会让大预算 run 缩水；预填让「所见 = 所跑」，手动改过后不再覆盖
//   · 启动表单评估模式 run mode 预填：续跑该 run（framework 评框架效率）时模式
//     切到 framework + 「续跑模式」角标——续跑回落默认 product 会让同一 run 的
//     评分维度前后不一致，框架效率判定（--eval-framework）也无从对比；手动改过后不再覆盖
//   · 派活命令预览：表单实况（阶段/轮数/目标/模式/断点恢复）实时派生为即将派发的
//     /yxspec:self-iterate 命令（复用 buildSelfIterateCommand 纯函数），点启动前一眼
//     核对「实际要跑什么」，所见 = 所跑；空阶段 → 占位提示，发送期间隐藏
//   · 轮次瀑布：每阶段一条评分线（总分 + 等级 + 弱项 + 门禁），带 verdict 判定
//     （continue 琥珀 / converge 绿 / degrade 红），score 与 round 分色标识
//   · 评分 × git 检查点：每轮评分行对齐该评分时刻的阶段执行 commit + tag
//     （/api/git/commits 同数据源，纯前端 traceAtTime 派生），hover 预览相对
//     上一阶段执行的改动 —— 自迭代分数落在哪个代码检查点上一目了然；收尾 tag
//     展示短标签 `stage/seq` + 摘要（utils/gitTagName，变体阶段不混淆）
//   · 空态：从未跑过自迭代 → 「尚未执行自迭代」提示（不阻塞驾驶舱）
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { EmptyState, GitDiffPreview, Icon, SectionLabel } from '../ui';
import { I } from '../ui/icons';
import {
  fetchSelfIteration,
  getGitCommits,
  type GitStageTrace,
  type SelfIterationOverview,
  type SelfIterationRound,
  type SelfIterationStage,
} from '../../utils/ipc';
import { gitTraceBase, traceAtTime } from '../../utils/gitTrace';
import { yxspecTagOf } from '../../utils/gitTagName';
import {
  summarizeStages,
  convergedCount,
  runningCount,
  degradedCount,
  bestBadgeLabel,
  worstBadgeLabel,
  type StageRunSummary,
} from '../../utils/selfIterationSummary';
import { useStageDispatch } from '../../hooks/useStageDispatch';
import { useToastStore } from '../../store/toastStore';
import { useGitStore } from '../../store/gitStore';
import { buildSelfIterateCommand, buildSelfIteratePreview, clampMaxIterInput, type SelfIterateFormState } from '../../utils/selfIterateCommand';
import { shouldDefaultResume, defaultRunIteration, defaultRunGoal, defaultRunMode } from '../../utils/selfIterationResume';
import { STAGE_ORDER } from '../../data/stage-mapping';

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

/** 有分值的轮次（total 为数字）——评分趋势条数据源（纯读，无新接口）。
 *  每轮去重成一条：rounds 是 score/v1 与 round/v1 两条留痕合并的（同轮 score 在
 *  round 前），趋势条按轮画柱、柱高取该轮总分 —— 同轮两条一起画会把一轮画成两根
 *  柱、R 标签重复。取 round 类型（含 verdict/baseline 判定信息）优先，仅有 score
 *  时退回它；每轮恒一条，柱 key 用 r.round 稳定。 */
function scoredRounds(s: SelfIterationStage): SelfIterationRound[] {
  const byRound = new Map<number, SelfIterationRound>();
  for (const r of s.rounds) {
    if (r.total == null || !Number.isFinite(r.total)) continue;
    const cur = byRound.get(r.round);
    if (!cur || r.type === 'round') byRound.set(r.round, r); // 已有同轮 → round 判定留痕优先
  }
  return [...byRound.values()].sort((a, b) => a.round - b.round);
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
            <div key={r.round} className="relative flex-1 min-w-0 flex flex-col items-center gap-0.5 group">
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

/** commit hash 缩写：保留前 8 位，其余折叠 */
function shortHash(h: string | null | undefined): string {
  if (!h) return '—';
  return h.length > 12 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
}

/** 评分 × git 检查点：该轮评分时刻的阶段执行 commit + tag（纯前端 traceAtTime 派生）。
 *  数据源 = SelfIterationCard 已拉取的 getGitCommits(stage)（与 Git 工作区管控卡 /
 *  轨迹瀑布同数据源，零新接口）；git 不可用/无留痕/无 commit → 不渲染（静默降级）。
 *  hover commit 徽标 → 共享 GitDiffPreview：展示该 commit 相对上一阶段执行的改动，
 *  与轨迹瀑布 commit 徽标同交互（至多一个浮层）。 */
const StageTraceBadge: React.FC<{
  trace: GitStageTrace | null;
  /** diff 基线：比该检查点更早的最近一次执行 commit（无 → null，降级提示） */
  base: string | null;
  open: boolean;
  onHover: (open: boolean) => void;
  /** 目标工作区根（diff 按活动 root 拉） */
  root?: string | null;
}> = ({ trace, base, open, onHover, root = null }) => {
  if (!trace?.commit) return null;
  // 收尾 tag 可读化：yxspec/<stage>/<seq> → 短标签 + 摘要；仅解析真正留痕 tag，
  // 非 yxspec 自定义 tag → 仍走裸展示（避免误标阶段收尾）。
  const yxTag = trace.tag ? yxspecTagOf(trace) : null;
  return (
    <>
      <span
        className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-mono text-[10px] hover:bg-emerald-50 hover:text-emerald-700 transition-all cursor-help"
        title={[
          `该轮评分时刻最新 commit：${trace.commitFull ?? trace.commit}`,
          trace.subject ? `提交说明：${trace.subject}` : '（无提交说明）',
          '悬停查看相对上一阶段执行的改动',
        ].join('\n')}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
      >
        {shortHash(trace.commit)}
      </span>
      {yxTag && (
        <span
          className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono text-[10px] border border-emerald-200/70"
          title={[
            yxTag.summary,
            yxTag.commit ? `指向 commit：${yxTag.commit}` : null,
          ].filter((l): l is string => Boolean(l)).join('\n')}
        >
          {yxTag.short}
        </span>
      )}
      {!yxTag && trace.tag && (
        <span
          className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono text-[10px] border border-emerald-200/70"
          title={`该轮评分时刻的 commit 打上了 tag：${trace.tag}`}
        >
          {trace.tag}
        </span>
      )}
      <GitDiffPreview base={base} target={trace.commit || null} open={open} root={root} />
    </>
  );
};

/** 单条轮次留痕行：round + 类型（评分/判定）+ 总分 + 等级 + 弱项 + verdict + git 检查点 */
const RoundRow: React.FC<{
  r: SelfIterationRound;
  /** 该轮评分时刻的阶段执行检查点（无 → null，不渲染 git 徽标） */
  trace?: GitStageTrace | null;
  /** diff 基线：比该检查点更早的最近一次执行 commit（无 → null，GitDiffPreview 首条降级提示） */
  traceBase?: string | null;
  /** 目标工作区根（diff 按活动 root 拉） */
  root?: string | null;
}> = ({ r, trace = null, traceBase = null, root = null }) => {
  const v = verdictStyle(r.verdict);
  // 评分 × git：hover 展开该 commit 相对上一阶段执行的改动（至多一个浮层，与轨迹瀑布同交互）
  const [gitOpen, setGitOpen] = React.useState(false);
  return (
    <div className="relative flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs hover:border-emerald-300 transition-all group">
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
      {/* 子分构成：Master（主流程成熟度）· Stage（阶段产物契合度）。
          score_aggregate 确定性评分按 Master/Stage/Total 三维输出，网关已透传，
          这里把总分拆成两个子分一眼可见——总分掉分时能判断掉在流程还是产物维度。
          判定轮（round 类型）无子分 → 不渲染；score 轮才有。 */}
      {(r.master != null || r.stageScore != null) && (
        <span
          className="shrink-0 inline-flex items-center gap-1 px-1 py-0.5 rounded bg-zinc-50 border border-zinc-200 text-[10px] font-mono text-zinc-500 tabular-nums"
          title={`Master ${r.master ?? '—'}（主流程成熟度）· Stage ${r.stageScore ?? '—'}（阶段产物契合度）——score_aggregate 确定性评分`}
        >
          <Icon name={I.stack} size={10} className="text-zinc-400 shrink-0" />
          <span>M{r.master ?? '—'}</span>
          <span className="text-zinc-300">·</span>
          <Icon name={I.fileCode} size={10} className="text-zinc-400 shrink-0" />
          <span>S{r.stageScore ?? '—'}</span>
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
      {/* 评分 × git：该轮评分时刻的 commit + tag（hover 看相对上一阶段执行的改动） */}
      <StageTraceBadge trace={trace} base={traceBase} open={gitOpen} onHover={setGitOpen} root={root} />
    </div>
  );
};

/** 单阶段 run 汇总徽标（跨阶段横截面）：收敛/退化色点 + 最佳分 + 最差轮次。
 *  数据源 = 本卡已拉取的 SelfIterationOverview（纯前端聚合，零新接口）。 */
const StageRunBadge: React.FC<{ s: StageRunSummary }> = ({ s }) => {
  const bestLabel = bestBadgeLabel(s);
  const worstLabel = worstBadgeLabel(s);
  if (!bestLabel && !worstLabel) return null; // 无有分轮 → 不占位（静默降级）
  const dot = s.degraded ? 'bg-red-500' : s.converged ? 'bg-sage-500' : 'bg-amber-500';
  const dotTitle = s.degraded
    ? '该阶段有轮次被判退化（低于基线回滚）'
    : s.converged
      ? '该阶段已收敛'
      : '该阶段仍在迭代';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-1.5 py-1 rounded-md border border-zinc-200 bg-white text-[10px] font-mono text-zinc-600"
      title={[
        s.degraded ? '状态：退化（低于基线回滚）' : s.converged ? '状态：已收敛' : '状态：迭代中',
        bestLabel ? `最佳：${bestLabel}` : null,
        worstLabel ? `最差轮：${worstLabel}` : null,
      ].filter((l): l is string => Boolean(l)).join(' · ')}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} aria-hidden title={dotTitle} />
      <span className="max-w-[96px] truncate" title={s.token}>
        {s.token}
      </span>
      {bestLabel && <span className="text-sage-700 shrink-0">↑{bestLabel}</span>}
      {worstLabel && <span className="text-zinc-400 shrink-0">↓{worstLabel}</span>}
    </span>
  );
};

/** 单阶段评分线：阶段名 + 最近状态 + 轮次瀑布（新→旧 或 全部）。
 *  评分 × git 检查点：mount 时并行拉取该阶段 git 留痕（/api/git/commits，与
 *  Git 工作区管控卡 / 轨迹瀑布同数据源），每轮评分行对齐其评分时刻的 commit + tag；
 *  失败静默降级（不渲染 git 徽标，不阻塞评分瀑布）。
 *  启动联动：running=true（本次启动的 dispatch 进行中）→ 头部加「运行中」徽标，
 *  轮次留痕由启动联动轮询实时刷新，无需手动点「刷新」。 */
const StageBlock: React.FC<{ s: SelfIterationStage; running?: boolean }> = ({ s, running = false }) => {
  // 该阶段 git 留痕（阶段↔commit↔tag；git 不可用/无留痕 → null，行内不渲染）
  const [gitTraces, setGitTraces] = React.useState<GitStageTrace[] | null>(null);
  // 活动工作区 root：留痕 + commit diff 按活动 root 拉（多工作区不串根）
  const activeRoot = useGitStore((s) => s.activeWorkspace?.root ?? null);
  React.useEffect(() => {
    let cancelled = false;
    setGitTraces(null); // 切阶段（key 变化重挂）时清空，避免旧阶段留痕错位
    getGitCommits(s.token, activeRoot)
      .then((traces) => {
        if (!cancelled && traces) setGitTraces(traces);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [s.token, activeRoot]);

  // 每轮评分 → 对齐的阶段执行检查点 + diff 基线（纯前端派生；无 → null 不渲染）。
  // base = 比该检查点更早的最近一次执行 commit（gitTraceBase 同口径：相邻执行 = 一个 diff 单元）。
  const traceByRound = React.useMemo(() => {
    const m = new Map<number, { trace: GitStageTrace | null; base: string | null }>();
    if (!gitTraces || gitTraces.length === 0) return m;
    for (const r of s.rounds) {
      const trace = traceAtTime(gitTraces, r.at);
      m.set(r.round, { trace, base: trace ? gitTraceBase(gitTraces, trace.seq) : null });
    }
    return m;
  }, [gitTraces, s.rounds]);

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
        {running && (
          <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-300 text-[10px] font-medium" title="本次启动的迭代进行中：轮次留痕实时刷新，无需手动点刷新">
            <Icon name={I.clock} size={10} weight="fill" className="animate-pulse" />
            运行中
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-zinc-400 tabular-nums">{s.rounds.length} 轮留痕</span>
      </div>
      {/* 评分趋势（≥2 轮有分值才渲染）：一眼看清自迭代分数走向 */}
      <ScoreTrend s={s} />
      <div className="space-y-1">
        {rows.map((r, i) => {
          const g = traceByRound.get(r.round);
          return (
            <RoundRow
              key={`${r.round}-${r.type}-${i}`}
              r={r}
              trace={g?.trace ?? null}
              traceBase={g?.base ?? null}
              root={activeRoot}
            />
          );
        })}
      </div>
    </div>
  );
};

/** 新阶段启动占位：目标阶段尚无任何留痕（stages 空 / 未含该阶段）时，瀑布渲染「运行中」
 *  占位块 —— 否则启动进行中（表单已显示「已执行 Ns」）瀑布仍显示「尚未执行过自迭代」，
 *  与「正在跑」的事实自相矛盾，还误引导用户再启动一次。复用 StageBlock 的运行中徽标
 *  语义（emerald + animate-pulse clock + 已执行秒数），首轮打分留痕长出后自动被真实块取代。 */
const RunningStageBlock: React.FC<{ token: string; elapsedSec: number; divRef?: React.Ref<HTMLDivElement> }> = ({ token, elapsedSec, divRef }) => (
  <div
    ref={divRef}
    className="rounded-xl ring-2 ring-emerald-300/80 shadow-sm space-y-1"
  >
    <div className="flex items-center gap-2 min-w-0">
      <span className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-mono text-xs" title={token}>
        {token}
      </span>
      <span
        className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-300 text-[10px] font-medium"
        title="本次启动的迭代进行中：首轮打分完成后该阶段块自动出现"
      >
        <Icon name={I.clock} size={10} weight="fill" className="animate-pulse" />
        运行中
      </span>
      <span
        className="ml-auto shrink-0 text-[10px] text-zinc-400 tabular-nums"
        title="本轮派活已执行时长（后台任务运行中；表单上方已有同源计时）"
      >
        已执行 {elapsedSec}s
      </span>
    </div>
    <div className="text-xs text-zinc-400 border border-dashed border-emerald-200 bg-emerald-50/30 rounded-lg px-3 py-4 text-center">
      正在执行 {token} 的自迭代：新阶段暂无留痕，首轮打分完成后自动出现
    </div>
  </div>
);

export const SelfIterationCard: React.FC<{ defaultStage?: string }> = ({ defaultStage }) => {
  const [data, setData] = React.useState<SelfIterationOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  // 启动新迭代：派活通道 + 全局 toast + 表单状态（必须在任何条件 return 之前无条件调用）
  // elapsedSec：派活后台任务已执行秒数（与 NextCommand/BatchQueue/StageNode 同源），
  // 「启动中…」期间随秒实时递增，避免 3-5 分钟迭代只看到静态文案、无进度信号。
  const { dispatch, cancel, sending, cancelling, elapsedSec } = useStageDispatch();
  const pushToast = useToastStore((s) => s.push);
  const [stageSel, setStageSel] = React.useState('');
  const [maxIterSel, setMaxIterSel] = React.useState('3');
  const [modeSel, setModeSel] = React.useState<'product' | 'framework'>('product');
  const [goalSel, setGoalSel] = React.useState('');
  const [resumeSel, setResumeSel] = React.useState(false);
  // 阶段候选：排除废弃 swe_detail 与 PC 变体 swe_coding_verify_pc（与 SlashCommandMenu 同口径）
  const stageOptions = React.useMemo(
    () => STAGE_ORDER.filter((t) => t !== 'swe_detail' && t !== 'swe_coding_verify_pc'),
    [],
  );
  // 启动表单「阶段」是否已被用户改过：手动选择优先，预填只在仍为空时生效
  const stageTouchedRef = React.useRef(false);
  // 「断点恢复」是否已被用户手动改过：默认勾选判定只在用户未干预时套用
  // （手动改过 → 尊重用户选择，刷新/重挂不覆盖），与 stageTouchedRef 同范式。
  const resumeTouchedRef = React.useRef(false);
  // 「轮数」是否已被用户手动改过：run 预算预填只在用户未干预时套用
  // （续跑语义下用户打任意数字 = 有意重设预算，刷新/重挂不覆盖）。
  const maxIterTouchedRef = React.useRef(false);
  // 「收敛目标」是否已被用户手动改过：run goal 预填只在用户未干预时套用
  // （续跑语义下用户删空/另填 = 有意重设目标，刷新/重挂不覆盖）。
  const goalTouchedRef = React.useRef(false);
  // 「评估模式」是否已被用户手动改过：run mode 预填只在用户未干预时套用
  // （续跑语义下用户切到另一模式 = 有意改变评估口径，刷新/重挂不覆盖）。
  const modeTouchedRef = React.useRef(false);
  // 启动联动：本次启动目标阶段（sending 期间瀑布高亮该块 + 运行中徽标；取消/结束不残留）
  const [targetStage, setTargetStage] = React.useState('');
  // 阶段评分瀑布区 DOM 引用（启动后滚进视区，聚焦轮次瀑布）
  const waterfallRef = React.useRef<HTMLDivElement | null>(null);
  // 运行中阶段块的 DOM 引用（目标阶段存在时指向它，滚动定位更精准；新阶段无块 → 回落瀑布区头）
  const runningBlockRef = React.useRef<HTMLDivElement | null>(null);
  // sending 边沿检测：只认 false→true（本次启动）滚一次，取消/结束不重复滚
  const prevSendingRef = React.useRef(false);

  const load = React.useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    setLoadError(null);
    const d = await fetchSelfIteration();
    if (d) {
      setData(d);
    } else if (!opts?.quiet) {
      // 首次/整卡非静默加载才清空并报错；静默刷新（手动「刷新」/启动完成联动）
      // 网关瞬时失败时保留已有数据、不闪错误态 —— 与 GitWorkspaceCard 刷新
      // 「有内容可展示就不闪骨架/错误」同理念，也呼应发送期 8s 轮询（拿新才更）。
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

  // 启动表单默认阶段预填：仅当表单仍为空（未手动选过）才填 ——
  // 优先当前 run 阶段（run-state.stage，正在自迭代的阶段最该继续），
  // 其次驾驶舱当前阶段（defaultStage prop，配合「启动新迭代」入口联动）。
  // 候选须在 stageOptions 内（废弃 swe_detail / PC 变体跳过），填不进则保持空。
  // 依赖只含候选集与手动改标记：defaultStage 变化不重填（避免覆盖用户选择），
  // data 首拉完成后补填一次（初始 data=null 时 run 阶段未知，表单留空等数据）。
  React.useEffect(() => {
    if (stageTouchedRef.current || stageSel) return;
    // 数据未就绪（data=null，首拉/网关慢）时不预填：run 阶段未知，若此刻用
    // defaultStage（驾驶舱当前阶段）抢先填上，等 run-state 载入后 stageSel 已非空、
    // 本效果不会重填 —— 正在自迭代的阶段（data.state.stage）被驾驶舱当前阶段覆盖，
    // 「断点恢复」预勾也会因 shouldDefaultResume 阶段不符而失效，照常启动会误重置
    // run-state（基线/轮次丢失）。先等数据，再按「run 阶段优先 → 驾驶舱当前阶段」填。
    if (!data) return;
    const candidate = data.state?.stage || defaultStage || '';
    if (candidate && (stageOptions as readonly string[]).includes(candidate)) {
      setStageSel(candidate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageOptions, data, defaultStage]);

  // 启动表单「断点恢复」默认勾选：同阶段 run 进行中（有完成轮次、未收敛）→ 预勾
  // --resume。用户没勾就启动时，@yxspec/self-iteration 的 openRun 会因
  // `st.stage===stage && opts.resume` 不成立而 emptyState 重置 run-state：冻结基线
  // 丢失（首轮重新锚定）、轮次计数归零 —— 续跑几乎是必然意图，默认勾上防误重置。
  // 只在用户未手动改过时套用（resumeTouchedRef 之后改 → 尊重用户选择，不覆盖）；
  // 预填阶段变化后重判（同一次选阶段 → 勾选跟随），表单最终状态恒等于用户意图。
  React.useEffect(() => {
    if (resumeTouchedRef.current) return;
    const next = shouldDefaultResume(data?.state, stageSel);
    if (resumeSel !== next) setResumeSel(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, stageSel]);

  // 启动表单「轮数」run 预算预填：同阶段 run 进行中且「断点恢复」勾选（resumeSel=true）
  // 时，轮数框预填该 run 的 maxIter 预算 —— 续跑时插件 openRun 用表单值覆盖 run 预算，
  // 默认「3」会让 maxIter=10 的 run 续跑后预算缩水，而轮数框打任意数字都会静默
  // 重设预算（所见 ≠ 所跑）。预填 + 输入框旁「续跑预算」角标让预算可见可回改。
  // 只在用户未手动改过轮数（maxIterTouchedRef）且确实在续跑时套用；阶段预填后再填
  // （依赖 stageSel，阶段未定/数据未就绪时预算未知，保持默认 3 不抢先覆盖）。
  React.useEffect(() => {
    if (maxIterTouchedRef.current || !resumeSel) return;
    const runMax = defaultRunIteration(data?.state, stageSel);
    if (runMax != null && maxIterSel !== String(runMax)) setMaxIterSel(String(runMax));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, stageSel, resumeSel]);

  // 启动表单「收敛目标」run goal 预填：同阶段 run 进行中且「断点恢复」勾选
  // （resumeSel=true）时，目标框预填该 run 的 goal —— 插件 openRun 续跑分支是
  // `else if (opts.goal) st.goal = opts.goal`：表单 goal 为空时**保留** run 原目标，
  // 但空框会让用户误以为续跑会清除目标，或在空白处另填一个目标静默覆盖原判定
  // （所见 ≠ 所跑）。预填 + 输入框旁「续跑目标」角标让表单目标 = run 实际目标，
  // 与轮数预算预填（defaultRunIteration）同范式。只在用户未手动改过目标
  // （goalTouchedRef）且确实在续跑时套用；run 无目标（空串）→ 不预填，表单维持空框。
  React.useEffect(() => {
    if (goalTouchedRef.current || !resumeSel) return;
    const runGoal = defaultRunGoal(data?.state, stageSel);
    if (runGoal != null && goalSel !== runGoal) setGoalSel(runGoal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, stageSel, resumeSel]);

  // 启动表单「评估模式」run mode 预填：同阶段 run 进行中且「断点恢复」勾选
  // （resumeSel=true）且该 run 是 framework（评框架效率）时，模式切到 framework——
  // 续跑回落默认 product 会让同一 run 的评分维度前后不一致，框架效率判定
  // （--eval-framework 需先后两轮对比）也无从进行。默认 product 不回填（无差异）。
  // 只在用户未手动改过模式（modeTouchedRef）且确实在续跑时套用；run-state 无 mode
  // 字段（老 run）→ 维持 product，不误标「续跑模式」。与 defaultRunIteration /
  // defaultRunGoal 同范式（阶段预填后再填，依赖 stageSel）。
  React.useEffect(() => {
    if (modeTouchedRef.current || !resumeSel) return;
    const runMode = defaultRunMode(data?.state, stageSel);
    if (runMode && modeSel !== runMode) setModeSel(runMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, stageSel, resumeSel]);

  // 启动新迭代：拼命令 → 空阶段 warn → 派活 → 派活完自动刷新卡内数据（新轮次留痕/新 run 摘要）
  const onStart = async () => {
    if (sending) return;
    const cmd = buildSelfIterateCommand({
      stage: stageSel.trim(),
      maxIter: maxIterSel === '' ? undefined : Number(maxIterSel),
      goal: goalSel.trim(),
      mode: modeSel,
      resume: resumeSel,
    });
    // 表单仍为空：预填未生效（无 run 阶段也无驾驶舱当前阶段，或候选被排除）→
    // 明确提示用户选择，不自动跳过「启动前选阶段」这一步
    if (!cmd) { pushToast('warn', '请先选择阶段（未检测到可预填的当前阶段）'); return; }
    // 启动联动：记录本次启动目标阶段（sending 期间瀑布高亮该块 + 运行中徽标），
    // 结束/失败后清空（不残留上一次的高亮，也避免误标「运行中」）
    setTargetStage(stageSel.trim());
    const result = await dispatch(cmd);
    if (result) await load({ quiet: true });
    setTargetStage('');
  };

  // 启动联动 · 聚焦轮次瀑布：仅在「本次启动」边沿（sending false→true）滚动一次——
  // 取消/结束（true→false）不重复滚；dispatch 里 handleTaskResult 先 push 了 toast，
  // 这次 scroll 发生在同一次状态提交后，视觉顺序 toast→滚动→瀑布实时刷新，无冲突。
  // 滚动目标 = 本次启动阶段块（存在时），新阶段无块 → 回落瀑布区头部（滚动引用前滚，
  // 此时该阶段块尚未出现，滚到瀑布区头即可见首帧 + 后续实时刷新自动长出新轮次）。
  React.useEffect(() => {
    if (sending && !prevSendingRef.current) {
      const el = runningBlockRef.current ?? waterfallRef.current;
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    prevSendingRef.current = sending;
  }, [sending]);

  // 启动联动 · 运行中实时刷新：dispatch 期间每 8s 静默轮询 /api/self-iteration，
  // 每轮结束新打分/判定留痕实时长进瀑布，不用等整轮跑完再点「刷新」。
  // 用内联 fetch（而非 load）——load 在网关瞬时失败时会置 data=null 把整个卡闪成
  // 错误态；运行中轮询要「拿到新数据才更新」，网络抖动保持已有视图连续。
  // targetStage 为依赖：换目标阶段重启轮询周期（同一发送期的阶段选择不会变，实际上只触发一次）。
  React.useEffect(() => {
    if (!sending) return;
    let cancelled = false;
    const timer = setInterval(() => {
      fetchSelfIteration()
        .then((d) => {
          if (!cancelled && d) setData(d);
        })
        .catch(() => {});
    }, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, targetStage]);

  // 跨阶段 run 汇总（纯前端聚合）：收敛/退化/进行中计数 + 每阶段最佳分/最差轮。
  // 数据源 = 本卡已拉取的 SelfIterationOverview，零新接口；空数据 → 空数组，不渲染。
  // 必须在所有条件 return 之前调用（hooks 顺序恒定，防 React 报 "more hooks than previous render"）。
  const summaries = React.useMemo(() => summarizeStages(data), [data]);
  const summaryStats = React.useMemo(
    () => ({
      converged: convergedCount(summaries),
      running: runningCount(summaries),
      degraded: degradedCount(summaries),
    }),
    [summaries],
  );

  // 启动表单实况 → 派活命令预览（纯前端派生，零接口）：
  // 表单每一项（阶段/轮数/目标/模式/断点恢复）都是派活命令的一个 flag，改动即重算，
  // 让「实际要跑什么」在点启动前一眼可见——启动新迭代不再是把命令交出去的黑盒。
  // 与 onStart 的 buildSelfIterateCommand 调用同构（见 utils/selfIterateCommand.buildSelfIteratePreview），
  // 所见 = 所跑；空阶段 → 空串（预览区降级提示）。必须在所有条件 return 之前调用
  // （hooks 顺序恒定），空串回退在渲染层处理。
  const previewCmd = React.useMemo(
    () =>
      buildSelfIteratePreview({
        stage: stageSel,
        maxIter: maxIterSel,
        goal: goalSel,
        mode: modeSel,
        resume: resumeSel,
      } satisfies SelfIterateFormState),
    [stageSel, maxIterSel, goalSel, modeSel, resumeSel],
  );

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

      {/* 启动新迭代：选阶段/轮数/评估模式/收敛目标/断点 → 一键派活 /yxspec:self-iterate（网关插件） */}
      <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Icon name={I.play} size={13} />
          启动新迭代
          <span className="ml-auto text-[10px] text-zinc-300">
            轮数 1–10
            {stageSel && <span className="ml-1 text-zinc-400">· 阶段已预填</span>}
          </span>
        </div>
        {/* 评估模式：产物（默认，评阶段产物）/ 框架（评框架效率，复用 --eval-framework 对比）。
            选中态 emerald，照 StageCockpit ViewTabs 分段样式（bg-zinc-100 底 + 选中 bg-white shadow） */}
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
          <span className="shrink-0">模式</span>
          <div className="flex items-center gap-1 bg-zinc-100 border border-zinc-200 rounded p-0.5 w-fit" role="group" aria-label="评估模式">
            <button
              type="button"
              onClick={() => {
                modeTouchedRef.current = true; // 用户手动切模式 → 不再按 run mode 覆盖
                setModeSel('product');
              }}
              aria-pressed={modeSel === 'product'}
              disabled={sending}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all focus-visible:outline-none active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${
                modeSel === 'product' ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:bg-white/50'
              }`}
              title="默认：评分本阶段产物"
            >
              <Icon name={I.cube} size={11} />
              产物
            </button>
            <button
              type="button"
              onClick={() => {
                modeTouchedRef.current = true; // 用户手动切模式 → 不再按 run mode 覆盖
                setModeSel('framework');
              }}
              aria-pressed={modeSel === 'framework'}
              disabled={sending}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all focus-visible:outline-none active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${
                modeSel === 'framework' ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:bg-white/50'
              }`}
              title="评分框架代码本身效率，复用 --eval-framework 效率对比"
            >
              <Icon name={I.fileCode} size={11} />
              框架
            </button>
          </div>
          {/* 续跑模式角标：断点恢复勾选 + 该 run 是 framework（未手动改过模式）时标注
              「续跑模式 = framework」——与续跑预算/续跑目标角标同范式，让表单模式 =
              run 实际模式（所见 = 所跑）。用户手动改过 / 取消断点恢复 → 不再提示。 */}
          {resumeSel && !modeTouchedRef.current && modeSel === 'framework' && (
            <span
              className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/70"
              title="该 run 的评估模式为 framework（评框架效率）：续跑时模式以此为准。手动切换将改变评估口径。"
            >
              <Icon name={I.fileCode} size={9} weight="fill" />
              续跑模式
            </span>
          )}
        </div>
        {modeSel === 'framework' && (
          <div className="text-[10px] text-zinc-400 pl-1">
            框架模式：优化框架代码本身，复用同事 --eval-framework 效率对比
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label className="flex flex-col gap-1 text-[10px] text-zinc-400">
            阶段
            <select
              value={stageSel}
              onChange={(e) => {
                if (sending) return;
                stageTouchedRef.current = true;
                setStageSel(e.target.value);
              }}
              disabled={sending}
              className="px-2 py-1 rounded border border-zinc-200 bg-white text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-zinc-50"
            >
              <option value="" disabled hidden>选择阶段</option>
              {stageOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-zinc-400">
            轮数
            <input
              type="number"
              min={1}
              max={10}
              value={maxIterSel}
              onChange={(e) => {
                if (sending) return;
                maxIterTouchedRef.current = true; // 用户手动改轮数 → 不再按 run 预算覆盖
                setMaxIterSel(clampMaxIterInput(e.target.value));
              }}
              disabled={sending}
              className="px-2 py-1 rounded border border-zinc-200 bg-white text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-zinc-50"
            />
            {/* 续跑预算角标：断点恢复勾选 + 轮数未被手动改过时，标注当前值 =
                该 run 的 maxIter 预算（续跑时插件会用表单值覆盖预算，默认 3 会缩水）。
                用户手动改过轮数 / 取消断点恢复 → 不再提示（尊重用户有意重设/开新 run）。 */}
            {resumeSel && !maxIterTouchedRef.current && defaultRunIteration(data?.state, stageSel) != null && (
              <span
                className="self-start shrink-0 px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/70 text-[10px] font-medium"
                title="该 run 的 maxIter 预算：续跑时轮数以此值为准（插件 openRun 用表单值覆盖预算）。手动修改轮数将重设预算。"
              >
                续跑预算 {maxIterSel}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-zinc-400">
            收敛目标（可选）
            <input
              type="text"
              placeholder="如 Total>=80 且门禁全绿"
              value={goalSel}
              onChange={(e) => {
                if (sending) return;
                goalTouchedRef.current = true; // 用户手动改目标 → 不再按 run goal 覆盖
                setGoalSel(e.target.value);
              }}
              disabled={sending}
              className="px-2 py-1 rounded border border-zinc-200 bg-white text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-zinc-50"
            />
            {/* 续跑目标角标：断点恢复勾选 + 目标未被手动改过时，标注当前值 =
                该 run 的 goal（续跑时插件保留 run 原目标，表单空框会误以为清除/另填覆盖）。
                用户手动改过目标 / 取消断点恢复 / run 无目标 → 不再提示（尊重用户有意重设/开新 run）。 */}
            {resumeSel && !goalTouchedRef.current && defaultRunGoal(data?.state, stageSel) != null && (
              <span
                className="self-start shrink-0 px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/70 text-[10px] font-medium"
                title="该 run 的收敛目标：续跑时插件保留此目标（表单为空不会清除）。手动修改目标将重设判定基准。"
              >
                续跑目标
              </span>
            )}
          </label>
          <label
            className="flex items-end pb-1.5 gap-1.5 text-xs text-zinc-500 cursor-pointer"
            title={
              resumeSel
                ? '--resume：从 run-state 断点续跑（保留该阶段基线/轮次计数）'
                : '--resume：从 run-state 断点续跑（保留该阶段基线/轮次计数）。\n同阶段 run 进行中时默认勾选，防误重置 run-state'
            }
          >
            <input
              type="checkbox"
              checked={resumeSel}
              onChange={(e) => {
                if (sending) return;
                resumeTouchedRef.current = true;
                setResumeSel(e.target.checked);
              }}
              disabled={sending}
              className="accent-emerald-600 disabled:opacity-50"
            />
            断点恢复
            {/* 默认预勾提示：同阶段 run 进行中 → 「续跑」徽标（语义同阶段预填的
                「阶段已预填」角标；用户手动改过 → 不再提示，尊重用户选择） */}
            {resumeSel && !resumeTouchedRef.current && (
              <span
                className="shrink-0 px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/70 text-[10px] font-medium"
                title="同阶段 run 进行中：默认续跑（保留基线/轮次）。取消勾选将启动新 run 并重置 run-state。"
              >
                续跑
              </span>
            )}
          </label>
        </div>
        {/* 派活命令预览：表单实况 → 即将派发的 /yxspec:self-iterate 命令（纯前端派生）。
            启动新迭代不再是黑盒——阶段/轮数/目标/模式/断点恢复每个改动都实时反映在
            「将要执行」的命令里，点启动前一眼核对；空阶段 → 中性占位提示（与启动按钮
            禁用态一致）。sending 期间隐藏，避免与「已执行 Ns」计时并排占用行宽。 */}
        {!sending && (
          <div
            className="flex items-center gap-1.5 text-[11px]"
            title={
              previewCmd
                ? '派活命令预览：点「启动」将派发此命令（与表单各项实时同步）'
                : '选择阶段后显示即将派发的 /yxspec:self-iterate 命令预览'
            }
          >
            <span className="shrink-0 text-zinc-400 inline-flex items-center gap-0.5">
              <Icon name={I.terminal} size={11} />
              将执行
            </span>
            {previewCmd ? (
              <code
                className="min-w-0 flex-1 truncate rounded bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 font-mono text-[10px] text-emerald-800"
                title={previewCmd}
              >
                {previewCmd}
              </code>
            ) : (
              <span className="text-zinc-300">选择阶段后预览命令</span>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={sending || !stageSel.trim()}
            onClick={onStart}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-60"
            title={stageSel ? `派活 /yxspec:self-iterate ${stageSel}` : '请先选择阶段'}
          >
            <Icon name={sending ? I.clock : I.play} size={11} />
            {sending ? '启动中…' : '启动'}
          </button>
          {sending && (
            <>
              <span
                className="text-xs text-zinc-500 font-mono tabular-nums"
                aria-live="polite"
                title="本轮派活已执行时长（后台任务运行中）"
              >
                已执行 {elapsedSec}s
              </span>
              <button
                type="button"
                onClick={cancel}
                disabled={cancelling}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-red-300 hover:text-red-600 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                title={cancelling ? '正在终止本轮派活（网关 /api/agent/abort）…' : '终止本轮派活（网关 /api/agent/abort）'}
              >
                <Icon name={cancelling ? I.clock : I.stop} size={11} className={cancelling ? 'animate-spin' : undefined} />
                {cancelling ? '取消中…' : '取消'}
              </button>
            </>
          )}
        </div>
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

      {/* 跨阶段 run 汇总：收敛/退化/进行中计数 + 各阶段最佳分/最差轮（新→旧）。
          数据源 = 本卡已拉取的 SelfIterationOverview，纯前端聚合，零新接口；
          无留痕（empty）时隐藏，不喧宾夺主。 */}
      {!empty && summaries.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-2.5 space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1 font-medium">
              <Icon name={I.gauge} size={12} />
              自迭代 run 汇总
            </span>
            <span className="inline-flex items-center gap-1 shrink-0" title="已收敛阶段（latest 判定 converge）">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-sage-500" aria-hidden />
              收敛 {summaryStats.converged}
            </span>
            <span className="inline-flex items-center gap-1 shrink-0" title="仍在该阶段迭代 / 未收敛">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden />
              迭代中 {summaryStats.running}
            </span>
            <span className="inline-flex items-center gap-1 shrink-0" title="有轮次低于基线被判定退化">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" aria-hidden />
              退化 {summaryStats.degraded}
            </span>
            <span className="ml-auto text-[10px] text-zinc-300">best ↑ 最佳 · ↓ 最差轮</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {summaries.map((s) => (
              <StageRunBadge key={s.token} s={s} />
            ))}
          </div>
        </div>
      )}

      {/* 阶段评分瀑布 */}
      <div ref={waterfallRef} className="space-y-3">
        <SectionLabel>阶段评分</SectionLabel>
        {empty ? (
          // 无任何留痕：启动进行中（targetStage 已定）→ 渲染运行中占位，不再显示
          // 「尚未执行过自迭代（请在上方启动）」——启动已在跑，空态会自相矛盾并误导重复启动。
          // 取消/结束后（sending=false）targetStage 已清空 → 回落真正的空态引导。
          sending && targetStage ? (
            <RunningStageBlock token={targetStage} elapsedSec={elapsedSec} divRef={runningBlockRef} />
          ) : (
            <div className="text-xs text-zinc-400 py-6 text-center border border-dashed border-zinc-200 rounded-lg space-y-1">
              <div>尚未执行过自迭代（无留痕记录）</div>
              <div className="text-[11px]">
                在上方选择阶段并启动新迭代，每轮打分与判定会写入 runtime-data/trajectory/self_iteration/。
              </div>
            </div>
          )
        ) : (
          <div className="space-y-3">
            {stages.map((s) => {
              const isTarget = sending && s.token === targetStage;
              return (
                <div
                  key={s.token}
                  ref={isTarget ? runningBlockRef : undefined}
                  className={`rounded-xl transition-shadow ${isTarget ? 'ring-2 ring-emerald-300/80 shadow-sm' : ''}`}
                >
                  <StageBlock s={s} running={isTarget} />
                </div>
              );
            })}
            {/* 启动的是全新阶段（stages 中尚无该阶段块）：新 run 首轮打分才会长出真实块，
                启动进行中补一个运行中占位，瀑布不显示「缺了一块」的空档，也不误导用户去重复启动。 */}
            {sending && targetStage && !stages.some((s) => s.token === targetStage) && (
              <RunningStageBlock token={targetStage} elapsedSec={elapsedSec} divRef={runningBlockRef} />
            )}
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
