// =============================================================================
// 功能卡面板渲染 — 按卡 id 返回对应组件（从 App.tsx 拆出）
// =============================================================================

import React from 'react';
import type { StageMapping, StageToken } from './data/types';
import type { useStageStore } from './store/stageStore';
import { STAGE_TABLE } from './store/stageStore';
import type { FunctionCard } from './navigation';
import { StageCockpit } from './components/cockpit/StageCockpit';
import { NextCommand } from './components/cockpit/NextCommand';
import { ResumeBanner } from './components/cockpit/ResumeBanner';
import { BatchQueue } from './components/cockpit/BatchQueue';
// ReportExport 由 FE-2 子 agent 实现（零 props，导出名 ReportExport）。
import { ReportExport } from './components/cockpit/ReportExport';
import { ReviewCenter } from './components/review/ReviewCenter';
import { ModelSettings } from './components/settings/ModelSettings';
import { PluginCenter } from './components/plugin/PluginCenter';

export const DEFAULT_TASKS_FILES = [
  'task_init.md',
  'task_prd.md',
  'task_sw_req.md',
  'task_sw_arch.md',
  'task_sw_arch_if.md',
  'task_sqt_strategy.md',
  'task_sqt_tr_analysis.md',
  'task_sqt_case_design.md',
  'task_sqt_script_gen.md',
  'task_sqt_defect_feedback.md',
];

/** 功能卡渲染上下文（App 组装的数据透传） */
export interface FunctionCardCtx {
  projectPath: string;
  stages: ReturnType<typeof useStageStore.getState>['stages'];
  currentStage: string | null;
  currentMapping: StageMapping | null;
  loading: boolean;
  suggestNext: (s: StageToken) => Promise<string | null>;
  selectedTaskFile: string;
  onTaskFileChange: (f: string) => void;
  onSelectStage: (token: string) => void;
}

/** 功能卡面板渲染：按卡 id 返回对应组件 */
export function renderFunctionCard(card: FunctionCard, ctx: FunctionCardCtx) {
  switch (card) {
    case 'cockpit':
      return (
        <div className="p-3 space-y-2.5">
          {/* 断点续跑（驾驶舱顶部，建议下一步之前）：网关重启/休眠后提示「已恢复到 X 阶段」+ 一键续跑 */}
          <ResumeBanner />
          {/* 建议下一步（驾驶舱顶端，整体进度/当前阶段之后） */}
          {ctx.currentStage && ctx.currentMapping && (
            <NextCommand
              stage={ctx.currentStage}
              mapping={ctx.currentMapping}
              stages={ctx.stages}
              onSuggest={(cmd) => ctx.suggestNext(cmd as StageToken)}
            />
          )}
          <StageCockpit
            stages={ctx.stages}
            currentStage={ctx.currentStage}
            loading={ctx.loading}
            onSelectStage={ctx.onSelectStage}
          />
        </div>
      );
    case 'reviews':
      return <ReviewCenter projectPath={ctx.projectPath} />;
    case 'batch':
      return <BatchQueue />;
    case 'report':
      return <ReportExport />;
    case 'plugins':
      return <PluginCenter />;
    case 'settings':
      return <ModelSettings />;
    default:
      return null;
  }
}
