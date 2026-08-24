// =============================================================================
// Task Store - 任务状态机（含写回）
// =============================================================================

import { create } from 'zustand';
import type { Task, TaskStatusType } from '../data/types';
import { VALID_TASK_TRANSITIONS } from '../data/types';
import * as ipc from '../utils/ipc';
import { now } from '../utils/time';

/** M2：网关 todo/write 下发的实时任务条目（契约 §2 todo/write shape）*/
export interface RealtimeTodo {
  id: string;
  name: string;
  status: string;
}

interface TaskStore {
  byFile: Record<string, Task[]>;
  loading: Record<string, boolean>;
  /** M2：agent 实时 todo 列表（来自网关 todo/write 事件），与 task_*.md 静态表独立 */
  todos: RealtimeTodo[];
  load: (projectPath: string, taskFile: string) => Promise<void>;
  updateStatus: (
    projectPath: string,
    taskFile: string,
    taskId: string,
    newStatus: TaskStatusType,
  ) => Promise<string>;
  getTasks: (taskFile: string) => Task[];
  /** M2：导入网关 todo/write 的实时任务 */
  importTodos: (todos: RealtimeTodo[]) => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  byFile: {},
  loading: {},
  todos: [],

  load: async (projectPath: string, taskFile: string) => {
    set((s) => ({ loading: { ...s.loading, [taskFile]: true } }));
    try {
      const tasks = await ipc.listTasks(projectPath, taskFile);
      set((s) => ({
        byFile: { ...s.byFile, [taskFile]: tasks },
        loading: { ...s.loading, [taskFile]: false },
      }));
    } catch (e) {
      console.error('load tasks failed:', e);
      set((s) => ({ loading: { ...s.loading, [taskFile]: false } }));
    }
  },

  updateStatus: async (
    projectPath: string,
    taskFile: string,
    taskId: string,
    newStatus: TaskStatusType,
  ) => {
    const tasks = get().byFile[taskFile] || [];
    const target = tasks.find((t) => t.id === taskId);
    if (!target) {
      throw new Error(`任务不存在: ${taskId}`);
    }
    // 校验状态转换
    if (!VALID_TASK_TRANSITIONS[target.status].includes(newStatus)) {
      throw new Error(
        `非法状态转换: ${target.status} -> ${newStatus}（合法目标: ${VALID_TASK_TRANSITIONS[target.status].join(', ')}）`,
      );
    }
    // 写回 yxspec
    const result = await ipc.updateTask(
      projectPath,
      taskFile,
      taskId,
      newStatus,
      now(),
    );
    // 重新加载
    await get().load(projectPath, taskFile);
    return result;
  },

  getTasks: (taskFile: string) => get().byFile[taskFile] || [],

  importTodos: (todos: RealtimeTodo[]) => {
    const list = Array.isArray(todos) ? todos : [];
    set({ todos: list });
    console.debug('[taskStore] importTodos:', list.length, '条');
  },
}));

/** 按状态分组 */
export function groupByStatus(tasks: Task[]): Record<TaskStatusType, Task[]> {
  const groups: Record<TaskStatusType, Task[]> = {
    pending: [],
    ready: [],
    in_progress: [],
    blocked: [],
    done: [],
    skipped: [],
    stale: [],
  };
  for (const t of tasks) {
    groups[t.status].push(t);
  }
  return groups;
}

// =============================================================================
// P1 实时 todo 与静态任务对账 + P3 进度统计（纯函数）
// =============================================================================

/** 归一化实时 todo 状态 → TaskStatusType（running → in_progress）*/
export function normalizeTodoStatus(s: string): TaskStatusType {
  const v = (s || 'pending').toLowerCase();
  if (v === 'running') return 'in_progress';
  switch (v) {
    case 'pending':
    case 'ready':
    case 'in_progress':
    case 'blocked':
    case 'done':
    case 'skipped':
    case 'stale':
      return v;
    default:
      return 'pending';
  }
}

export interface ReconcileResult {
  /** 合并后的任务（静态任务 + 未匹配的实时 todo 归并进来）*/
  merged: Task[];
  /** id → 实时状态覆盖（todo 状态 ≠ 静态状态 时记录）*/
  overlay: Map<string, TaskStatusType>;
  /** 未匹配到静态任务的实时 todo（孤儿，进网格新卡）*/
  orphanTodos: RealtimeTodo[];
}

/**
 * 对账：按 id 匹配实时 todo 与静态任务。
 * - 命中 → todo 实时状态叠加到静态卡（overlay 记录差异）
 * - 未命中 → 进 orphanTodos（网格里以「实时-only」卡渲染）
 */
export function reconcileTasks(
  staticTasks: Task[],
  todos: RealtimeTodo[],
): ReconcileResult {
  const overlay = new Map<string, TaskStatusType>();
  const orphanTodos: RealtimeTodo[] = [];
  const staticById = new Map(staticTasks.map((t) => [t.id, t]));

  for (const td of todos) {
    const norm = normalizeTodoStatus(td.status);
    const st = staticById.get(td.id);
    if (st) {
      if (norm !== st.status) overlay.set(td.id, norm);
    } else {
      orphanTodos.push(td);
    }
  }

  // 孤儿 todo 归并成 Task 卡（保持原有字段）
  const orphanTasks: Task[] = orphanTodos.map((td) => ({
    id: td.id,
    name: td.name || '（实时任务）',
    type: '',
    module: '',
    action: '',
    verify: '',
    status: normalizeTodoStatus(td.status),
    done: td.status === 'done',
    started_at: null,
    finished_at: null,
    duration: null,
    realtimeOnly: true,
  }));

  return { merged: [...staticTasks, ...orphanTasks], overlay, orphanTodos };
}

export interface ProgressStats {
  total: number;
  done: number;
  skipped: number;
  in_progress: number;
  blocked: number;
  stale: number;
  /** 完成列 =true 的个数（双口径对比用）*/
  doneFlag: number;
  pct: number;
}

/** 进度统计：统一按 task.status === 'done' 计数，附完成列布尔对比 */
export function progressStats(tasks: Task[]): ProgressStats {
  const total = tasks.length;
  let done = 0;
  let skipped = 0;
  let in_progress = 0;
  let blocked = 0;
  let stale = 0;
  let doneFlag = 0;
  for (const t of tasks) {
    if (t.done) doneFlag++;
    switch (t.status) {
      case 'done':
        done++;
        break;
      case 'skipped':
        skipped++;
        break;
      case 'in_progress':
        in_progress++;
        break;
      case 'blocked':
        blocked++;
        break;
      case 'stale':
        stale++;
        break;
      default:
        break;
    }
  }
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, skipped, in_progress, blocked, stale, doneFlag, pct };
}