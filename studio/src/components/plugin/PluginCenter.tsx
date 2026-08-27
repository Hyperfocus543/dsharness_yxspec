// =============================================================================
// PluginCenter — 插件中心（功能商店 + 社区插件市场 整合）
// 合并原「功能商店」与「社区插件市场」两张功能卡为一个页面，内部 tab 切换：
//   · 功能开关：yxspec 适配功能（FeatureSettings，来自网关 features.mjs）
//   · 社区插件：GitHub dsh-plugin 市场（CommunityMarket，数据源经网关缓存）
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { FeatureSettings } from '../settings/FeatureSettings';
import { CommunityMarket } from '../community/CommunityMarket';
import { Icon } from '../ui';
import { I } from '../ui/icons';

type Tab = 'features' | 'community';

const TABS: { id: Tab; label: string; icon: React.ElementType; hint: string }[] = [
  { id: 'features', label: '功能开关', icon: I.squares, hint: 'yxspec 适配功能启停' },
  { id: 'community', label: '社区插件', icon: I.plugs, hint: 'GitHub dsh 插件市场' },
];

export const PluginCenter: React.FC = () => {
  const [tab, setTab] = React.useState<Tab>('features');

  return (
    <div className="flex flex-col h-full">
      {/* Tab 切换条 */}
      <div className="flex items-center gap-1 px-4 pt-3 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-all active:scale-[0.97] ${
              tab === t.id
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : 'border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300'
            }`}
            onClick={() => setTab(t.id)}
            title={t.hint}
          >
            <Icon name={t.icon} size={13} />
            {t.label}
          </button>
        ))}
        <div className="ml-auto text-xs text-zinc-400 pr-1">插件中心</div>
      </div>

      {/* 面板内容 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'features' ? <FeatureSettings /> : <CommunityMarket />}
      </div>
    </div>
  );
};
