// =============================================================================
// TerminalSection — 中央执行终端（工作台，从 App.tsx 拆出）
// 整体固定约 20% 屏高（上限 240px）——不占半屏；留白区域不可拖拽。
// 输入区（textarea）高度可在 LLMConsole 内单独拖动调整（见该组件）。
// =============================================================================

import React from 'react';
import { Icon } from '../ui';
import { I } from '../ui/icons';
import { LLMConsole } from '../exec/LLMConsole';

interface TerminalSectionProps {
  activeCard: boolean;
  onCollapse: () => void;
}

export const TerminalSection: React.FC<TerminalSectionProps> = ({ activeCard, onCollapse }) => {
  // 整体高度：约 20% 屏高、下限 300px（防装不下工具栏+对话区+输入区）。
  // 留白区域不可拖拽调整；若要更多输入空间，在 LLMConsole 里单独拉高输入区。
  // 240px 实测太矮：对话区 min-h 96 + 工具栏 + 模板行 + 输入区(3行) 会溢出挤压成大片留白。
  const height = Math.max(300, Math.floor(window.innerHeight * 0.2));

  return (
    <section className="min-w-0 bg-zinc-50 flex flex-col" style={{ height }}>
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
};
