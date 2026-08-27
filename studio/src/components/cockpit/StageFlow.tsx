// 驾驶舱流向视图（从 StageCockpit 拆出的视图切换壳的一部分，独立组件）
// 25 阶段产物链 React Flow 图（FlowView 原实现），节点颜色表达状态。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。

import React from 'react';
import { FlowView } from './FlowView';

interface StageFlowProps {
  onSelectStage?: (token: string) => void;
}

export const StageFlow: React.FC<StageFlowProps> = ({ onSelectStage }) => (
  <FlowView onSelectStage={onSelectStage} />
);
