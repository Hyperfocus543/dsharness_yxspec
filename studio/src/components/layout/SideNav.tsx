// =============================================================================
// SideNav — 左侧功能卡栏（从 App.tsx 拆出）
// <768px 折叠为顶部横向滚动条（absolute 吸顶），≥768px 纵向侧栏。
// =============================================================================

import React from 'react';
import { Icon } from '../ui';
import { I } from '../ui/icons';
import { FUNCTION_CARDS, type FunctionCard } from '../../navigation';

interface SideNavProps {
  activeCard: FunctionCard | null;
  reportEnabled: boolean;
  onSelect: (card: FunctionCard | null) => void;
}

export const SideNav: React.FC<SideNavProps> = ({ activeCard, reportEnabled, onSelect }) => {
  // 可显示的左侧功能卡：周报仅当 ui-report 启用时出现
  const visibleCards = React.useMemo(
    () => FUNCTION_CARDS.filter((c) => c.id !== 'report' || reportEnabled),
    [reportEnabled],
  );
  return (
    <aside className="w-52 shrink-0 border-r bg-white flex flex-col p-2 gap-1.5 overflow-y-auto md:w-52 max-md:absolute max-md:left-0 max-md:right-0 max-md:top-0 max-md:z-20 max-md:w-full max-md:flex-row max-md:overflow-x-auto max-md:overflow-y-hidden max-md:border-r-0 max-md:border-b max-md:items-stretch max-md:flex-nowrap">
      {visibleCards.map((card) => {
        const active = activeCard === card.id;
        return (
          <button
            key={card.id}
            className={`rounded-lg border p-2.5 text-left transition-all active:scale-[0.98] max-md:w-40 max-md:shrink-0 ${
              active
                ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-200'
                : 'border-zinc-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40'
            }`}
            onClick={() => onSelect(active ? null : card.id)}
            title={active ? '收起面板' : card.hint}
          >
            <div className="flex items-center gap-2">
              <span className={`shrink-0 ${active ? 'text-emerald-600' : 'text-zinc-400'}`}>
                <Icon name={card.icon} size={18} />
              </span>
              <div>
                <div className={`text-sm font-semibold ${active ? 'text-emerald-800' : 'text-zinc-700'}`}>{card.label}</div>
                <div className="text-xs text-zinc-400">{card.hint}</div>
              </div>
              {active && <span className="ml-auto text-emerald-500 text-xs">◂</span>}
            </div>
          </button>
        );
      })}
    </aside>
  );
};
