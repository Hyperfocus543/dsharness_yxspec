// 驾驶舱门控视图（从 StageCockpit 拆出的视图切换壳的一部分，独立组件）
// 阶段门控概览（GateOverview 原实现）。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。

import React from 'react';
import { GateOverview } from './GateOverview';

export const StageGates: React.FC = () => <GateOverview />;
