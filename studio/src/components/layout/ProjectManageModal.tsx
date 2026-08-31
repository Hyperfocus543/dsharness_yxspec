// =============================================================================
// ProjectManageModal — 项目管理弹窗（新建 / 复制 / 删除 三模式）
// 由 ProjectSwitcher 挂载：create / copy / delete 共用一套 Modal 骨架，
// 内部按 mode 切换视图。删除走双级确认（防误触"删除文件"）。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import * as ipc from '../../utils/ipc';
import { useProjectStore } from '../../store/projectStore';
import { useToastStore } from '../../store/toastStore';
import type { ProjectListItem } from '../../utils/ipc';
import { Button, Icon } from '../ui';
import { I } from '../ui/icons';

export type ManageMode = 'create' | 'copy' | 'delete';

interface Props {
  mode: ManageMode;
  /** 删除模式下目标项目（从预置列表行内按钮带入）*/
  target?: ProjectListItem;
  open: boolean;
  onClose: () => void;
  /** 可用的预置项目（copy 视图的源下拉）*/
  projects: ProjectListItem[];
  /** 成功回调：create/copy 传新项目绝对路径；delete 传 undefined */
  onDone: (newPath?: string) => void;
}

const inputCls =
  'w-full text-sm px-3 py-1.5 border border-zinc-300 rounded-md bg-white font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500';

