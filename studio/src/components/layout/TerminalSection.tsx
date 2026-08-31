// =============================================================================
// TerminalSection — 中央执行终端（工作台，从 App.tsx 拆出）
// 整体高度固定约 92.5% 屏高——留白区域不可拖拽调整。
// 宽度：右侧功能面板打开时终端固定宽度（右边缘可拖拽调宽，localStorage 记住），
//       面板关闭时终端 flex-1 自动占满。输入区高度单独在 LLMConsole 内调。
// =============================================================================

import React from 'react';
import { Icon } from '../ui';
import { I } from '../ui/icons';
import { LLMConsole } from '../exec/LLMConsole';

interface TerminalSectionProps {
  activeCard: boolean;
  onCollapse: () => void;
}

// 终端宽度 clamp 范围（px）：太窄装不下对话+输入，太宽会挤掉右侧面板
const clampWidth = (n: number) => Math.max(360, Math.min(1600, Math.round(n)));

export const TerminalSection: React.FC<TerminalSectionProps> = ({ activeCard, onCollapse }) => {
  // 整体高度：用户调试中——先按 92.5vh 看效果（观察对话区+输入框布局）。
  const height = Math.floor(window.innerHeight * 0.925);

  // 终端宽度：面板打开时固定可拖（默认 55% 视口宽），关闭时 flex-1 占满
  const [termWidth, setTermWidth] = React.useState<number>(() => {
    try {
      const raw = localStorage.getItem('yxspec-studio.terminal-width');
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) return clampWidth(n);
    } catch {
      /* ignore */
    }
    return clampWidth(window.innerWidth * 0.55);
  });
  const dragRef = React.useRef<{ startX: number; startW: number } | null>(null);

  // 拖拽终端右边缘 → 改变终端宽度（右拖变宽），面板 flex-1 自动跟随
  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = clampWidth(d.startW + (e.clientX - d.startX));
      setTermWidth(next);
      try {
        localStorage.setItem('yxspec-studio.terminal-width', String(next));
      } catch {
        /* ignore */
      }
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <section
      className={`min-w-0 bg-zinc-50 flex flex-col relative ${activeCard ? 'shrink-0' : 'flex-1'}`}
      style={{ height, width: activeCard ? termWidth : undefined }}
    >
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
      {/* 拖拽手柄：终端右边缘（面板打开时可调宽） */}
      {activeCard && (
        <div
          className="absolute -right-1 top-0 bottom-0 w-2 cursor-col-resize z-10 group"
          onMouseDown={(e) => {
            dragRef.current = { startX: e.clientX, startW: termWidth };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
          }}
          title="拖动调整终端宽度"
        >
          <div className="w-1 h-full mx-auto bg-transparent group-hover:bg-emerald-300 group-active:bg-emerald-500 transition-colors" />
        </div>
      )}
    </section>
  );
};
