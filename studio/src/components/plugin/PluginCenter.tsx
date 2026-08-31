// =============================================================================
// PluginCenter — 插件中心（功能开关 + 社区插件 双 tab）
// Tab1「功能开关」：FeatureSettings —— DSH 能力区（已装配插件/候选能力/基座，
//   Everything-is-a-Plugin 统一插件卡 + 开关）+ 功能商店区（yxspec 阶段规则注入，features.yaml）
// Tab2「社区插件」：CommunityMarket —— GitHub dsh-plugin 社区市场（网关缓存 6h）
// 历史：功能开关曾因「配置语义」挪进设置页 ModelSettings；用户反馈应放插件中心首页，
//   已移回本组件（ModelSettings 只留模型管理）。见 PluginCenter 历史注释。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { FeatureSettings } from '../settings/FeatureSettings';
import { CommunityMarket } from '../community/CommunityMarket';
import { Icon } from '../ui';
import { I } from '../ui/icons';

type PluginTab = 'features' | 'community';

export const PluginCenter: React.FC = () => {
  const [tab, setTab] = React.useState<PluginTab>('features');

  return (
    <div className="flex flex-col h-full">
      {/* 分段切换：功能开关 / 社区插件 */}
      <div className="flex items-center gap-0.5 bg-zinc-100 border border-zinc-200 rounded p-0.5 shrink-0 mx-3 mt-3">
        <button
          className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-all active:scale-[0.98] inline-flex items-center justify-center gap-1.5 ${
            tab === 'features'
              ? 'bg-white text-emerald-700 shadow-sm'
              : 'text-zinc-500 hover:bg-white/50'
          }`}
          onClick={() => setTab('features')}
          title="已装配插件/候选能力/基座 + yxspec 阶段规则开关"
        >
          <Icon name={I.squares} size={13} />
          功能开关
        </button>
        <button
          className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-all active:scale-[0.98] inline-flex items-center justify-center gap-1.5 ${
            tab === 'community'
              ? 'bg-white text-emerald-700 shadow-sm'
              : 'text-zinc-500 hover:bg-white/50'
          }`}
          onClick={() => setTab('community')}
          title="浏览/筛选 GitHub 社区插件"
        >
          <Icon name={I.cube} size={13} />
          社区插件
        </button>
      </div>

      {/* tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'features' ? <FeatureSettings /> : <CommunityMarket />}
      </div>
    </div>
  );
};
