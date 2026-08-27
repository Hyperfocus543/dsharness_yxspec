// =============================================================================
// ToolTraceInline — 对话流内联执行轨迹（折叠展开）
// 参照 DSH 官方 ChatView 的 turn 尾：assistant 回复底部一条"执行轨迹"折叠，
// 展开显示工具调用链（名称 + 成功/失败 + 错误信息 + 时间）。
// 数据来自 ChatItem.tools（SSE tool/call+result 事件累积，turn/end 封存）。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { Icon } from '../ui';
import { I } from '../ui/icons';

export interface ToolTraceItem {
  name: string;
  ok: boolean;
  error?: string | null;
  ts?: string;
}

/** 工具链摘要：成功 X / 失败 Y，如 "bash ✓4 · todo_write ✓1 · ✗1" */
function summary(tools: ToolTraceItem[]): string {
  const ok = tools.filter((t) => t.ok).length;
  const fail = tools.length - ok;
  const names = [...new Set(tools.map((t) => t.name))].slice(0, 3);
  const head = names.length > 0 ? `${names.join(' · ')}` : '工具';
  return `${head} · ${ok} 成功${fail > 0 ? ` / ${fail} 失败` : ''}`;
}

export const ToolTraceInline: React.FC<{ tools: ToolTraceItem[] }> = ({ tools }) => {
  const [open, setOpen] = React.useState(false);
  if (!tools || tools.length === 0) return null;
  const failCount = tools.filter((t) => !t.ok).length;

  return (
    <div className="mt-2 border-t border-zinc-100 pt-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-emerald-700 transition-colors"
      >
        <Icon name={open ? I.caretDown : I.caretRight} size={11} />
        <span className="inline-flex items-center gap-1">
          <Icon name={I.terminal} size={11} />
          执行轨迹
          <span className="font-mono">{summary(tools)}</span>
        </span>
        {failCount > 0 && (
          <span className="px-1 rounded bg-red-50 text-red-600 border border-red-200 text-[10px]">
            {failCount} 失败
          </span>
        )}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 pl-4 border-l border-zinc-200">
          {tools.map((t, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] font-mono">
              <span
                className={`shrink-0 mt-0.5 ${t.ok ? 'text-sage-600' : 'text-red-500'}`}
                title={t.ok ? '成功' : '失败'}
              >
                {t.ok ? '✓' : '✗'}
              </span>
              <span className="text-zinc-700">{t.name}</span>
              {t.error && <span className="text-red-500 truncate max-w-[200px]" title={t.error}>{t.error}</span>}
              {t.ts && <span className="ml-auto text-zinc-300 shrink-0">{t.ts.slice(11)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
