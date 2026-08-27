// M1 流程驾驶舱 - 25 阶段全景 + 当前阶段 + 建议下一步
// 来自 build-spec §2.3 / §10.3 Step 8-10
// v3：布局优化——顶栏（整体进度+当前阶段+图例）合并紧凑；执行成本默认折叠；
//     阶段网格列数适配右侧面板宽度（820px 下 3 列）；NextCommand/ResumeBanner 独立紧凑条。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。

import React from 'react';
import type { StageMapping, StageStatus, StageToken } from '../../data/types';
import { STAGE_GROUPS, STAGE_ORDER, STAGE_TABLE } from '../../data/stage-mapping';
import { FlowView } from './FlowView';
import { GateOverview } from './GateOverview';
import { CostDashboard } from './CostDashboard';
import { TrajectoryPanel } from './TrajectoryPanel';
import { PipelinePanel } from '../pipeline/PipelinePanel';
import { useStageDispatch } from '../../hooks/useStageDispatch';
import { renderInline } from '../../utils/markdown';
import { buildStageOverview } from '../../utils/stageOverview';
import { useProjectStore } from '../../store/projectStore';
import { useToastStore } from '../../store/toastStore';
import { Icon, Badge, Skeleton } from '../ui';
import { I } from '../ui/icons';

// 状态色 — Claude 暖系语义：completed/done 用 sage 暖绿（柔和），blocked/rejected 暖绯
// emerald(赤陶) 只留当前态/交互（ring、派活按钮、当前标签）
const STATUS_COLOR: Record<string, string> = {
  completed: 'border-sage-300 bg-sage-50',
  in_progress: 'border-amber-500 bg-amber-50',
  pending: 'border-zinc-300 bg-zinc-50',
  pending_review: 'border-orange-400 bg-orange-50',
  rejected: 'border-red-500 bg-red-50',
  blocked: 'border-red-600 bg-red-100',
  stale: 'border-purple-500 bg-purple-50',
};

const STATUS_ICON: Record<string, React.ElementType> = {
  completed: I.check,
  in_progress: I.clock,
  pending: I.circle,
  pending_review: I.eye,
  rejected: I.xCircle,
  blocked: I.stop,
  stale: I.refresh,
};

const STATUS_ICON_TONE: Record<string, string> = {
  completed: 'text-sage-600',
  in_progress: 'text-amber-600',
  pending: 'text-zinc-400',
  pending_review: 'text-orange-600',
  rejected: 'text-red-600',
  blocked: 'text-red-600',
  stale: 'text-purple-600',
};

const GROUP_LABEL: Record<string, string> = {
  ACQ: 'ACQ.4',
  SYS: 'SYS.1-3',
  HWE: 'HWE.1',
  SWE: 'SWE.1-5',
  SQT: 'SYS.5/SUP.8',
  COMP: 'SUP.1-2',
  REL: 'SPL.2',
};

interface StageNodeProps {
  token: string;
  mapping: StageMapping;
  status: StageStatus;
  isCurrent: boolean;
  /** 点击卡片时打开产物抽屉（grid 外层包了一层 onClick） */
  onSelectStage?: (token: string) => void;
}

