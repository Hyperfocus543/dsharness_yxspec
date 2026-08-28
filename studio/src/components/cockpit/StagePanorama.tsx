// =============================================================================
// StagePanorama — 驾驶舱「全景」视图：ASPICE 流程条 + 分组卡网格 + 详情浮层
// 用户拍板：不用 V 字形（不符合操作逻辑）；ASPICE/V+ 体系以四种可平移能力融入：
//   1. 流程条   — 顶部分组（ACQ▸SYS▸HWE▸SWE▸SQT▸SUP▸REL）高亮当前位置与完成度
//   2. 分组网格 — 按执行顺序的富卡片网格（StageNode：状态色/派活/轨迹/门控/审查全保留）
//   3. 详情浮层 — 点击卡片弹出 ASPICE 档案：编号/命令/上下游/产物/验证伙伴（可跳转）
//   4. 镜像联动 — hover 卡片高亮其验证伙伴（ASPICE 追溯对应可视化）
// 取代 StageGrid / StageFlow(FlowView) / StageVModel 三个视图。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import type { StageStatus, StageToken } from '../../data/types';
import { STAGE_GROUPS, STAGE_TABLE } from '../../data/stage-mapping';
import { Skeleton } from '../ui';
import { StageHeader } from './StageHeader';
import { StageNode } from './StageNode';
import { TrajectoryPanel } from './TrajectoryPanel';
import { Icon } from '../ui';
import { I } from '../ui/icons';
import { fetchSelfIteration, type SelfIterationOverview } from '../../utils/ipc';
import { stageIterBadges } from '../../utils/stageIterBadge';

/** 流程组顺序（ASPICE V+ 权威顺序，流程条 + 分组网格共用） */
const GROUP_ORDER = ['ACQ', 'SYS', 'HWE', 'SWE', 'SQT', 'COMP', 'REL'] as const;

const GROUP_LABEL: Record<string, string> = {
  ACQ: 'ACQ.4',
  SYS: 'SYS.1-3',
  HWE: 'HWE.1',
  SWE: 'SWE.1-5',
  SQT: 'SYS.5/SUP.8',
  COMP: 'SUP.1-2',
  REL: 'SPL.2',
};

// —— 验证伙伴（ASPICE 追溯对应）：同一功能层的开发阶段 ↔ 验证阶段 ——
const VERIFY_PARTNER: Record<string, string> = {
  swe_coding_do: 'swe_unit_verify',
  swe_unit_verify: 'swe_coding_do',
  swe_arch: 'swe_integration_verify',
  swe_integration_verify: 'swe_arch',
  sys_arch: 'sqt_auto_test',
  sqt_auto_test: 'sys_arch',
};
function pairStageOf(token: string): string | null {
  return VERIFY_PARTNER[token] ?? null;
}

/** 上游需求文件名（CRS/SRS/SWRS 链，最接近 stages.mjs 知识注入链的静态镜像） */
function upstreamReqName(token: string): string | null {
  if (token === 'init') return 'SOR';
  if (token === 'sys_elicitation') return 'CRS';
  if (token === 'sys_analysis') return 'SRS';
  if (token.startsWith('swe_')) return 'SWRS';
  if (token.startsWith('sqt_')) return '系统需求';
  return null;
}

function statusDotColor(s: string): string {
  switch (s) {
    case 'completed': return 'bg-sage-500';
    case 'in_progress': return 'bg-amber-500';
    case 'pending_review': return 'bg-orange-400';
    case 'rejected':
    case 'blocked': return 'bg-red-500';
    case 'stale': return 'bg-purple-500';
    default: return 'bg-zinc-300';
  }
}

/** 组头：本组第一个未完成阶段的 ASPICE 编号 */
function firstAspiceOfGroup(group: string, tokens: StageToken[], stages: Record<string, StageStatus>): string | null {
  const t = tokens.find((tk) => stages[tk]?.status !== 'completed');
  if (!t) return null;
  return STAGE_TABLE[t]?.aspice ?? null;
}

interface StagePanoramaProps {
  stages: Record<string, StageStatus>;
  currentStage: string | null;
  /** 阶段状态是否仍在加载（首次拉取/网关慢）：不渲染虚假的"全 pending"，改为骨架屏 */
  loading?: boolean;
  /** 浮层「查看产物」→ 打开产物抽屉（StageCockpit 传入） */
  onSelectStage?: (token: string) => void;
  /** 点击轨迹图标 → 跳到该阶段轨迹视图 */
  onViewTrajectory?: (token: string) => void;
}

