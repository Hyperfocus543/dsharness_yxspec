// =============================================================================
// FunctionPanel — 右侧功能面板（从 App.tsx 拆出）
// 与对话终端并排，可拖拽调宽（localStorage 记住宽度）；单卡错误隔离
// （ErrorBoundary：一个功能卡崩溃不白屏，显示降级提示 + 重试）。
// =============================================================================

import React from 'react';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { FUNCTION_CARDS, type FunctionCard } from '../../navigation';
import type { FunctionCardCtx } from '../../functionCards';
import { renderFunctionCard } from '../../functionCards';

interface FunctionPanelProps {
  card: FunctionCard;
  ctx: FunctionCardCtx;
}

export const FunctionPanel: React.FC<FunctionPanelProps> = ({ card, ctx }) => {
  // 可拖拽面板宽度 —— 记住上次拖的大小（localStorage 持久化）
  const [panelWidth, setPanelWidth] = React.useState<number>(() => {
    try {
      const raw = localStorage.getItem('yxspec-studio.panel-width');
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) && n > 0 ? n : 820;
    } catch {
      return 820;
    }
  });
  const dragStateRef = React.useRef<{ startX: number; startW: number } | null>(null);

  // 拖拽调整面板宽度：mousedown 记录起点，mousemove 计算差值更新宽度
  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragStateRef.current;
      if (!d) return;
      // 向左拖 → 面板变宽（宽度 = 起点宽 + 起点x - 当前x），不限最小/最大
      const next = Math.max(0, d.startW + (d.startX - e.clientX));
      setPanelWidth(next);
      // 实时持久化到 localStorage
      try {
        localStorage.setItem('yxspec-studio.panel-width', String(next));
      } catch {
        /* ignore */
      }
    };
    const onUp = () => {
      dragStateRef.current = null;
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
    <div className="relative shrink-0 flex" style={{ width: panelWidth }}>
      {/* 拖拽手柄：左边缘 */}
      <div
        className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize z-10 group"
        onMouseDown={(e) => {
          dragStateRef.current = { startX: e.clientX, startW: panelWidth };
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
          e.preventDefault();
        }}
        title="拖动调整面板宽度"
      >
        <div className="w-1 h-full mx-auto bg-transparent group-hover:bg-emerald-300 group-active:bg-emerald-500 transition-colors" />
      </div>
      <section className="flex-1 border-l border-zinc-200 bg-zinc-50 overflow-y-auto">
        {/* 单卡错误隔离：一个功能卡崩溃不白屏，显示降级提示 + 重试 */}
        <ErrorBoundary label={FUNCTION_CARDS.find((c) => c.id === card)?.label}>
          {renderFunctionCard(card, ctx)}
        </ErrorBoundary>
      </section>
    </div>
  );
};