export const StageNode: React.FC<StageNodeProps> = ({ token, mapping, status, isCurrent, onSelectStage }) => {
  const color = STATUS_COLOR[status.status] || STATUS_COLOR.pending;
  const IconComp = STATUS_ICON[status.status] || STATUS_ICON.pending;
  const iconTone = STATUS_ICON_TONE[status.status] || 'text-zinc-400';
  const { dispatch, cancel, sending, dispatchingCmd, cancelling, elapsedSec } = useStageDispatch();
  // 门控三态：blocked=真阻塞（上游未完成）、pending=待补产物、ok=产物齐备可 review
  const gateState = status.gate_state;
  const gateBlocked = gateState === 'blocked';
  // 被阻塞时可跳去第一个未完成的上游（仅真阻塞时给点击）
  const gateUpstreams = gateBlocked ? mapping.upstream : [];
  const busy = sending && dispatchingCmd === mapping.command;

  // 卡片右上角悬浮"一键派活"：点击派活当前阶段，阻止冒泡避免误触卡片 onClick
  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(mapping.command);
  };

  // 门控拦截条可点击：跳到被阻塞的上游阶段（打开对应产物抽屉）；无上游则纯提示，点击无效果
  const handleGateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (gateUpstreams.length > 0) onSelectStage?.(gateUpstreams[0]);
  };

  return (
    <div
      className={`group relative rounded-lg border-2 p-3 transition-all hover:shadow-md ${color} ${
        isCurrent ? 'ring-2 ring-emerald-500 shadow-lg' : ''
      }`}
      title={`${mapping.aspice} - ${mapping.command}\n${status.message || ''}${
        status.gate_message ? `\n门控：${status.gate_message}` : ''
      }`}
    >
      {isCurrent && (
        // 「当前」徽标放左上角，与右上角悬浮派活按钮错开：
        // 同角（-top-2 -right-2）会被按钮盖住，hover/派活中"当前"标识消失。
        <span
          className="absolute -top-2 -left-2 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-xs font-medium shadow-sm inline-flex items-center gap-0.5"
          title="当前阶段"
        >
          <Icon name={I.gauge} size={10} weight="fill" />
          当前
        </span>
      )}
      {/* 悬浮"一键派活"按钮（hover 显示；派活中常驻显示可点击的取消按钮，点击终止 runtime）。
          空闲时 pointer-events-none，避免隐形按钮挡在卡片右上角拦截点击冒泡。
          固定在右上角（-top-2 -right-2），与左上角"当前"徽标互不重叠。 */}
      <span
        className={`absolute -top-2 -right-2 px-1.5 py-1 rounded-full text-white shadow-sm inline-flex items-center gap-1 transition-all active:scale-[0.98] ${
          busy
            ? 'bg-red-500 hover:bg-red-600 opacity-100 cursor-pointer pointer-events-auto'
            : 'bg-emerald-600 opacity-0 group-hover:opacity-100 hover:bg-emerald-700 cursor-pointer pointer-events-none group-hover:pointer-events-auto'
        }`}
        title={
          busy
            ? cancelling ? `终止中：${mapping.command}` : `点击终止执行：${mapping.command}（已执行 ${elapsedSec}s）`
            : `一键派活：${mapping.command}`
        }
        onClick={busy ? (e) => { e.stopPropagation(); cancel(); } : handlePlayClick}
      >
        {busy ? (
          <>
            <Icon name={I.stop} size={12} weight="fill" />
            <span className="tabular-nums">{elapsedSec}s</span>
          </>
        ) : (
          <Icon name={I.play} size={12} weight="fill" />
        )}
      </span>
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-zinc-500">{mapping.aspice}</span>
        <span className={iconTone}>
          <Icon name={IconComp} size={16} />
        </span>
      </div>
      <div className="text-sm font-semibold mt-1 break-words text-zinc-800" title={token}>
        {token}
      </div>
      <div className="text-xs text-zinc-500 mt-1 break-words" title={mapping.command}>
        {mapping.command}
      </div>
      <div className="flex items-center justify-between mt-2 text-xs">
        <span className="text-zinc-500">
          {status.artifacts_count !== undefined
            ? `${status.artifacts_count} 产物`
            : status.artifacts?.length
              ? `${status.artifacts.length} 产物`
              : '暂无产物'}
        </span>
        <span className="flex items-center gap-1">
          {/* 门控三态徽标（来自轨迹门控）：verified 绿 / unverified 黄 / blocked 红。
              Phase 2 徽标联动：派活被门控打回后，gate_reason 带打回原因，
              title 展示原因文案（'迹✗' 常驻显示打回状态）。 */}
          {status.gate_trajectory && (
            <span
              className={`px-1 rounded text-white text-xs ${
                status.gate_trajectory === 'verified'
                  ? 'bg-sage-500'
                  : status.gate_trajectory === 'unverified'
                    ? 'bg-amber-500'
                    : 'bg-red-500'
              }`}
              title={
                status.gate_reason
                  ? `轨迹门控：${status.gate_trajectory}（派活打回：${status.gate_reason}）`
                  : `轨迹门控：${status.gate_trajectory}`
              }
            >
              {status.gate_trajectory === 'verified' ? '迹✓' : status.gate_trajectory === 'unverified' ? '迹?' : '迹✗'}
            </span>
          )}
          {status.review && (
            <span
              className={`px-1 rounded text-white text-xs ${
                status.review.verdict === 'approved'
                  ? 'bg-emerald-500'
                  : status.review.verdict === 'conditional'
                    ? 'bg-amber-500'
                    : 'bg-red-500'
              }`}
            >
              {status.review.verdict}
            </span>
          )}
        </span>
      </div>
      {/* 门控提示条：三态区分（blocked 红警告 / pending 琥珀待补 / ok 绿正向），
          避免把"产物已存在可进 review"这类正向提示误渲染成红色警告 */}
      {status.gate_message && gateState && (
        <div
          className={`mt-2 w-full flex items-center gap-1 min-w-0 text-xs leading-tight rounded px-1.5 py-1 ${
            gateState === 'blocked'
              ? 'text-red-700 bg-red-50 border border-red-200 cursor-pointer hover:bg-red-100 hover:border-red-300 transition-all active:scale-[0.98]'
              : gateState === 'pending'
                ? 'text-amber-700 bg-amber-50 border border-amber-200'
                : 'text-sage-700 bg-sage-50 border border-sage-200'
          }`}
          title={
            gateState === 'blocked'
              ? `点击查看上游阻塞（${gateUpstreams.join('、')}）`
              : status.gate_message
          }
          onClick={handleGateClick}
        >
          <span className="shrink-0">
            <Icon
              name={gateState === 'blocked' ? I.warn : I.check}
              size={11}
              weight="fill"
            />
          </span>
          <span className="flex-1 min-w-0 break-words">{renderInline(status.gate_message)}</span>
          {gateUpstreams.length > 0 && (
            <Icon name={I.arrowRight} size={10} weight="bold" className="shrink-0" />
          )}
        </div>
      )}
    </div>
  );
};

