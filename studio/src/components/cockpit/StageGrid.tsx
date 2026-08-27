// 驾驶舱网格视图 — 25 阶段分组卡片网格（从 StageCockpit 拆出）
// 整体进度统计（顶栏）+ 阶段分组卡片网格（单卡见 StageNode）。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。

import React from 'react';
import type { StageStatus } from '../../data/types';
import { STAGE_GROUPS, STAGE_ORDER, STAGE_TABLE } from '../../data/stage-mapping';
import { buildStageOverview } from '../../utils/stageOverview';
import { useProjectStore } from '../../store/projectStore';
import { useToastStore } from '../../store/toastStore';
import { Icon, Badge, Skeleton } from '../ui';
import { I } from '../ui/icons';
import { StageNode } from './StageNode';

const GROUP_LABEL: Record<string, string> = {
  ACQ: 'ACQ.4',
  SYS: 'SYS.1-3',
  HWE: 'HWE.1',
  SWE: 'SWE.1-5',
  SQT: 'SYS.5/SUP.8',
  COMP: 'SUP.1-2',
  REL: 'SPL.2',
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

interface StageGridProps {
  stages: Record<string, StageStatus>;
  currentStage: string | null;
  /** 阶段状态是否仍在加载（首次拉取/网关慢）：加载中不渲染虚假的"全 pending"网格，改为骨架屏 */
  loading?: boolean;
  onSelectStage?: (token: string) => void;
}

/** 驾驶舱网格视图：整体进度统计（顶栏）+ 25 阶段分组卡片网格 */
export const StageGrid: React.FC<StageGridProps> = ({ stages, currentStage, loading, onSelectStage }) => {
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

  const specId = useProjectStore((s) => s.current?.meta?.spec_id || '');
  const pushToast = useToastStore((s) => s.push);
  const [copiedOverview, setCopiedOverview] = React.useState(false);

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

      {/* 阶段分组卡片网格 */}
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
    </div>
  );
};
