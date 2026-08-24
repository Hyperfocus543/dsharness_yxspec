// M2 任务状态机看板
// 7 状态分组 + 任务卡 + 自动计时（启动记 started_at / 完成算 duration）

import React from 'react';
import type { Task, TaskStatusType } from '../../data/types';
import { VALID_TASK_TRANSITIONS } from '../../data/types';
import {
  groupByStatus,
  useTaskStore,
  type RealtimeTodo,
  reconcileTasks,
  progressStats,
} from '../../store/taskStore';
import { useToastStore } from '../../store/toastStore';
import { useAgentChat } from '../../hooks/useAgentChat';

const STATUS_LABELS: Record<TaskStatusType, string> = {
  pending: '⏳ 待启动',
  ready: '🟢 就绪',
  in_progress: '🔵 进行中',
  blocked: '🔴 阻塞',
  done: '✅ 完成',
  skipped: '⏭ 跳过',
  stale: '🟣 过期',
};

const STATUS_COLORS: Record<TaskStatusType, string> = {
  pending: 'border-gray-300 bg-gray-50',
  ready: 'border-green-300 bg-green-50',
  in_progress: 'border-blue-400 bg-blue-50',
  blocked: 'border-red-400 bg-red-50',
  done: 'border-emerald-400 bg-emerald-50',
  skipped: 'border-gray-400 bg-gray-100',
  stale: 'border-purple-400 bg-purple-50',
};