export const ProjectManageModal: React.FC<Props> = ({ mode, target, open, onClose, projects, onDone }) => {
  // 表单状态
  const [name, setName] = React.useState('');
  const [source, setSource] = React.useState('');
  const [scope, setScope] = React.useState<'full' | 'skeleton'>('skeleton');
  const [includeGit, setIncludeGit] = React.useState(false);
  // 删除双级：confirmStep 0 = 一级确认，1 = 二级选择
  const [confirmStep, setConfirmStep] = React.useState(0);
  // busy / error
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pushToast = useToastStore((s) => s.push);

  // 每次打开时重置表单状态
  React.useEffect(() => {
    if (open) {
      setName('');
      setSource(target?.path || '');
      setScope('skeleton');
      setIncludeGit(false);
      setConfirmStep(0);
      setError(null);
    }
  }, [open, target]);

  if (!open) return null;

  const close = () => {
    if (busy) return; // 提交中禁止关闭
    onClose();
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () => {
    void run(async () => {
      const r = await ipc.createProject(name);
      pushToast('success', `项目已创建并打开：${r.name}`);
      onDone(r.path);
    });
  };

  const handleCopy = () => {
    void run(async () => {
      if (!source) throw new Error('请选择源项目');
      const r = await ipc.copyProject(source, name, scope, includeGit);
      pushToast('success', `项目已复制并打开：${r.name}（${scope === 'full' ? '完整复制' : '仅骨架'}）`);
      onDone(r.path);
    });
  };

  // 二级确认：仅移除加载项（不删文件）/ 删除文件并移除
  const handleDeleteFiles = (includeFiles: boolean) => {
    void run(async () => {
      if (!target) throw new Error('缺少目标项目');
      await ipc.deleteProject(target.path, includeFiles);
      if (includeFiles) {
        pushToast('success', `已删除本地文件并移除：${target.name}`);
      } else {
        pushToast('success', '已移除加载项，本地文件保留');
      }
      // 若删的是当前打开的项目，关掉它（自动回落空态）
      const cur = useProjectStore.getState().current;
      if (cur && cur.path === target.path) {
        useProjectStore.getState().close();
      }
      onDone(undefined);
    });
  };

  const title =
    mode === 'create' ? '新建项目' : mode === 'copy' ? '复制项目' : `删除项目${target ? '：' + target.name : ''}`;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center pt-24 bg-black/20 backdrop-blur-[1px] animate-fade-in"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md bg-white rounded-xl border border-zinc-200 shadow-xl p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-zinc-600">
              <Icon name={mode === 'delete' ? I.trash : mode === 'copy' ? I.clipboard : I.plus} size={16} />
            </span>
            <span className="text-sm font-bold text-zinc-800">{title}</span>
          </div>
          <button
            type="button"
            autoFocus
            onClick={close}
            disabled={busy}
            className="shrink-0 p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-all active:scale-[0.96] disabled:opacity-40"
            aria-label="关闭"
          >
            <Icon name={I.close} size={16} />
          </button>
        </div>

        {/* ---- create 视图 ---- */}
        {mode === 'create' && (
          <>
            <div className="space-y-1.5">
              <label className="block text-xs text-zinc-500">项目名称</label>
              <input
                className={inputCls}
                placeholder="例如：2026_101_客户简称_项目简称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) handleCreate();
                }}
                disabled={busy}
              />
              <p className="text-xs text-zinc-400">
                命名规范：<code className="font-mono">YYYY_项目编号_客户简称_项目简称</code>，将在{' '}
                <code className="font-mono">D:/Work/01_Projects/</code> 下创建文件夹并复制标准模板骨架。
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={close} disabled={busy}>
                取消
              </Button>
              <Button variant="primary" size="sm" onClick={handleCreate} disabled={busy || !name.trim()}>
                {busy ? '创建中…' : '创建并打开'}
              </Button>
            </div>
          </>
        )}

        {/* ---- copy 视图 ---- */}
        {mode === 'copy' && (
          <>
            <div className="space-y-1.5">
              <label className="block text-xs text-zinc-500">源项目</label>
              <select
                className={inputCls}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                disabled={busy}
              >
                <option value="">选择源项目…</option>
                {projects.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-zinc-500">新项目名称</label>
              <input
                className={inputCls}
                placeholder="例如：2026_102_客户简称_项目简称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && source && name.trim()) handleCopy();
                }}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer">
                  <input
                    type="radio"
                    name="copy-scope"
                    checked={scope === 'skeleton'}
                    onChange={() => setScope('skeleton')}
                    disabled={busy}
                  />
                  仅骨架结构
                </label>
                <label className="flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer">
                  <input
                    type="radio"
                    name="copy-scope"
                    checked={scope === 'full'}
                    onChange={() => setScope('full')}
                    disabled={busy}
                  />
                  完整复制
                </label>
              </div>
              {scope === 'full' && (
                <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeGit}
                    onChange={(e) => setIncludeGit(e.target.checked)}
                    disabled={busy}
                  />
                  包含 .git 历史（新项目继承源项目提交历史）
                </label>
              )}
              <p className="text-xs text-zinc-400">
                仅骨架 = 标准模板结构；完整复制 = 复制源项目全部内容（自动排除 node_modules / .dsh 等运行时产物）。
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={close} disabled={busy}>
                取消
              </Button>
              <Button variant="primary" size="sm" onClick={handleCopy} disabled={busy || !source || !name.trim()}>
                {busy ? '复制中…' : '复制并打开'}
              </Button>
            </div>
          </>
        )}

        {/* ---- delete 视图 ---- */}
        {mode === 'delete' && (
          <>
            <div className="rounded-lg border border-red-200 bg-red-50/40 p-2.5 space-y-1">
              <div className="flex items-center gap-1.5 text-sm text-red-700 font-medium">
                <Icon name={I.warn} size={15} weight="fill" />
                {confirmStep === 0 ? `确定删除项目「${target?.name || ''}」？` : '请选择删除方式'}
              </div>
              {target && (
                <div className="text-xs text-red-600 font-mono break-words">{target.path}</div>
              )}
            </div>

            {confirmStep === 0 ? (
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" size="sm" onClick={close} disabled={busy}>
                  取消
                </Button>
                <Button variant="danger" size="sm" onClick={() => setConfirmStep(1)}>
                  下一步
                </Button>
              </div>
            ) : (
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleDeleteFiles(false)}
                  disabled={busy}
                  title="只从加载列表移除，本地文件夹与文件保留"
                >
                  {busy ? '处理中…' : '仅移除加载项'}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleDeleteFiles(true)}
                  disabled={busy}
                  title="删除本地文件夹（不可恢复）并移除加载项"
                >
                  {busy ? '处理中…' : '删除文件并移除'}
                </Button>
              </div>
            )}
            <p className="text-xs text-zinc-400">
              {confirmStep === 1 ? (
                <>
                  警告：「删除文件并移除」会<strong className="text-red-600">永久删除本地文件夹</strong>，
                  不可恢复。仅移除加载项则保留本地文件，之后仍可从预置列表重新打开。
                </>
              ) : (
                '删除后不可自动恢复，请确认后再继续。'
              )}
            </p>
          </>
        )}

        {/* error 行 */}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700" role="status">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};
