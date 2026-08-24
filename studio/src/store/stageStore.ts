// =============================================================================
// Stage Store - 25 阶段状态
// =============================================================================

import { create } from 'zustand';
import type { DshStageEntry, DshStageState, DshState, StageStatus, StageToken } from '../data/types';
import { STAGE_ORDER, STAGE_TABLE } from '../data/stage-mapping';
import * as ipc from '../utils/ipc';
import { useTaskStore } from './taskStore';
import { now } from '../utils/time';

interface StageStore {
  stages: Record<StageToken, StageStatus>;
  loading: boolean;
  lastUpdate: string;
  /** M1 数据源换血：当前常驻 harness session id（由网关返回）*/
  sessionId: string | null;
  /** 是否已订阅上网关 SSE 事件流 */
  eventsConnected: boolean;
  /** SQT 演示：dsh_state.json 最新原文（供驾驶舱直接读 gate.message）*/
  dshState: DshState | null;
  /** 手动回退：正则解析 PROGRESS.md / Tauri 命令 */
  refresh: (projectPath: string) => Promise<void>;
  /** SQT 演示：读取 .dsh/dsh_state.json 并把 SQT 6 子阶段合并进 stages */
  loadDshState: (projectPath: string) => Promise<void>;
  /** 订阅网关实时事件；收到 goal 事件时自动点亮阶段轨道 */
  connectEvents: (projectPath: string) => Promise<void>;
  /** 取消订阅并释放 EventSource */
  disconnectEvents: () => void;
  suggestNext: (stage: StageToken) => Promise<string | null>;
}

/** 当前 SSE 订阅的取消函数（模块级持有，避免挂到 store 对象上）*/
let eventsCancel: (() => void) | null = null;

/** 兜底导入 STAGE_TABLE 的 token 别名列表：goal 名（如 "swe_coding_do"/"sys.5"）与
 *  command/token 的匹配函数，见下方 matchStageByGoal */
const stageTokenNames: Record<string, StageToken[]> = {};
for (const token of STAGE_ORDER) {
  const m = STAGE_TABLE[token];
  const names = new Set<string>([
    token,
    m.command_name,
    m.command.replace(/^\/yxspec:/, ''),
    m.aspice.toLowerCase().replace(/[^a-z0-9.]/g, ''),
    m.aspice.toLowerCase().replace(/[^a-z0-9]/g, ''),
    m.aspice,
  ]);
  for (const n of names) {
    (stageTokenNames[n] = stageTokenNames[n] || []).push(token);
  }
}

/** 从 goal 名称（name/title/command 等）猜 stage token；
 *  匹配失败返回 null（此时只刷 lastUpdate，不点亮轨道） */
function matchStageByGoal(goal: any): StageToken | null {
  if (!goal || typeof goal !== 'object') return null;
  // 提取候选名称：兼容嵌套 goal 对象与扁平字段
  const lenient = (v: any): string =>
    typeof v === 'string' ? v.trim().toLowerCase() : '';
  const candidates: string[] = [
    lenient(goal.name),
    lenient(goal.title),
    lenient(goal.command),
    lenient(goal.command_name),
    lenient(goal.goal_name),
    lenient(goal.aspice),
    lenient(goal.token),
    lenient(goal.stage),
  ].filter(Boolean);

  for (const c of candidates) {
    const norm = c.replace(/^\/yxspec:/, '').replace(/^yxspec:/, '').replace(/\s+/g, '_');
    const hit = stageTokenNames[norm] || stageTokenNames[c] || stageTokenNames[c.replace(/[^a-z0-9]/g, '')];
    if (hit?.length) return hit[0];
  }
  // 兜底：goal 里有 token/stage 字段且直接命中 STAGE_ORDER
  for (const f of ['token', 'stage', 'stage_token']) {
    const v = lenient(goal[f]);
    if (v && (STAGE_ORDER as string[]).includes(v)) return v as StageToken;
  }
  // 再兜底：名称与 STAGE_TABLE 做子串/包含匹配
  const joined = candidates.join(' ');
  if (!joined) return null;
  for (const t of STAGE_ORDER) {
    const m = STAGE_TABLE[t];
    if (
      joined.includes(t) ||
      joined.includes(m.command_name) ||
      m.command_name.includes(joined) ||
      joined.includes(m.aspice.toLowerCase().replace(/[^a-z0-9]/g, ''))
    ) {
      return t;
    }
  }
  return null;
}

/** 从 goal 事件数据里取状态文本（嵌套 goal 对象或扁平字段）*/
function goalStateHint(goal: any): string {
  if (!goal || typeof goal !== 'object') return '';
  return [
    goal.state,
    goal.status,
    goal.progress_state,
    goal.reason,
    goal.message,
  ]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
}

