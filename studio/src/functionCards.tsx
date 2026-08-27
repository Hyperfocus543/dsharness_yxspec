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
import { TaskBoard } from './components/taskboard/TaskBoard';
import { ReviewCenter } from './components/review/ReviewCenter';
import { PipelinePanel } from './components/pipeline/PipelinePanel';
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
    case 'tasks':
      return (
        <div className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-zinc-600">任务文件：</span>
            <select
              className="text-xs border rounded px-2 py-1 font-mono"
              value={ctx.selectedTaskFile}
              onChange={(e) => ctx.onTaskFileChange(e.target.value)}
            >
              {DEFAULT_TASKS_FILES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <TaskBoard
            projectPath={ctx.projectPath}
            taskFile={ctx.selectedTaskFile}
            title={`任务状态机看板 - ${ctx.selectedTaskFile}`}
          />
        </div>
      );
    case 'reviews':
      return <ReviewCenter projectPath={ctx.projectPath} />;
    case 'batch':
      return <BatchQueue />;
    case 'report':
      return <ReportExport />;
    case 'pipeline':
      return <PipelinePanel projectPath={ctx.projectPath} />;
    case 'plugins':
      return <PluginCenter />;
    case 'settings':
      return <ModelSettings />;
    default:
      return null;
  }
}
