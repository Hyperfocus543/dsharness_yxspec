// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================
// ProjectSwitcher — 全局项目切换器（P0-①）
// header 右上常驻：无论是否已打开项目都能切换。
// 交互：预置项目列表（/yxspec/projects）+ 最近打开记录（localStorage）
//       + 手动输入路径 + 刷新/复制路径/关闭。
// 未打开项目：折叠态直接显示 [选择预置项目…] + [输入路径…] + [打开项目]
// 已打开项目：折叠态显示当前项目名，点开菜单切换。
// =============================================================================

import React from 'react';
import * as ipc from '../../utils/ipc';
import { useProjectStore } from '../../store/projectStore';
import { useStageStore } from '../../store/stageStore';
import { useToastStore } from '../../store/toastStore';
import type { ProjectListItem } from '../../utils/ipc';
import { Icon } from '../ui';
import { I } from '../ui/icons';

const RECENT_KEY = 'yxspec-studio.recent-projects';
const MAX_RECENT = 5;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

/** 记入最近列表（去重置顶）*/
function remember(path: string) {
  saveRecent([path, ...loadRecent().filter((p) => p !== path)]);
}

interface Props {
  /** 当前已打开项目路径（null = 未打开）*/
  currentPath: string | null;
  /** 是否处于加载中 */
  loading: boolean;
}

export const ProjectSwitcher: React.FC<Props> = ({ currentPath, loading }) => {
  const [projects, setProjects] = React.useState<ProjectListItem[]>([]);
  const [recent, setRecent] = React.useState<string[]>([]);
  const [input, setInput] = React.useState('');
  const [open, setOpen] = React.useState(false); // 菜单是否展开
  const pushToast = useToastStore((s) => s.push);
  const loadProject = useProjectStore((s) => s.load);

  // 预置列表 + 最近记录
  React.useEffect(() => {
    let cancelled = false;
    ipc
      .listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list.filter((p) => p.hasProgress));
      })
      .catch(() => {});
    setRecent(loadRecent());
    return () => {
      cancelled = true;
    };
  }, []);

  // 当前项目变更时：刷新最近记录 + 折叠菜单
  React.useEffect(() => {
    if (currentPath) {
      remember(currentPath);
      setRecent(loadRecent());
      setInput(currentPath);
    }
    setOpen(false);
  }, [currentPath]);

  const openWith = (path: string) => {
    if (!path) return;
    if (path === currentPath) {
      setOpen(false);
      return;
    }
    loadProject(path);
    setOpen(false);
  };

  const handleEnter = () => {
    if (input.trim()) openWith(input.trim());
  };

  const menuItemCls =
    'w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 flex items-center gap-2 transition-colors';

  // ---------- 未打开项目：内联控件 ----------
  if (!currentPath) {
    return (
      <div className="flex items-center gap-2">
        {projects.length > 0 && (
          <select
            className="text-xs px-2 py-1 border border-zinc-300 rounded-md bg-white font-mono max-w-[220px]"
            value=""
            onChange={(e) => {
              const p = e.target.value;
              if (p) openWith(p);
            }}
            title="选择预置项目（D:/Work/01_Projects）"
          >
            <option value="">选择预置项目…</option>
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <input
          className="text-xs px-2 py-1 border border-zinc-300 rounded-md w-80 font-mono"
          placeholder="yxspec 项目路径（含 PROGRESS.md）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleEnter();
          }}
        />
        <button
          className="text-xs px-3 py-1 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleEnter}
          disabled={loading || !input.trim()}
        >
          {loading ? '打开中…' : '打开项目'}
        </button>
      </div>
    );
  }

  // ---------- 已打开项目：折叠态 + 下拉菜单 ----------
  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 text-xs px-2.5 py-1 border border-zinc-300 rounded-md bg-white hover:bg-zinc-50 max-w-[300px]"
        onClick={() => setOpen((v) => !v)}
        title="切换 / 管理当前项目"
      >
        <span className="font-mono truncate">{currentPath}</span>
        <span className={`text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <Icon name={I.caretDown} size={14} />
        </span>
      </button>

      {open && (
        <>
          {/* 点击外部关闭 */}
          <div className="fixed inset-0 z-[58]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-[340px] bg-white border border-zinc-200 rounded-lg shadow-xl z-[60] overflow-hidden">
            {/* 手动输入 + 打开 */}
            <div className="p-2 border-b border-zinc-200 bg-zinc-50 flex gap-1.5">
              <input
                className="flex-1 text-xs px-2 py-1 border border-zinc-300 rounded-md font-mono"
                placeholder="输入其他项目路径…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleEnter();
                }}
              />
              <button
                className="text-xs px-2 py-1 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleEnter}
                disabled={loading || !input.trim()}
              >
                {loading ? '…' : '打开'}
              </button>
            </div>

            {/* 最近打开 */}
            {recent.length > 0 && (
              <div className="py-1 border-b border-zinc-200">
                <div className="px-3 py-1 text-xs text-zinc-400">最近打开</div>
                {recent.map((p) => (
                  <button key={p} className={menuItemCls} onClick={() => openWith(p)}>
                    <span className="text-zinc-400">
                      <Icon name={I.clock} size={14} />
                    </span>
                    <span className="font-mono text-xs truncate">{p}</span>
                    {p === currentPath && (
                      <span className="ml-auto text-emerald-600 text-xs">
                        <Icon name={I.check} size={14} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* 预置项目 */}
            {projects.length > 0 && (
              <div className="py-1 border-b border-zinc-200">
                <div className="px-3 py-1 text-xs text-zinc-400">预置项目</div>
                {projects.map((p) => (
                  <button key={p.path} className={menuItemCls} onClick={() => openWith(p.path)}>
                    <span className="text-zinc-400">
                      <Icon name={I.database} size={14} />
                    </span>
                    <span className="text-xs truncate">{p.name}</span>
                    {p.path === currentPath && (
                      <span className="ml-auto text-emerald-600 text-xs">
                        <Icon name={I.check} size={14} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* 操作 */}
            <div className="py-1">
              <button
                className={menuItemCls}
                onClick={() => {
                  const path = useProjectStore.getState().current?.path;
                  if (path) {
                    useStageStore.getState().refresh(path);
                    pushToast('info', '已触发阶段刷新');
                  }
                  setOpen(false);
                }}
              >
                <span className="text-zinc-400">
                  <Icon name={I.refresh} size={14} />
                </span>
                <span className="text-xs">刷新当前项目状态</span>
              </button>
              <button
                className={menuItemCls}
                onClick={() => {
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(currentPath).catch(() => {});
                  }
                  pushToast('success', '项目路径已复制');
                  setOpen(false);
                }}
              >
                <span className="text-zinc-400">
                  <Icon name={I.clipboard} size={14} />
                </span>
                <span className="text-xs">复制项目路径</span>
              </button>
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-red-600 flex items-center gap-2 transition-colors"
                onClick={() => useProjectStore.getState().close()}
              >
                <span className="text-red-600">
                  <Icon name={I.xCircle} size={14} />
                </span>
                <span className="text-xs">关闭项目</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
