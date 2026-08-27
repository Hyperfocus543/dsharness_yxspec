// =============================================================================
// ErrorBoundary — 功能卡渲染错误隔离（类组件，React 18 无官方函数式实现）
// 单卡崩溃不白屏：显示降级提示 + 重试按钮（重试 = 重置边界状态重新渲染）。
// =============================================================================

import React from 'react';
import { Icon } from './Icon';
import { I } from './icons';

interface Props {
  /** 降级提示文案（标明是哪个功能卡/面板） */
  label?: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[ErrorBoundary] ${this.props.label || 'panel'} 崩溃:`, error, info);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="p-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-5 text-center">
          <span className="inline-flex text-red-500 mb-2">
            <Icon name={I.warn} size={24} weight="fill" />
          </span>
          <div className="text-sm font-semibold text-red-700">
            {this.props.label ? `${this.props.label} 渲染出错` : '面板渲染出错'}
          </div>
          <div className="text-xs text-red-600/80 mt-1 break-words max-w-md mx-auto" title={error.message}>
            {error.message}
          </div>
          <button
            className="mt-3 text-xs px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded-md hover:bg-red-100 transition-all active:scale-[0.98] inline-flex items-center gap-1.5"
            onClick={this.handleRetry}
            title="重新渲染该功能卡"
          >
            <Icon name={I.refresh} size={13} />
            重试
          </button>
        </div>
      </div>
    );
  }
}
