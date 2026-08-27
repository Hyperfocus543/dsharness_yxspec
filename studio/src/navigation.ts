// =============================================================================
// 导航配置 — 左侧功能卡定义（从 App.tsx 拆出）
// 功能卡 id：除执行终端外的辅助功能（产物图谱已并入驾驶舱流向视图）
// =============================================================================

import type React from 'react';
import { I } from './components/ui/icons';

/** 功能卡 id：除执行终端外的辅助功能（产物图谱已并入驾驶舱流向视图） */
export type FunctionCard =
  | 'cockpit'
  | 'tasks'
  | 'reviews'
  | 'pipeline'
  | 'plugins'
  | 'settings'
  | 'batch'
  | 'report';

export interface FunctionCardDef {
  id: FunctionCard;
  label: string;
  icon: React.ElementType;
  hint: string;
}

export const FUNCTION_CARDS: FunctionCardDef[] = [
  { id: 'cockpit', label: '流程驾驶舱', icon: I.gauge, hint: '阶段进度 · 门控 · 流向' },
  { id: 'tasks', label: '任务看板', icon: I.listChecks, hint: '阶段任务状态机' },
  { id: 'reviews', label: '审查中心', icon: I.shield, hint: 'Review 裁决' },
  { id: 'batch', label: '批处理', icon: I.bolt, hint: '多阶段一键连跑' },
  { id: 'report', label: '周报', icon: I.fileText, hint: '进度导出' },
  { id: 'pipeline', label: 'Pipeline', icon: I.stack, hint: '编码流水线' },
  { id: 'plugins', label: '插件中心', icon: I.plugs, hint: '功能开关 · 社区插件' },
  { id: 'settings', label: '设置', icon: I.gear, hint: '模型管理 · 网关' },
];
