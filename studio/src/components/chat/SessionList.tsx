// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================
// SessionList — 对话会话管理（对话管理系统 UI）
// 终端对话区顶部的会话切换器：
//   - 下拉列出当前项目全部会话（标题 + 时间）
//   - 新建 / 切换 / 重命名 / 删除
// 数据源：chatStore（多会话 + localStorage 持久化）
// =============================================================================

import React from 'react';
import { useChatStore, type ChatSession } from '../../store/chatStore';
import { Icon } from '../ui';
import { I } from '../ui/icons';

/** 最近 N 个会话（按 updatedAt 倒序，含当前会话）—— 终端顶部快捷切换区数据源。
 *  sessions 已在 store 内按 updatedAt 倒序维护，这里只做裁剪 + 防御排序。 */
export function recentSessions(
  sessions: ChatSession[],
  currentId: string | null,
  limit = 5,
): ChatSession[] {
  const sorted = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (currentId) {
    // 当前会话排最前（高亮锚点），其余按时间紧随
    return [
      ...sorted.filter((s) => s.id === currentId),
      ...sorted.filter((s) => s.id !== currentId),
    ].slice(0, limit);
  }
  return sorted.slice(0, limit);
}

export const SessionList: React.FC = () => {
  const sessions = useChatStore((s) => s.sessions);
  const currentId = useChatStore((s) => s.currentSessionId);
  const newSession = useChatStore((s) => s.newSession);
  const switchTo = useChatStore((s) => s.switchTo);
  const rename = useChatStore((s) => s.rename);
  const remove = useChatStore((s) => s.remove);

  const [open, setOpen] = React.useState(false);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameVal, setRenameVal] = React.useState('');
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const current = sessions.find((s) => s.id === currentId);
  // 最近 5 个会话（含当前）—— 快捷切换区数据源（纯函数，可单测）
  const recent = React.useMemo(
    () => recentSessions(sessions, currentId, 5),
    [sessions, currentId],
  );

  // 点击外部关闭下拉
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  };

  return (
    <div className="relative" ref={listRef}>
      {/* 当前会话折叠态 */}
      <button
        className="flex items-center gap-1.5 max-w-[240px] text-xs px-2 py-1 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 transition-colors active:scale-[0.98]"
        onClick={() => setOpen((v) => !v)}
        title="会话管理"
      >
        <span className="text-zinc-400"><Icon name={I.chat} size={12} /></span>
        <span className="truncate text-zinc-700">{current?.title || '新会话'}</span>
        <span className="text-zinc-400 shrink-0">{sessions.length > 1 ? `(${sessions.length})` : ''}</span>
        <span className="text-zinc-400 shrink-0"><Icon name={I.caretDown} size={12} /></span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-[280px] bg-white border border-zinc-200 rounded-lg shadow-lg z-[65] overflow-hidden">
          {/* 新建 */}
          <button
            className="w-full px-3 py-2 text-sm text-emerald-600 hover:bg-emerald-50 flex items-center gap-2 border-b border-zinc-200 transition-colors active:scale-[0.98]"
            onClick={() => {
              newSession();
              setOpen(false);
            }}
          >
            <Icon name={I.plus} size={14} /> 新会话
          </button>

          {/* 会话列表 */}
          <div className="max-h-[300px] overflow-y-auto">
            {sessions.map((s) => {
              const active = s.id === currentId;
              return (
                <div
                  key={s.id}
                  className={`group flex items-center gap-1 px-2 py-1.5 border-b border-zinc-100 cursor-pointer transition-colors ${
                    active ? 'bg-emerald-50' : 'hover:bg-zinc-50'
                  }`}
                  onClick={() => {
                    switchTo(s.id);
                    setRenamingId(null);
                  }}
                >
                  {renamingId === s.id ? (
                    <input
                      autoFocus
                      className="flex-1 text-xs px-1.5 py-0.5 border border-zinc-300 rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          rename(s.id, renameVal);
                          setRenamingId(null);
                        }
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <>
                      <span className="flex-1 min-w-0">
                        <div className={`text-xs truncate ${active ? 'text-emerald-800 font-medium' : 'text-zinc-700'}`}>{s.title}</div>
                        <div className="text-xs text-zinc-400">{fmtTime(s.updatedAt)}</div>
                      </span>
                      {active && <span className="text-emerald-600 shrink-0"><Icon name={I.check} size={14} /></span>}
                      <span
                        className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-emerald-600 cursor-pointer transition-all shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(s.id);
                          setRenameVal(s.title);
                        }}
                        title="重命名"
                      >
                        <Icon name={I.edit} size={14} />
                      </span>
                      <span
                        className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-600 cursor-pointer transition-all shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(s.id);
                        }}
                        title="删除会话"
                      >
                        <Icon name={I.trash} size={14} />
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 最近会话快捷切换：最近 5 个一键直达，免开下拉 */}
      {recent.length > 1 && (
        <div className="mt-1 flex items-center gap-1 max-w-[240px] overflow-x-auto">
          <span className="text-zinc-400 shrink-0"><Icon name={I.clock} size={12} /></span>
          {recent.map((s) => {
            const active = s.id === currentId;
            return (
              <button
                key={s.id}
                className={`shrink-0 max-w-[120px] text-xs px-2 py-0.5 rounded-full border truncate transition-colors active:scale-[0.98] ${
                  active
                    ? 'bg-emerald-600 text-white border-emerald-600 font-medium'
                    : 'bg-white text-zinc-600 border-zinc-300 hover:border-emerald-300 hover:bg-emerald-50/40 hover:text-emerald-700'
                }`}
                onClick={() => switchTo(s.id)}
                title={`切换到会话：${s.title}`}
              >
                {s.title}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
