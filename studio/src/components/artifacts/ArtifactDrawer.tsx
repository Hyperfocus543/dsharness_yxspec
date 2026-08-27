// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================
// ArtifactDrawer — 产物详情抽屉（需求 3）
// 点击驾驶舱阶段节点 → 右侧抽屉列出该阶段全部产物文件；
// 点击单个文件 → 通过 /yxspec 中间件读取并渲染 markdown 预览。
// 数据源：dsh_state.json 的 stages[token].artifacts（含 path/kind/size/mtime）
//         或 StageStatus.artifacts（string[] 路径列表），兼容两者。
// =============================================================================

import React from 'react';
import * as ipc from '../../utils/ipc';
import { useProjectStore } from '../../store/projectStore';
import type { DshArtifact, StageToken } from '../../data/types';
import { renderMarkdown } from '../../utils/markdown';
import { Icon } from '../ui';
import { I } from '../ui/icons';

interface ArtifactDrawerProps {
  open: boolean;
  token: StageToken | null;
  label: string;
  artifacts: DshArtifact[] | string[];
  onClose: () => void;
}

const KIND_ICON: Record<string, React.ElementType> = {
  markdown: I.fileText,
  gherkin: I.bolt,
  json: I.stack,
  file: I.link,
};

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

export const ArtifactDrawer: React.FC<ArtifactDrawerProps> = ({
  open,
  token,
  label,
  artifacts,
  onClose,
}) => {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [content, setContent] = React.useState<string>('');
  const [loadingContent, setLoadingContent] = React.useState(false);
  const projectPath = useProjectPath();

  // 可拖拽抽屉宽度：默认 820，记忆上次大小（与功能面板对齐）
  const [panelWidth, setPanelWidth] = React.useState<number>(() => {
    try {
      const raw = localStorage.getItem('yxspec-studio.drawer-width');
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) {
        // 初始 clamp 到屏宽内，防止存了异常值导致打开时完全不可见
        return Math.min(n, window.innerWidth - 10);
      }
      return 820;
    } catch {
      return 820;
    }
  });
  const dragStateRef = React.useRef<{ startX: number; startW: number } | null>(null);

  // 拖拽调整抽屉宽度（左边缘，向左拖变宽），实时持久化
  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragStateRef.current;
      if (!d) return;
      const next = Math.max(0, d.startW + (d.startX - e.clientX));
      setPanelWidth(next);
      try {
        localStorage.setItem('yxspec-studio.drawer-width', String(next));
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

  // 打开时重置选择
  React.useEffect(() => {
    if (!open) {
      setSelected(null);
      setContent('');
    }
  }, [open]);

  // 选中文件时读取内容
  React.useEffect(() => {
    if (!selected || !projectPath) {
      setContent('');
      return;
    }
    let cancelled = false;
    setLoadingContent(true);
    ipc
      .fetchArtifactContent(projectPath, selected)
      .then((text) => {
        if (!cancelled) setContent(text || '(空文件或读取失败)');
      })
      .catch(() => {
        if (!cancelled) setContent('读取失败');
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, projectPath]);

  if (!open) return null;

  // 归一化产物列表：DshArtifact[] 或 string[] → {path, kind?, size?, mtime?}
  const items: { path: string; kind?: string; size?: number; mtime?: string }[] =
    (artifacts || []).map((a) =>
      typeof a === 'string' ? { path: a } : { path: a.path, kind: a.kind, size: a.size, mtime: a.mtime },
    );

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/30 flex justify-end"
      onClick={onClose}
    >
      <div
        className="relative h-full bg-white shadow-xl border-l border-zinc-200 flex flex-col"
        style={{ width: panelWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 拖拽手柄：左边缘 */}
        <div
          className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize z-10 group"
          onMouseDown={(e) => {
            dragStateRef.current = { startX: e.clientX, startW: panelWidth };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
            e.stopPropagation();
          }}
          title="拖动调整产物详情宽度"
        >
          <div className="w-1 h-full mx-auto bg-transparent group-hover:bg-emerald-400 group-active:bg-emerald-600 transition-colors" />
        </div>
        {/* 头部 */}
        <div className="bg-zinc-800 text-white px-4 py-3 flex items-center justify-between shrink-0">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <Icon name={I.database} size={16} className="text-emerald-400" />
              <span>产物详情 · {label}</span>
            </div>
            <div className="text-xs opacity-70 font-mono">{token}</div>
          </div>
          <button
            className="w-8 h-8 rounded-md hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
            onClick={onClose}
            title="关闭"
          >
            <Icon name={I.close} size={14} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* 左侧：文件列表 */}
          <div className="w-72 shrink-0 border-r border-zinc-200 overflow-y-auto bg-zinc-50">
            {items.length === 0 ? (
              <div className="p-4 text-xs text-zinc-400">暂无产物</div>
            ) : (
              items.map((it) => {
                const name = it.path.split('/').pop() || it.path;
                const icon = it.kind ? KIND_ICON[it.kind] || I.link : I.link;
                const active = selected === it.path;
                return (
                  <button
                    key={it.path}
                    className={`w-full text-left px-3 py-2 border-b border-zinc-100 flex items-center gap-2 transition-colors ${
                      active ? 'bg-emerald-50 hover:bg-emerald-100' : 'hover:bg-zinc-100'
                    }`}
                    onClick={() => setSelected(it.path)}
                    title={it.path}
                  >
                    <span className={active ? 'text-emerald-600' : 'text-zinc-400'}>
                      <Icon name={icon} size={14} />
                    </span>
                    <span className={`text-xs truncate flex-1 ${active ? 'text-zinc-900' : 'text-zinc-700'}`}>
                      {name}
                    </span>
                    {it.size !== undefined && (
                      <span className="text-xs text-zinc-400 shrink-0">
                        {fmtSize(it.size)}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* 右侧：内容预览 */}
          <div className="flex-1 overflow-auto bg-white">
            {!selected ? (
              <div className="p-8 text-center text-sm text-zinc-400">
                点击左侧文件查看内容
              </div>
            ) : loadingContent ? (
              <div className="p-8 text-center text-sm text-amber-500 animate-pulse">
                加载中…
              </div>
            ) : (
              <div className="p-4">
                <div className="mb-2 text-xs text-zinc-400 font-mono break-all">
                  {selected}
                  {items.find((i) => i.path === selected)?.mtime
                    ? ` · ${fmtTime(items.find((i) => i.path === selected)!.mtime!)}`
                    : ''}
                </div>
                <div className="markdown-body text-sm text-zinc-800 leading-relaxed">
                  {renderMarkdown(content)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function useProjectPath(): string | null {
  return useProjectStore((s) => s.current?.path ?? null);
}