interface CockpitProps {
  stages: Record<string, StageStatus>;
  currentStage: string | null;
  /** 阶段状态是否仍在加载（首次拉取/网关慢）：加载中不渲染虚假的"全 pending"网格，改为骨架屏 */
  loading?: boolean;
  onSelectStage?: (token: string) => void;
}

export const StageCockpit: React.FC<CockpitProps> = ({
  stages,
  currentStage,
  loading,
  onSelectStage,
}) => {
  // 视图互斥状态机：grid / flow / gates / traj / pipeline 五选一。
  // traj 为独立视图（而非覆盖在 grid 上的叠加状态）——否则会出现
  // 「轨迹视图下点网格按钮无反应」「切走轨迹后按钮仍高亮」的脱节。
  // pipeline（原独立「Pipeline」卡，信息与驾驶舱重复）已并入驾驶舱。
  const [view, setView] = React.useState<'grid' | 'flow' | 'gates' | 'traj' | 'pipeline'>('grid');
  const [showCost, setShowCost] = React.useState(false);
  const [copiedOverview, setCopiedOverview] = React.useState(false);
  const specId = useProjectStore((s) => s.current?.meta?.spec_id || '');
  const projectPath = useProjectStore((s) => s.current?.path || '');
  const pushToast = useToastStore((s) => s.push);
  // 「轨迹」视图的选中阶段（从网格点选 / 视图内 select 切换，只读，Phase 1 不接门控写回）
  const [trajStage, setTrajStage] = React.useState<StageToken | null>(null);

  // 整体进度统计（顶栏用）
  const counts: Record<string, number> = {};
  for (const t of STAGE_ORDER) {
    const s = stages[t]?.status || 'pending';
    counts[s] = (counts[s] || 0) + 1;
  }
  const total = STAGE_ORDER.length;
  const done = counts.completed || 0;
  const pct = Math.round((done / total) * 100);

  const currentMapping = currentStage
    ? STAGE_TABLE[currentStage as keyof typeof STAGE_TABLE]
    : null;
  const currentStatus = currentStage ? stages[currentStage] : null;

  // 一键复制阶段概览：当前阶段/整体进度/产物数 → Markdown 剪贴板（周报/群里直接粘贴）。
  // 纯前端组装（stageOverview.ts 纯函数），不依赖网关；剪贴板不可用时静默降级。
  const handleCopyOverview = async () => {
    const md = buildStageOverview(stages, currentStage, { specId });
    try {
      await navigator.clipboard.writeText(md);
      setCopiedOverview(true);
      pushToast('success', '阶段概览已复制（Markdown）');
      window.setTimeout(() => setCopiedOverview(false), 2000);
    } catch {
      pushToast('warn', '复制失败：剪贴板不可用');
    }
  };

  return (
    <div className="space-y-3">
      {/* 整体进度统计：加载中不兜底渲染"全 pending"（会把未拉取阶段误显示成未开始），
          改为骨架条 + 占位数字，避免 0/25 假象后整屏突变。 */}
      <div className="bg-white rounded-lg border border-zinc-200 px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-zinc-700">整体进度</span>
              {loading ? (
                <Skeleton className="w-16 h-3.5" />
              ) : (
                <span className="text-xs font-mono text-zinc-600">
                  {done}/{total}（{pct}%）
                </span>
              )}
            </div>
            {loading ? (
              <Skeleton className="w-full h-2 rounded-full" />
            ) : (
              <div className="w-full bg-zinc-200 rounded-full h-2 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="整体进度">
                <div className="bg-sage-500 h-2 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
          {/* 当前阶段（右对齐紧凑） */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-zinc-500 inline-flex items-center gap-1">
              <Icon name={I.gauge} size={13} className="text-emerald-600" weight="fill" />
              当前
            </span>
            {currentStage ? (
              <>
                <span className="text-sm font-bold text-emerald-800 font-mono">{currentStage}</span>
                {currentMapping && <span className="text-xs text-zinc-500">（{currentMapping.aspice}）</span>}
                {currentStatus && <Badge status={currentStatus.status} />}
              </>
            ) : (
              <span className="text-xs text-zinc-400">—</span>
            )}
          </div>
        </div>
        {/* 状态图例（inline，同卡片底色语义）+ 复制概览 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-2 text-xs flex-wrap">
            <Legend color="sage" label="已完成" count={counts.completed || 0} />
            <Legend color="amber" label="进行中" count={counts.in_progress || 0} />
            <Legend color="orange" label="待审查" count={counts.pending_review || 0} />
            <Legend color="red" label="被拒/阻塞" count={(counts.rejected || 0) + (counts.blocked || 0)} />
            <Legend color="gray" label="未开始" count={counts.pending || 0} />
          </div>
          {/* 一键复制阶段概览（当前阶段/进度/产物数 → Markdown，粘贴到周报/群里） */}
          <button
            className={`text-xs px-2 py-0.5 rounded-md border transition-all active:scale-[0.98] inline-flex items-center gap-1 ${
              copiedOverview
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700'
            }`}
            onClick={handleCopyOverview}
            title="复制阶段概览（当前阶段/整体进度/产物数，Markdown）"
          >
            <Icon name={copiedOverview ? I.check : I.clipboard} size={12} weight="bold" />
            {copiedOverview ? '已复制' : '复制概览'}
          </button>
        </div>
      </div>

      {/* 视图切换 + 成本折叠 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="flex items-center gap-1 bg-zinc-100 border border-zinc-200 rounded p-0.5 w-fit">
          <button
            className={`px-3 py-1 rounded text-xs font-medium transition-all focus-visible:outline-none active:scale-[0.98] inline-flex items-center gap-1.5 ${
              view === 'grid' ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:bg-white/50'
            }`}
            onClick={() => setView('grid')}
            aria-pressed={view === 'grid'}
          >
            <Icon name={I.squares} size={14} />
            网格
          </button>
          <button
            className={`px-3 py-1 rounded text-xs font-medium transition-all focus-visible:outline-none active:scale-[0.98] inline-flex items-center gap-1.5 ${
              view === 'flow' ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:bg-white/50'
            }`}
            onClick={() => setView('flow')}
            aria-pressed={view === 'flow'}
          >
            <Icon name={I.swap} size={14} />
            流向
          </button>
          <button
            className={`px-3 py-1 rounded text-xs font-medium transition-all focus-visible:outline-none active:scale-[0.98] inline-flex items-center gap-1.5 ${
              view === 'gates' ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:bg-white/50'
            }`}
            onClick={() => setView('gates')}
            aria-pressed={view === 'gates'}
          >
            <Icon name={I.shield} size={14} />
            门控
          </button>
          <button
            className={`px-3 py-1 rounded text-xs font-medium transition-all focus-visible:outline-none active:scale-[0.98] inline-flex items-center gap-1.5 ${
              view === 'traj' ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:bg-white/50'
            }`}
            onClick={() => {
              if (view === 'traj') {
                setView('grid');
                setTrajStage(null);
              } else {
                setTrajStage(trajStage ?? ((currentStage as StageToken) ?? (STAGE_ORDER[0] as StageToken)));
                setView('traj');
              }
            }}
            title="阶段执行轨迹（@yxspec/aspice-trajectory）"
            aria-pressed={view === 'traj'}
          >
            <Icon name={I.timer} size={14} />
            轨迹
          </button>
          <button
            className={`px-3 py-1 rounded text-xs font-medium transition-all focus-visible:outline-none active:scale-[0.98] inline-flex items-center gap-1.5 ${
              view === 'pipeline' ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:bg-white/50'
            }`}
            onClick={() => setView('pipeline')}
            title="Pipeline 编码流水线状态（原独立「Pipeline」卡，信息与驾驶舱重复，已并入）"
            aria-pressed={view === 'pipeline'}
          >
            <Icon name={I.stack} size={14} />
            Pipeline
          </button>
        </div>
        {/* 执行成本折叠开关 */}
        <button
          className={`text-xs px-2.5 py-1.5 rounded-md border transition-all focus-visible:outline-none active:scale-[0.98] inline-flex items-center gap-1.5 ${
            showCost
              ? 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
              : 'border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300'
          }`}
          onClick={() => setShowCost(!showCost)}
          title="执行成本（审计账本聚合）"
          aria-expanded={showCost}
        >
          <Icon name={I.chartBar} size={13} />
          成本
          <Icon name={showCost ? I.caretDown : I.caretRight} size={11} />
        </button>
      </div>

      {/* 执行成本（折叠区，默认收起 —— 首屏专注阶段网格）。
          展开/收起用 opacity+translate 入场（ui-animation：面板 reveal 150ms），
          prefers-reduced-motion 下退化为瞬显。 */}
      {showCost && (
        <div className="bg-white rounded-lg border border-zinc-200 p-3 animate-fade-in-up">
          <CostDashboard />
        </div>
      )}

      {view === 'flow' ? (
        <FlowView onSelectStage={onSelectStage} />
      ) : view === 'gates' ? (
        <GateOverview />
      ) : view === 'pipeline' ? (
        <PipelinePanel projectPath={projectPath} />
      ) : view === 'traj' && trajStage ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-emerald-600">
                <Icon name={I.timer} size={15} weight="fill" />
              </span>
              <span className="text-sm font-bold text-zinc-800 font-mono truncate">{trajStage}</span>
              <span className="text-xs text-zinc-400 shrink-0">（{STAGE_TABLE[trajStage]?.aspice ?? '—'}）</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <select
                className="text-xs border border-zinc-200 rounded px-1.5 py-1 font-mono bg-white text-zinc-600 max-w-[180px]"
                value={trajStage}
                onChange={(e) => setTrajStage(e.target.value as StageToken)}
                title="切换阶段查看轨迹"
              >
                {STAGE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                className="text-xs px-2 py-1 rounded border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 transition-all active:scale-[0.98]"
                onClick={() => {
                  setView('grid');
                  setTrajStage(null);
                }}
                title="收起轨迹面板，回到阶段网格"
              >
                收起
              </button>
            </div>
          </div>
          <TrajectoryPanel stage={trajStage} limit={50} />
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(STAGE_GROUPS).map(([group, tokens]) => {
            if (tokens.length === 0) return null;
            return (
              <div key={group}>
                <h3 className="text-sm font-bold text-zinc-700 mb-2 flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-zinc-200 rounded text-xs text-zinc-600">{GROUP_LABEL[group]}</span>
                  {group}（{tokens.length} 阶段）
                </h3>
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                  {loading
                    ? // 加载骨架：与原卡片同构（状态色块/标题/副标题/底部两行），占位稳定不跳动
                      tokens.map((token) => (
                        <div key={token} className="rounded-lg border-2 border-zinc-200 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <Skeleton className="w-12 h-3" />
                            <Skeleton className="w-4 h-4" />
                          </div>
                          <Skeleton className="w-20 h-4" />
                          <Skeleton className="w-28 h-3" />
                          <div className="flex items-center justify-between pt-1">
                            <Skeleton className="w-10 h-3" />
                            <Skeleton className="w-14 h-3" />
                          </div>
                        </div>
                      ))
                    : tokens.map((token) => {
                    const mapping = STAGE_TABLE[token];
                    const status = stages[token] || {
                      token,
                      status: 'pending',
                      artifacts: [],
                      review: null,
                      last_update: '',
                      message: '',
                      artifacts_count: 0,
                    };
                    return (
                      <div
                        key={token}
                        className="cursor-pointer"
                        onClick={() => onSelectStage?.(token)}
                      >
                        <StageNode
                          token={token}
                          mapping={mapping}
                          status={status}
                          isCurrent={currentStage === token}
                          onSelectStage={onSelectStage}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Legend: React.FC<{ color: string; label: string; count: number }> = ({
  color,
  label,
  count,
}) => {
  const bg = {
    sage: 'bg-sage-100 text-sage-700',
    amber: 'bg-amber-100 text-amber-800',
    orange: 'bg-orange-100 text-orange-800',
    red: 'bg-red-100 text-red-800',
    gray: 'bg-zinc-100 text-zinc-700',
  }[color];
  return (
    <span className={`px-2 py-0.5 rounded ${bg}`}>
      {label} {count}
    </span>
  );
};
