// =============================================================================
// SessionList — 对话会话管理（对话管理系统 UI）
// 终端对话区顶部的会话切换器：
//   - 下拉列出当前项目全部会话（标题 + 时间）
//   - 新建 / 切换 / 重命名 / 删除
// 数据源：chatStore（多会话 + localStorage 持久化）
// =============================================================================

import React from 'react';
import { useChatStore } from '../../store/chatStore';

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
        className="flex items-center gap-1.5 max-w-[240px] text-xs px-2 py-1 bg-white border rounded hover:bg-gray-50"
        onClick={() => setOpen((v) => !v)}
        title="会话管理"
      >
        <span className="text-gray-400">💬</span>
        <span className="truncate text-gray-700">{current?.title || '新会话'}</span>
        <span className="text-gray-400 shrink-0">{sessions.length > 1 ? `(${sessions.length})` : ''}</span>
        <span className="text-gray-400 shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-[280px] bg-white border rounded-lg shadow-xl z-[65] overflow-hidden">
          {/* 新建 */}
          <button
            className="w-full px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-2 border-b"
            onClick={() => {
              newSession();
              setOpen(false);
            }}
          >
            <span>＋</span> 新会话
          </button>

          {/* 会话列表 */}
          <div className="max-h-[300px] overflow-y-auto">
            {sessions.map((s) => {
              const active = s.id === currentId;
              return (
                <div
                  key={s.id}
                  className={`group flex items-center gap-1 px-2 py-1.5 border-b hover:bg-blue-50/50 cursor-pointer ${
                    active ? 'bg-blue-50' : ''
                  }`}
                  onClick={() => {
                    switchTo(s.id);
                    setRenamingId(null);
                  }}
                >
                  {renamingId === s.id ? (
                    <input
                      autoFocus
                      className="flex-1 text-xs px-1.5 py-0.5 border rounded font-mono"
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
                        <div className="text-xs truncate">{s.title}</div>
                        <div className="text-[10px] text-gray-400">{fmtTime(s.updatedAt)}</div>
                      </span>
                      {active && <span className="text-emerald-600 text-xs shrink-0">✓</span>}
                      <span
                        className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-400 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(s.id);
                          setRenameVal(s.title);
                        }}
                      >
                        ✎
                      </span>
                      <span
                        className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-400 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(s.id);
                        }}
                      >
                        🗑
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
