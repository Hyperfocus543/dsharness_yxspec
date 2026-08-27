// =============================================================================
// PluginCenter — 社区插件市场（原「插件中心」）
// 历史：曾整合「功能开关 + 社区插件」双 tab；架构重构后功能开关（配置语义）
// 已挪到「设置」卡的 ModelSettings 页，本组件只留插件相关。
//   · 社区插件：GitHub dsh-plugin 市场（CommunityMarket，数据源经网关缓存）
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { CommunityMarket } from '../community/CommunityMarket';

export const PluginCenter: React.FC = () => <CommunityMarket />;