/** ASPICE 流程条：七个流程组横向排开，当前组高亮、完成组亮绿、未开始灰 */
const ProcessBar: React.FC<{ stages: Record<string, StageStatus>; currentStage: string | null }> = ({
  stages,
  currentStage,
}) => {
  const currentGroup = (currentStage && STAGE_TABLE[currentStage as StageToken]?.group) || null;
  return (
    <div className="bg-white rounded-lg border border-zinc-200 px-3 py-2 flex items-center gap-1 flex-wrap">
      {GROUP_ORDER.map((g, i) => {
        const tokens = STAGE_GROUPS[g] || [];
        const done = tokens.filter((t) => stages[t]?.status === 'completed').length;
        const active = g === currentGroup;
        const fullyDone = tokens.length > 0 && done === tokens.length;
        return (
          <React.Fragment key={g}>
            {i > 0 && <Icon name={I.caretRight} size={10} className="text-zinc-300 shrink-0" />}
            <span
              title={`${GROUP_LABEL[g]} · ${done}/${tokens.length} 完成`}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold inline-flex items-center gap-1 transition-all ${
                active
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : fullyDone
                    ? 'bg-sage-100 text-sage-700'
                    : 'bg-zinc-100 text-zinc-500'
              }`}
            >
              {g}
              {fullyDone && <Icon name={I.check} size={10} weight="bold" />}
            </span>
          </React.Fragment>
        );
      })}
      <span className="ml-auto text-[10px] text-zinc-400">
        {currentGroup ? `当前位置：${currentGroup}` : '无当前阶段'}
      </span>
    </div>
  );
};

/** 阶段详情浮层（点击卡片弹出）：ASPICE 档案 + 上下游 + 产物 + 验证伙伴（可跳转） */
const StageDetail: React.FC<{
  token: StageToken;
  status: StageStatus;
  stages: Record<string, StageStatus>;
  onClose: () => void;
  /** 跳转另一个阶段的详情（浮层内导航） */
  onJump: (t: StageToken) => void;
  /** 打开产物抽屉 */
  onSelectStage?: (token: string) => void;
}> = ({ token, status, stages, onClose, onJump, onSelectStage }) => {
  const m = STAGE_TABLE[token];
  const n = status.artifacts_count ?? status.artifacts?.length ?? 0;
  const pair = pairStageOf(token);
  const pairStatus = pair ? stages[pair] : null;

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center pt-24 bg-black/20 backdrop-blur-[1px] animate-fade-in"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md bg-white rounded-xl border border-zinc-200 shadow-xl p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头：token + ASPICE 编号 + 完成态 */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold font-mono text-zinc-800">{token}</span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-xs font-mono">{m.aspice}</span>
              {status.status === 'completed' && <span className="text-sage-600 text-xs">已完成</span>}
            </div>
            <div className="text-xs text-zinc-500 mt-0.5 font-mono break-words">{m.command}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-all active:scale-[0.96]"
            aria-label="关闭"
          >
            <Icon name={I.close} size={16} />
          </button>
        </div>

        {/* 需求/产物链：上游需求文件 → 本阶段 → 产物 */}
        <div className="flex items-center gap-1 text-xs text-zinc-600">
          <span className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 font-mono">
            {upstreamReqName(token) || '—'}
          </span>
          <Icon name={I.arrowRight} size={10} className="text-zinc-300 shrink-0" />
          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono">{m.command}</span>
          <Icon name={I.arrowRight} size={10} className="text-zinc-300 shrink-0" />
          <span className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 font-mono">
            {n > 0 ? `${n} 产物` : '无产物'}
          </span>
        </div>

        {/* 上游 / 下游（可跳转） */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-zinc-200 p-2 space-y-1">
            <div className="text-[10px] text-zinc-400 font-semibold uppercase">上游</div>
            {m.upstream.length > 0 ? (
              m.upstream.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => onJump(u)}
                  className="block w-full text-left px-1.5 py-0.5 rounded hover:bg-emerald-50 hover:text-emerald-700 text-zinc-600 font-mono truncate transition-all active:scale-[0.98]"
                >
                  {u}
                </button>
              ))
            ) : (
              <span className="text-zinc-400">无</span>
            )}
          </div>
          <div className="rounded-lg border border-zinc-200 p-2 space-y-1">
            <div className="text-[10px] text-zinc-400 font-semibold uppercase">下游</div>
            {m.downstream.length > 0 ? (
              m.downstream.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onJump(d)}
                  className="block w-full text-left px-1.5 py-0.5 rounded hover:bg-emerald-50 hover:text-emerald-700 text-zinc-600 font-mono truncate transition-all active:scale-[0.98]"
                >
                  {d}
                </button>
              ))
            ) : (
              <span className="text-zinc-400">无</span>
            )}
          </div>
        </div>

        {/* 验证伙伴（ASPICE 追溯对应） */}
        {pair && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2">
            <div className="text-[10px] text-emerald-600 font-semibold mb-1">验证伙伴（ASPICE 追溯）</div>
            <button
              type="button"
              onClick={() => onJump(pair as StageToken)}
              className="w-full text-left px-1.5 py-1 rounded hover:bg-emerald-100 text-zinc-700 font-mono text-xs transition-all active:scale-[0.98] inline-flex items-center gap-1.5"
            >
              <span className={`size-2 rounded-full ${pairStatus ? statusDotColor(pairStatus.status) : 'bg-zinc-300'}`} />
              {pair}
              {pairStatus && <span className="ml-auto text-[10px] text-zinc-400">{STAGE_TABLE[pair as StageToken]?.aspice}</span>}
            </button>
          </div>
        )}

        {/* 状态信息 */}
        {status.message && <div className="text-xs text-zinc-500">{status.message}</div>}
        {status.gate_message && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">{status.gate_message}</div>
        )}

        {/* 操作 */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md border border-zinc-200 text-zinc-600 hover:border-zinc-300 transition-all active:scale-[0.98]"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={() => { onClose(); onSelectStage?.(token); }}
            className="text-xs px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-all active:scale-[0.98] inline-flex items-center gap-1"
          >
            <Icon name={I.fileText} size={12} />
            查看产物（{n}）
          </button>
        </div>
      </div>
    </div>
  );
};

/** 全景视图：流程条 + 分组卡网格 + 详情浮层（ASPICE/V+ 按操作逻辑融入，不用 V 字形） */
export const StagePanorama: React.FC<StagePanoramaProps> = ({
  stages,
  currentStage,
  loading,
  onSelectStage,
  onViewTrajectory,
}) => {
  // 详情浮层选中阶段
  const [detail, setDetail] = React.useState<StageToken | null>(null);
  // hover 镜像联动：悬停卡片 → 其验证伙伴卡片亮环
  const [hoverToken, setHoverToken] = React.useState<string | null>(null);
  // 卡片内联轨迹展开（每个单元卡独立展示/调取本模块轨迹，点按钮展开收起）
  const [trajOpen, setTrajOpen] = React.useState<Set<string>>(new Set());
  // 阶段自迭代徽标（全景卡 × 自迭代联动）：mount 时拉一次 /api/self-iteration，
  // 只读展示，失败静默降级（自迭代卡不可用不影响全景卡）。
  const [iterData, setIterData] = React.useState<SelfIterationOverview | null>(null);
  const iterBadges = React.useMemo(() => stageIterBadges(iterData), [iterData]);
  React.useEffect(() => {
    let cancelled = false;
    fetchSelfIteration()
      .then((d) => {
        if (!cancelled) setIterData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 打开视图自动定位到当前进行阶段（略过上方的已实现阶段）：
  // mount 后 / loading 结束 / currentStage 变化时各滚一次；ref 去重，轮询刷新不重复滚
  const scrolledRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (loading) return;
    if (!currentStage) return;
    if (scrolledRef.current === currentStage) return;
    scrolledRef.current = currentStage;
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(`stage-${currentStage}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [loading, currentStage]);

  return (
    <div className="space-y-3">
      {/* 整体进度统计条 */}
      <StageHeader stages={stages} currentStage={currentStage} loading={loading} />

      {/* ASPICE 流程条（当前位置 + 分组完成度） */}
      {!loading && <ProcessBar stages={stages} currentStage={currentStage} />}

      {/* 分组卡片网格（按执行顺序） */}
      <div className="space-y-5">
        {GROUP_ORDER.map((group) => {
          const tokens = STAGE_GROUPS[group] || [];
          if (tokens.length === 0) return null;
          const firstAspice = firstAspiceOfGroup(group, tokens, stages);
          const done = tokens.filter((t) => stages[t]?.status === 'completed').length;
          return (
            <div key={group}>
              <h3 className="text-sm font-bold text-zinc-700 mb-2 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-zinc-200 rounded text-xs text-zinc-600">{GROUP_LABEL[group]}</span>
                {group}
                <span className="text-xs font-normal text-zinc-400">（{tokens.length} 阶段 · {done} 完成）</span>
                {firstAspice && <span className="text-[10px] font-mono text-amber-600">下一步 → {firstAspice}</span>}
              </h3>
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                {loading
                  ? tokens.map((token) => (
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
                        status: 'pending' as const,
                        artifacts: [],
                        review: null,
                        last_update: '',
                        message: '',
                        artifacts_count: 0,
                      };
                      const isPartnerHighlighted = hoverToken !== null && pairStageOf(hoverToken) === token;
                      const trajExpanded = trajOpen.has(token);
                      return (
                        <div
                          key={token}
                          id={`stage-${token}`}
                          className={`cursor-pointer rounded-lg transition-all ${
                            isPartnerHighlighted ? 'ring-2 ring-emerald-400/70' : 'ring-0 ring-transparent'
                          }`}
                          onClick={() => setDetail(token)}
                          onMouseEnter={() => setHoverToken(token)}
                          onMouseLeave={() => setHoverToken(null)}
                        >
                          <StageNode
                            token={token}
                            mapping={mapping}
                            status={status}
                            isCurrent={currentStage === token}
                            onSelectStage={onSelectStage}
                            onViewTrajectory={onViewTrajectory}
                            expanded={trajExpanded}
                            iterBadge={iterBadges.get(token) ?? null}
                            onToggleTrajectory={(t) => {
                              setTrajOpen((prev) => {
                                const next = new Set(prev);
                                if (next.has(t)) next.delete(t);
                                else next.add(t);
                                return next;
                              });
                            }}
                          />
                        </div>
                      );
                    })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 详情浮层 */}
      {detail && stages[detail] && (
        <StageDetail
          token={detail}
          status={stages[detail]}
          stages={stages}
          onClose={() => setDetail(null)}
          onJump={setDetail}
          onSelectStage={onSelectStage}
        />
      )}
    </div>
  );
};