/** 把 goal 事件映射为 StageStatus（部分字段；由调用方合并进当前 stages）*/
function goalToStageStatus(
  goal: any,
  token: StageToken,
): Partial<StageStatus> {
  const hint = goalStateHint(goal).toLowerCase();
  let status: StageStatus['status'] = 'in_progress';
  if (hint.includes('completed') || hint.includes('完成') || hint.includes('done')) {
    status = 'completed';
  } else if (hint.includes('running') || hint.includes('进行') || hint.includes('in_progress')) {
    status = 'in_progress';
  } else if (hint.includes('pending_review') || hint.includes('待审查')) {
    status = 'pending_review';
  } else if (hint.includes('rejected')) {
    status = 'rejected';
  } else if (hint.includes('blocked') || hint.includes('阻塞')) {
    status = 'blocked';
  } else if (hint.includes('stale')) {
    status = 'stale';
  } else if (hint.includes('pending') || hint.includes('未开始') || hint.includes('idle')) {
    status = 'pending';
  }
  return { token, status };
}

// 把 yxspec 7 状态（dsh_state）映射为驾驶舱 7 状态（types.ts StageStatusType）。
// 两者枚举重叠，仅 pending_review 是驾驶舱特有：契约 review=pending 时映射成 pending_review。
function mapDshStateToStageStatus(
  state: DshStageState,
  review: DshStageEntry['review'],
): StageStatus['status'] {
  if (state === 'pending') {
    return review === 'pending' ? 'pending_review' : 'pending';
  }
  if (state === 'in_progress') return 'in_progress';
  if (state === 'done') return 'completed';
  if (state === 'blocked') return 'blocked';
  if (state === 'stale') return 'stale';
  if (state === 'skipped') return 'pending';
  if (state === 'ready') return 'pending'; // 驾驶舱无 ready，按未开始展示
  return 'pending';
}

// 只映射 SQT 6 子阶段（dsh_state 契约只覆盖 SQT；其余阶段继续走 PROGRESS.md 推断）
const SQT_TOKENS: StageToken[] = [
  'sqt_strategy',
  'sqt_tr',
  'sqt_case_design',
  'sqt_script_gen',
  'sqt_auto_test',
  'sqt_defect_feedback',
];

export const useStageStore = create<StageStore>((set, get) => ({
  stages: {} as Record<StageToken, StageStatus>,
  loading: false,
  lastUpdate: '',
  sessionId: null,
  eventsConnected: false,
  dshState: null,

  refresh: async (projectPath: string) => {
    set({ loading: true });
    try {
      const all = await ipc.computeAllStatus(projectPath);
      const map = all.reduce(
        (acc, s) => {
          acc[s.token as StageToken] = s;
          return acc;
        },
        {} as Record<StageToken, StageStatus>,
      );
      set({ stages: map, lastUpdate: now(), loading: false });
    } catch (e) {
      console.error('refresh stages failed:', e);
      set({ loading: false });
    }
  },

  loadDshState: async (projectPath: string) => {
    const dsh = await ipc.fetchDshState(projectPath);
    if (!dsh) {
      console.warn('[stageStore] 未找到 .dsh/dsh_state.json，SQT 演示数据不生效');
      return;
    }
    // 契约 §1 只覆盖 SQT 6 子阶段：把它们合进 stages（preserve 已有非 SQT 阶段）
    const patch: Partial<Record<StageToken, StageStatus>> = {};
    for (const token of SQT_TOKENS) {
      const entry = dsh.stages?.[token];
      if (!entry) continue;
      const artifacts = Array.isArray(entry.artifacts)
        ? entry.artifacts.map((a) => a.path)
        : [];
      patch[token] = {
        token,
        status: mapDshStateToStageStatus(entry.state, entry.review),
        artifacts,
        review: null, // 审查细节仍由 M3 审查中心读 task_review_*.md
        last_update: entry.lastUpdate || dsh.updatedAt,
        message: entry.gate?.message || `来自 .dsh/dsh_state.json`,
        artifacts_count: artifacts.length,
        gate_message: entry.gate?.message || undefined,
      };
    }
    set((s) => ({
      stages: { ...s.stages, ...patch },
      dshState: dsh,
      lastUpdate: now(),
    }));
  },

  connectEvents: async (projectPath: string) => {
    // 若已订阅则先断开旧的，避免重复订阅重复回调
    get().disconnectEvents();
    const sid = get().sessionId || undefined;
    // 兜底：若有 sessionId 先拉一次快照（可能有 goal/change 已发生）
    if (sid) {
      const snap = await ipc.fetchSessionSnapshot(sid);
      if (snap?.goal) {
        const token = matchStageByGoal(snap.goal?.goal ?? snap.goal);
        if (token) {
          const patch = goalToStageStatus(snap.goal.goal ?? snap.goal, token);
          set((s) => ({
            stages: {
              ...s.stages,
              [token]: {
                ...(s.stages[token] || {}),
                ...patch,
                last_update: now(),
                message: '来自 harness 实时快照',
              } as StageStatus,
            },
            lastUpdate: now(),
          }));
        } else {
          console.debug('[stageStore] session 快照无匹配阶段:', snap.goal);
          set({ lastUpdate: now() });
        }
      }
    }
    // 订阅网关事件
    const hook = ipc.subscribeEvents((ev) => {
      const data = (ev.data || {}) as any;
      switch (ev.type) {
        case 'session/connected': {
          const got = data.session_id || get().sessionId;
          // 回放会带着目标 session_id
          set({
            sessionId: got || null,
            eventsConnected: true,
            lastUpdate: now(),
          });
          console.debug('[stageStore] SSE 已连接 session:', got);
          break;
        }
        case 'goal/change':
        case 'goal/created': {
          // data 形如 {session_id, goal: {...}} 或扁平字段
          const goal = (data.goal && typeof data.goal === 'object' ? data.goal : data) as any;
          const token = matchStageByGoal(goal);
          if (token) {
            const patch = goalToStageStatus(goal, token);
            set((s) => ({
              stages: {
                ...s.stages,
                [token]: {
                  ...(s.stages[token] || {}),
                  ...patch,
                  last_update: now(),
                  message: `来自 harness 实时事件 ${data.session_id ? `(${data.session_id})` : ''}`,
                } as StageStatus,
              },
              lastUpdate: now(),
            }));
            // 顺手记录 session（若事件带）
            if (data.session_id) set({ sessionId: data.session_id });
          } else {
            console.debug('[stageStore] goal 事件无匹配阶段:', goal);
            set({ lastUpdate: now() });
          }
          break;
        }
        case 'todo/write': {
          // M2 接入实时看板：把网关下发的 todos 导入 taskStore，驾驶舱任务区即时渲染
          const todos = data.todos;
          if (Array.isArray(todos)) {
            useTaskStore
              .getState()
              .importTodos(
                todos.map((t: any) => ({
                  id: typeof t?.id === 'string' ? t.id : String(t?.id ?? ''),
                  name: typeof t?.name === 'string' ? t.name : '',
                  status: typeof t?.status === 'string' ? t.status : 'pending',
                })),
              );
          }
          set({ lastUpdate: now() });
          break;
        }
        case 'turn/end': {
          set({ lastUpdate: now() });
          break;
        }
        default:
          break;
      }
    }, sid);
    // 保存取消函数供 disconnectEvents 调用
    eventsCancel = hook;
  },

  disconnectEvents: () => {
    if (eventsCancel) {
      try {
        eventsCancel();
      } catch (e) {
        console.warn('[stageStore] disconnectEvents failed:', e);
      }
    }
    eventsCancel = null;
    set({ eventsConnected: false });
  },

  suggestNext: async (stage: StageToken) => {
    return ipc.suggestNextCommand(stage);
  },
}));

