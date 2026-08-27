// =============================================================================
// TerminalSection — 中央执行终端（工作台，占满剩余宽度，从 App.tsx 拆出）
// =============================================================================

import React from 'react';
import { Icon } from '../ui';
import { I } from '../ui/icons';
import { LLMConsole } from '../exec/LLMConsole';

interface TerminalSectionProps {
  activeCard: boolean;
  onCollapse: () => void;
}

export const TerminalSection: React.FC<TerminalSectionProps> = ({ activeCard, onCollapse }) => (
  <section className="flex-1 min-w-0 bg-zinc-50 flex flex-col">
    <div className="px-3 py-2 border-b border-zinc-200 bg-white flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-emerald-600"><Icon name={I.terminal} size={16} /></span>
        <span className="text-sm font-bold text-zinc-800">执行终端</span>
      </div>
      {activeCard && (
        <button
          className="text-xs px-2 py-1 bg-zinc-100 hover:bg-zinc-200 rounded text-zinc-600 flex items-center gap-1"
          onClick={onCollapse}
        >
          <Icon name={I.doubleLeft} size={14} />
          收右面板
        </button>
      )}
    </div>
    <div className="flex-1 overflow-hidden p-2">
      <LLMConsole />
    </div>
  </section>
);
