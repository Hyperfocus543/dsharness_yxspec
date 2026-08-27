// 驾驶舱执行轨迹视图（从 StageCockpit 拆出的视图切换壳的一部分，独立组件）
// 阶段执行轨迹面板（TrajectoryPanel 原实现）+ 阶段选择条。
// 选中阶段可从网格点选 / 视图内 select 切换，只读，Phase 1 不接门控写回。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。

import React from 'react';
import type { StageToken } from '../../data/types';
import { STAGE_ORDER, STAGE_TABLE } from '../../data/stage-mapping';
import { TrajectoryPanel } from './TrajectoryPanel';
import { Icon } from '../ui';
import { I } from '../ui/icons';

interface StageTrajProps {
  stage: StageToken;
  onStageChange: (stage: StageToken) => void;
  onClose: () => void;
}

/** 驾驶舱轨迹视图：阶段选择 + 执行轨迹面板（导出 OTel / 回滚操作） */
export const StageTraj: React.FC<StageTrajProps> = ({ stage, onStageChange, onClose }) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-emerald-600">
            <Icon name={I.timer} size={15} weight="fill" />
          </span>
          <span className="text-sm font-bold text-zinc-800 font-mono truncate">{stage}</span>
          <span className="text-xs text-zinc-400 shrink-0">（{STAGE_TABLE[stage]?.aspice ?? '—'}）</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <select
            className="text-xs border border-zinc-200 rounded px-1.5 py-1 font-mono bg-white text-zinc-600 max-w-[180px]"
            value={stage}
            onChange={(e) => onStageChange(e.target.value as StageToken)}
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
            onClick={onClose}
            title="收起轨迹面板，回到阶段网格"
          >
            收起
          </button>
        </div>
      </div>
      <TrajectoryPanel stage={stage} limit={50} />
    </div>
  );
};
