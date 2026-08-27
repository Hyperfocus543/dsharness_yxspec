// 驾驶舱网格视图 — 25 阶段分组卡片网格（从 StageCockpit 拆出）
// 阶段分组卡片网格（整体进度统计条见 StageHeader，单卡见 StageNode）。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。

import React from 'react';
import type { StageStatus } from '../../data/types';
import { STAGE_GROUPS, STAGE_TABLE } from '../../data/stage-mapping';
import { Skeleton } from '../ui';
import { StageNode } from './StageNode';
import { StageHeader } from './StageHeader';

const GROUP_LABEL: Record<string, string> = {
  ACQ: 'ACQ.4',
  SYS: 'SYS.1-3',
  HWE: 'HWE.1',
  SWE: 'SWE.1-5',
  SQT: 'SYS.5/SUP.8',
  COMP: 'SUP.1-2',
  REL: 'SPL.2',
};

interface StageGridProps {
  stages: Record<string, StageStatus>;
  currentStage: string | null;
  /** 阶段状态是否仍在加载（首次拉取/网关慢）：加载中不渲染虚假的"全 pending"网格，改为骨架屏 */
  loading?: boolean;
  onSelectStage?: (token: string) => void;
  /** 点击轨迹徽标 → 跳到该阶段轨迹视图（StageCockpit 传入） */
  onViewTrajectory?: (token: string) => void;
}

/** 驾驶舱网格视图：整体进度统计（顶栏）+ 25 阶段分组卡片网格 */
export const StageGrid: React.FC<StageGridProps> = ({ stages, currentStage, loading, onSelectStage, onViewTrajectory }) => {
  return (
    <div className="space-y-3">
      <StageHeader stages={stages} currentStage={currentStage} loading={loading} />

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
                        onViewTrajectory={onViewTrajectory}
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
