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
  return (
    <section className="flex-1 min-w-[360px] border-l border-zinc-200 bg-zinc-50 overflow-y-auto">
      {/* 单卡错误隔离：一个功能卡崩溃不白屏，显示降级提示 + 重试 */}
      <ErrorBoundary label={FUNCTION_CARDS.find((c) => c.id === card)?.label}>
        {renderFunctionCard(card, ctx)}
      </ErrorBoundary>
    </section>
  );
};
