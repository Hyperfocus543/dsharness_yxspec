// =============================================================================
// 导航配置 — 左侧功能卡定义（从 App.tsx 拆出）
// 功能卡 id：除执行终端外的辅助功能（产物图谱已并入驾驶舱流向视图）
// =============================================================================

import type React from 'react';
import { I } from './components/ui/icons';

/** 功能卡 id：除驾驶舱（主区常驻）外的辅助功能
 *  （产物图谱/轨迹/Pipeline/批次/审查 均已并入驾驶舱视图 tab） */
export type FunctionCard =
  | 'cockpit'
  | 'report'
  | 'plugins'
  | 'settings'
  | 'git-workspace';

export interface FunctionCardDef {
  id: FunctionCard;
  label: string;
  icon: React.ElementType;
  hint: string;
}

export const FUNCTION_CARDS: FunctionCardDef[] = [
  { id: 'cockpit', label: '流程驾驶舱', icon: I.gauge, hint: '阶段进度 · 门控 · 流向' },
  { id: 'report', label: '周报', icon: I.fileText, hint: '进度导出' },
  { id: 'plugins', label: '插件中心', icon: I.plugs, hint: '功能开关 · 社区插件' },
  { id: 'settings', label: '设置', icon: I.gear, hint: '模型管理 · 网关' },
  { id: 'git-workspace', label: 'Git 工作区', icon: I.branch, hint: '工作区状态 · 阶段留痕' },
];