interface TaskCardProps {
  task: Task;
  /** P1：实时状态覆盖（todo 状态 ≠ 静态状态）*/
  overlayStatus?: TaskStatusType | null;
  onUpdate: (newStatus: TaskStatusType) => Promise<void>;
  /** P2：派活到单任务 */
  onDispatch?: (task: Task) => void;
  dispatchBusy?: boolean;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, overlayStatus, onUpdate, onDispatch, dispatchBusy }) => {
  const [open, setOpen] = React.useState(false);
  const validTargets = VALID_TASK_TRANSITIONS[task.status];
  // P1：显示状态 = 实时覆盖优先
  const shownStatus = overlayStatus ?? task.status;
  const colorCls = overlayStatus
    ? 'border-amber-400 bg-amber-50' // 实时覆盖高亮
    : STATUS_COLORS[task.status];

  return (
    <div className={`rounded border-2 ${colorCls} p-3 mb-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-gray-500">{task.id}</span>
            {task.realtimeOnly && (
              <span className="text-[10px] px-1 py-0.5 bg-red-100 text-red-700 rounded-full">
                实时
              </span>
            )}
            {task.done && <span className="text-xs text-emerald-600">done</span>}
            {overlayStatus && (
              <span className="text-[10px] px-1 py-0.5 bg-amber-200 text-amber-800 rounded-full">
                agent:{STATUS_LABELS[overlayStatus]}
              </span>
            )}
          </div>
          <div className="text-sm font-medium mt-1 truncate" title={task.name}>
            {task.name || '（无名称）'}
          </div>
          <div className="flex gap-2 mt-1 text-xs text-gray-500">
            <span>{task.type || '—'}</span>
            <span>·</span>
            <span>{task.module || '—'}</span>
          </div>
          {(task.started_at || task.duration) && (
            <div className="text-xs text-gray-400 mt-1">
              {task.started_at && (
                <span>开始 {task.started_at.split(' ')[1]}</span>
              )}
              {task.duration && task.duration !== '—' && (
                <span className="ml-2">耗时 {task.duration}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {onDispatch && !task.realtimeOnly && (
            <button
              className="text-xs px-2 py-0.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
              onClick={() => onDispatch(task)}
              disabled={dispatchBusy}
              title="把该任务派给模型执行"
            >
              {dispatchBusy ? '…' : '🚀 派活'}
            </button>
          )}
          <button
            className="text-xs text-blue-500 hover:underline"
            onClick={() => setOpen(!open)}
          >
            {open ? '收起' : '改状态'}
          </button>
        </div>
      </div>

      {open && validTargets.length > 0 && (
        <div className="mt-2 pt-2 border-t flex flex-wrap gap-1">
          {validTargets.map((t) => (
            <button
              key={t}
              className="text-xs px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-blue-50"
              onClick={() => {
                setOpen(false);
                onUpdate(t);
              }}
            >
              → {STATUS_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {open && (
        <details className="mt-2 text-xs text-gray-600">
          <summary className="cursor-pointer">详情</summary>
          <div className="mt-1 pl-2 space-y-1">
            <div>
              <span className="font-semibold">动作：</span>
              {task.action}
            </div>
            <div>
              <span className="font-semibold">验证：</span>
              {task.verify}
            </div>
          </div>
        </details>
      )}
    </div>
  );
};

interface TaskBoardProps {
  projectPath: string;
  taskFile: string;
  title?: string;
}

/** P1：实时 todo 差量说明条 —— 网格已吞并实时 todo，红条只显示未匹配/状态漂移 */
const RealtimeTodoSection: React.FC<{
  overlay: Map<string, TaskStatusType>;
  orphanTodos: RealtimeTodo[];
}> = ({ overlay, orphanTodos }) => {
  const overlayCount = overlay.size;
  if (overlayCount === 0 && orphanTodos.length === 0) return null;
  return (
    <div className="mb-4 border border-red-300 bg-red-50/50 rounded-lg overflow-hidden">
      <div className="bg-red-500 text-white px-3 py-1.5 text-xs font-bold flex items-center justify-between">
        <span>🔴 Agent 实时任务</span>
        <span className="bg-white/20 px-1.5 rounded-full text-[10px]">
          {overlayCount + orphanTodos.length}
        </span>
      </div>
      <div className="px-3 py-1.5 text-xs text-gray-700">
        {overlayCount > 0 && (
          <span>已并入网格 {overlayCount} 个（状态与静态表不同，卡片已高亮）</span>
        )}
        {overlayCount > 0 && orphanTodos.length > 0 && <span> · </span>}
        {orphanTodos.length > 0 && (
          <span>{orphanTodos.length} 个实时-only 任务已并入网格（黄色「实时」标记）</span>
        )}
      </div>
    </div>
  );
};

export const TaskBoard: React.FC<TaskBoardProps> = ({ projectPath, taskFile, title }) => {
  const load = useTaskStore((s) => s.load);
  const updateStatus = useTaskStore((s) => s.updateStatus);
  const tasks = useTaskStore((s) => s.byFile[taskFile] || []);
  const loading = useTaskStore((s) => !!s.loading[taskFile]);
  const realtimeTodos = useTaskStore((s) => s.todos);
  const pushToast = useToastStore((s) => s.push);
  // P2：派活到单任务（复用对话派活 hook，消息并入中央终端）
  const { send, loading: dispatchBusy } = useAgentChat();
  const [dispatchingId, setDispatchingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    load(projectPath, taskFile);
  }, [projectPath, taskFile]);

  // P1：实时 todo 与静态任务对账（网格为唯一真相）
  const { merged, overlay, orphanTodos } = React.useMemo(
    () => reconcileTasks(tasks, realtimeTodos),
    [tasks, realtimeTodos],
  );
  const grouped = React.useMemo(() => groupByStatus(merged), [merged]);
  // P3：进度按 status 计数 + 完成列布尔对比
  const stats = React.useMemo(() => progressStats(merged), [merged]);

  const handleUpdate = async (taskId: string, newStatus: TaskStatusType) => {
    try {
      const result = await updateStatus(projectPath, taskFile, taskId, newStatus);
      pushToast('success', `任务 ${taskId} → ${newStatus}（${result}）`);
    } catch (e: any) {
      pushToast('error', `更新失败: ${e?.message || e}`);
    }
  };

  // P2：组装任务 prompt 派活
  const handleDispatch = async (task: Task) => {
    if (!task.action && !task.verify) {
      pushToast('warn', '该任务缺少 action/verify，无法派活');
      return;
    }
    setDispatchingId(task.id);
    const prompt =
      `请执行任务 ${task.id}「${task.name}」。\n动作：${task.action}\n验证：${task.verify}\n请完成上述动作并满足验证条件。`;
    try {
      await send(prompt);
    } finally {
      setDispatchingId(null);
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-lg">
            {title || taskFile}
          </h3>
          <div className="text-xs text-gray-500 mt-1">
            {loading ? '加载中…' : `${stats.done}/${stats.total} 完成（${stats.pct}%）`}
          </div>
        </div>
        <button
          className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded"
          onClick={() => load(projectPath, taskFile)}
        >
          🔄 刷新
        </button>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
        <div
          className="bg-emerald-500 h-2 rounded-full transition-all"
          style={{ width: `${stats.pct}%` }}
        />
      </div>

      {/* P3 双口径说明 */}
      <div className="text-[11px] text-gray-400 mb-2">
        进度按状态 done={stats.done}（完成列 true={stats.doneFlag}）· 进行中 {stats.in_progress} · 阻塞 {stats.blocked} · 跳过 {stats.skipped} · 过期 {stats.stale}
      </div>

      <RealtimeTodoSection overlay={overlay} orphanTodos={orphanTodos} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {(Object.keys(STATUS_LABELS) as TaskStatusType[]).map((status) => {
          const items = grouped[status] || [];
          return (
            <div key={status} className="bg-white rounded p-2 border">
              <div className="text-xs font-semibold mb-2 flex items-center justify-between">
                <span>{STATUS_LABELS[status]}</span>
                <span className="bg-gray-100 px-1.5 rounded-full text-gray-600">
                  {items.length}
                </span>
              </div>
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {items.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    overlayStatus={overlay.get(t.id) ?? null}
                    onUpdate={(ns) => handleUpdate(t.id, ns)}
                    onDispatch={handleDispatch}
                    dispatchBusy={dispatchingId === t.id || (dispatchBusy && dispatchingId !== null)}
                  />
                ))}
                {items.length === 0 && (
                  <div className="text-xs text-gray-400 text-center py-2">—</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 text-xs text-gray-500">
        ℹ️ 改状态会自动写回 <code className="bg-gray-100 px-1 rounded">{taskFile}</code>
        ：启动任务记 started_at、完成任务自动算 duration（按 yxspec §1.3 规则省略高位零）。
        {realtimeTodos.length > 0 && ' 🔴 Agent 实时任务已并入网格（黄色高亮 = 状态漂移）。'}
      </div>
    </div>
  );
};