// =============================================================================
// 辅助函数（组件用）
// =============================================================================

/** 找当前阶段（优先级：in_progress > pending_review > dsh_state.current > 最后一个 completed 之后）*/
export function findCurrentStage(
  stages: Record<StageToken, StageStatus>,
  dshCurrent?: string | null,
): StageToken | null {
  // 1. 优先 in_progress
  for (const t of STAGE_ORDER) {
    if (stages[t]?.status === 'in_progress') return t;
  }
  // 2. 次选 pending_review
  for (const t of STAGE_ORDER) {
    if (stages[t]?.status === 'pending_review') return t;
  }
  // 3. dsh_state 显式指定 current（SQT 演示：sqt_strategy）
  if (dshCurrent && (STAGE_ORDER as string[]).includes(dshCurrent)) {
    const tok = dshCurrent as StageToken;
    if (stages[tok]?.status !== 'completed') return tok;
  }
  // 4. 兜底：找最后一个 completed 之后的第一个非 completed
  let lastCompleted = -1;
  for (let i = 0; i < STAGE_ORDER.length; i++) {
    if (stages[STAGE_ORDER[i]]?.status === 'completed') lastCompleted = i;
  }
  if (lastCompleted >= 0 && lastCompleted < STAGE_ORDER.length - 1) {
    return STAGE_ORDER[lastCompleted + 1];
  }
  return null;
}

/** 统计阶段状态分布 */
export function countByStatus(
  stages: Record<StageToken, StageStatus>,
): Record<string, number> {
  const counts: Record<string, number> = {
    completed: 0,
    in_progress: 0,
    pending: 0,
    pending_review: 0,
    rejected: 0,
    blocked: 0,
    stale: 0,
  };
  for (const t of STAGE_ORDER) {
    const s = stages[t]?.status || 'pending';
    counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}

/** 整体进度百分比（已完成 / 总数）*/
export function overallProgress(stages: Record<StageToken, StageStatus>): number {
  let done = 0;
  for (const t of STAGE_ORDER) {
    if (stages[t]?.status === 'completed') done++;
  }
  return Math.round((done / STAGE_ORDER.length) * 100);
}

export { STAGE_TABLE };