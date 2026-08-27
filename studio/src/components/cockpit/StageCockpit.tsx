// M1 流程驾驶舱 - 25 阶段全景 + 当前阶段 + 建议下一步
// 来自 build-spec §2.3 / §10.3 Step 8-10
// v3：布局优化——顶栏（整体进度+当前阶段+图例）合并紧凑；执行成本默认折叠；
//     阶段网格列数适配右侧面板宽度（820px 下 3 列）；NextCommand/ResumeBanner 独立紧凑条。
// v4（架构重构）：视图体拆独立组件（StageGrid/StageFlow/StageGates/StageTraj + 成本 tab），
//     本文件只留视图切换状态机 + 数据透传（组合壳，<200 行）。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。

import React from 'react';
import type { StageStatus, StageToken } from '../../data/types';
import { STAGE_ORDER } from '../../data/stage-mapping';
import { StageGrid } from './StageGrid';
import { StageFlow } from './StageFlow';
import { StageGates } from './StageGates';
import { StageTraj } from './StageTraj';
import { CostDashboard } from './CostDashboard';
import { Icon } from '../ui';
import { I } from '../ui/icons';

// 视图互斥状态机：grid / flow / gates / traj 四选一。
// traj 为独立视图（而非覆盖在 grid 上的叠加状态）——否则会出现
// 「轨迹视图下点网格按钮无反应」「切走轨迹后按钮仍高亮」的脱节。
type View = 'grid' | 'flow' | 'gates' | 'traj';

interface ViewTabProps {
  view: View;
  onView: (v: View) => void;
}

/** 视图切换条（网格 / 流向 / 门控 / 轨迹） */
const ViewTabs: React.FC<ViewTabProps> = ({ view, onView }) => {
  const tabs: { id: View; label: string; icon: React.ElementType }[] = [
    { id: 'grid', label: '网格', icon: I.squares },
    { id: 'flow', label: '流向', icon: I.swap },
    { id: 'gates', label: '门控', icon: I.shield },
    { id: 'traj', label: '轨迹', icon: I.timer },
  ];
  return (
    <div className="flex items-center gap-1 bg-zinc-100 border border-zinc-200 rounded p-0.5 w-fit">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={`px-3 py-1 rounded text-xs font-medium transition-all focus-visible:outline-none active:scale-[0.98] inline-flex items-center gap-1.5 ${
            view === t.id ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:bg-white/50'
          }`}
          onClick={() => onView(t.id)}
          aria-pressed={view === t.id}
        >
          <Icon name={t.icon} size={14} />
          {t.label}
        </button>
      ))}
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
  const [view, setView] = React.useState<View>('grid');
  const [showCost, setShowCost] = React.useState(false);
  // 「轨迹」视图的选中阶段（从网格点选 / 视图内 select 切换，只读，Phase 1 不接门控写回）
  const [trajStage, setTrajStage] = React.useState<StageToken | null>(null);

  const handleView = (v: View) => {
    if (v === 'traj' && view === 'traj') {
      // 轨迹视图下再点「轨迹」= 收起回网格（与原行为一致）
      setView('grid');
      setTrajStage(null);
      return;
    }
    if (v === 'traj') {
      setTrajStage(trajStage ?? ((currentStage as StageToken) ?? (STAGE_ORDER[0] as StageToken)));
    }
    setView(v);
  };

  return (
    <div className="space-y-3">
      {/* 视图切换 + 成本折叠 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <ViewTabs view={view} onView={handleView} />
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
        <StageFlow onSelectStage={onSelectStage} />
      ) : view === 'gates' ? (
        <StageGates />
      ) : view === 'traj' && trajStage ? (
        <StageTraj
          stage={trajStage}
          onStageChange={setTrajStage}
          onClose={() => {
            setView('grid');
            setTrajStage(null);
          }}
        />
      ) : (
        <StageGrid
          stages={stages}
          currentStage={currentStage}
          loading={loading}
          onSelectStage={onSelectStage}
        />
      )}
    </div>
  );
};
