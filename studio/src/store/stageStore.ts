// =============================================================================
// Stage Store - 25 阶段状态
// =============================================================================

import { create } from 'zustand';
import type { DshGate, DshStageEntry, DshStageState, DshState, ResumeInfo, StageStatus, StageToken } from '../data/types';
import { STAGE_ORDER, STAGE_TABLE } from '../data/stage-mapping';
import * as ipc from '../utils/ipc';
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
  /** 断点续跑：网关 /api/resume 恢复信息（网关重启/休眠后前端据此显示「已恢复到 X 阶段」+ 一键续跑）*/
  resumeInfo: ResumeInfo | null;
  /** 执行成本统计：网关 /api/cost 聚合结果（null = 未加载/网关不可达）*/
  costData: ipc.CostData | null;
  /** 事件级流式：agent 最近一次工具动作（tool/call 或 tool/result），实时渲染"正在做…" */
  toolStatus: { kind: 'call' | 'result' | 'end'; name?: string; args?: string; error?: string | null } | null;
  /** 工具调用链累积缓冲（当前正在执行的 turn）：turn/start 清空，tool/result 追加，
   *  turn/end 交给对话流（pushAssistantWithTools）封存为消息内联轨迹 */
  toolTrace: { name: string; ok: boolean; error?: string | null; ts?: string }[];
  /** 手动回退：正则解析 PROGRESS.md / Tauri 命令 */
  refresh: (projectPath: string) => Promise<void>;
  /** SQT 演示：读取 .dsh/dsh_state.json 并把 SQT 6 子阶段合并进 stages */
  loadDshState: (projectPath: string) => Promise<void>;
  /** 断点续跑：拉取网关 /api/resume 恢复信息；失败静默不报错（保持现有行为）*/
  loadResume: (projectPath: string) => Promise<void>;
  /** 执行成本统计：拉取网关 /api/cost；失败静默置 null（不阻塞驾驶舱）*/
  loadCost: () => Promise<void>;
  /** 订阅网关实时事件；收到 goal 事件时自动点亮阶段轨道 */
  connectEvents: (projectPath: string) => Promise<void>;
  /** 取消订阅并释放 EventSource */
  disconnectEvents: () => void;
  /** 取走当前 turn 累积的工具链并清空缓冲（对话流 pushAssistant 时绑定到消息）*/
  consumeToolTrace: () => { name: string; ok: boolean; error?: string | null; ts?: string }[];
  suggestNext: (stage: StageToken) => Promise<string | null>;
}

/** 当前 SSE 订阅的取消函数（模块级持有，避免挂到 store 对象上）*/
let eventsCancel: (() => void) | null = null;

/** tool/call → tool/result 配对用的待定名（网关 result 只带 callId 不带 name）*/
let pendingToolName: string | null = null;

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

// 门控三态判定：上游布尔值是否有未完成（N）决定是"真阻塞"还是"正向/待补"。
// 这是驾驶舱提示风格（红/琥珀/绿）的唯一依据 —— 避免把"产物已存在可进 review"
// 这类正向提示误渲染成红色警告。导出供周报/其他组件复用（单一真源）。
export function computeGateState(gate: DshGate | undefined | null): StageStatus['gate_state'] {
  if (!gate) return undefined;
  const up = gate.upstream ?? {};
  const hasUnfinished = Object.values(up).some((ok) => ok === false);
  if (hasUnfinished) return 'blocked';
  if (!gate.spec_hit) return 'pending'; // 上游齐备但产物缺失 → 待补
  return 'ok'; // 上游齐备 + 产物命中 → 正向
}

// 只映射 dsh_state 中存在的阶段（契约原只覆盖 SQT 6 子阶段；铺满 25 阶段后覆盖全表）
// 从 dsh_state.stages 的键驱动，不再硬编码 token 列表，避免新旧契约分叉。

export const useStageStore = create<StageStore>((set, get) => ({
  stages: {} as Record<StageToken, StageStatus>,
  loading: false,
  lastUpdate: '',
  sessionId: null,
  eventsConnected: false,
  dshState: null,
  resumeInfo: null,
  costData: null,
  toolStatus: null,
  toolTrace: [],

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
    // 刷新恢复：从 localStorage 读回本项目的 sessionId（按 projectKey 隔离，切换项目不串）
    const storedSid = ipc.getStoredSessionId(projectPath);
    if (storedSid) {
      set({ sessionId: storedSid });
    }
    const dsh = await ipc.fetchDshState(projectPath);
    if (!dsh) {
      console.warn('[stageStore] 未找到 .dsh/dsh_state.json，SQT 演示数据不生效');
    } else {
      // 合并 dsh_state 里出现的全部阶段（不再只限 SQT 6：铺满 25 阶段后网关驱动全表）。
      // 只合并 dsh_state 实际有的 token，避免把 STAGE_TABLE 里废弃/变体节点也强行注入。
      const patch: Partial<Record<StageToken, StageStatus>> = {};
      for (const token of Object.keys(dsh.stages ?? {}) as StageToken[]) {
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
          gate_state: computeGateState(entry.gate),
        };
      }
      set((s) => ({
        stages: { ...s.stages, ...patch },
        dshState: dsh,
        lastUpdate: now(),
      }));
    }
    // 轨迹门控汇总（Phase 1 只读徽标）：GET /api/trajectory-gate 全量 → 各阶段三态
    // 失败静默（网关未起/无轨迹数据时不阻塞驾驶舱）
    try {
      const res = await fetch(`${ipc.GATEWAY_BASE}/api/trajectory-gate`);
      if (res.ok) {
        const data = await res.json();
        const gates = data?.gates ?? null;
        if (gates && typeof gates === 'object') {
          const trajPatch: Partial<Record<StageToken, StageStatus>> = {};
          for (const [token, g] of Object.entries(gates) as [string, any][]) {
            const t = token as StageToken;
            if (!STAGE_ORDER.includes(t)) continue;
            const st = g?.status;
            if (st === 'verified' || st === 'unverified' || st === 'blocked') {
              trajPatch[t] = {
                ...(get().stages[t] ?? { token: t, status: 'pending' as const, artifacts: [], review: null, last_update: now(), message: '' }),
                gate_policy: g?.gate_policy ?? undefined,
                gate_trajectory: st,
                gate_reason: g?.reason ?? undefined,
              } as StageStatus;
            }
          }
          if (Object.keys(trajPatch).length > 0) {
            set((s) => ({ stages: { ...s.stages, ...trajPatch }, lastUpdate: now() }));
          }
        }
      }
    } catch (e) {
      console.debug('[stageStore] 轨迹门控汇总不可用（网关未起或无轨迹）:', e);
    }
    // 恢复 session 后订阅网关实时事件（先拉 /api/session 快照再 SSE；
    // 重复调用会先 disconnect 再重连，幂等安全）
    await get()
      .connectEvents(projectPath)
      .catch((e) => console.warn('[stageStore] loadDshState→connectEvents 失败:', e));
  },

  loadResume: async (projectPath: string) => {
    // 断点续跑：拉取网关 /api/resume 恢复信息。
    // 失败静默不报错（网关未起 / 项目无 dsh_state / 网络错），保持现有行为 ——
    // 恢复提示条缺失不应影响驾驶舱正常使用。
    try {
      const info = await ipc.fetchResumeInfo(projectPath);
      set({ resumeInfo: info });
    } catch (e) {
      console.warn('[stageStore] loadResume 失败:', e);
      set({ resumeInfo: null });
    }
  },

  loadCost: async () => {
    // 执行成本统计：拉取网关 /api/cost 聚合审计账本。
    // 失败静默置 null（网关未起 / 路由未就绪），成本卡片显示空态不阻塞驾驶舱。
    try {
      const data = await ipc.fetchCost();
      set({ costData: data });
    } catch (e) {
      console.warn('[stageStore] loadCost 失败:', e);
      set({ costData: null });
    }
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
    // 订阅网关事件。
    // 不传 sessionId → 订阅全部频道（openSseStream 全频道模式）：无论派活来源
    // （LLMConsole/阶段卡片/编排脚本 verify-*）都能实时看到模型动作，不被 session 隔离挡住。
    // session 快照仍由下方 /api/session 单独拉取（refresh/loadDshState 已有兜底）。
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
          if (got) ipc.setStoredSessionId(projectPath, got);
          else if (!got) ipc.setStoredSessionId(projectPath, null);
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
            if (data.session_id) {
              set({ sessionId: data.session_id });
              ipc.setStoredSessionId(projectPath, data.session_id);
            }
          } else {
            console.debug('[stageStore] goal 事件无匹配阶段:', goal);
            set({ lastUpdate: now() });
          }
          break;
        }
        case 'todo/write': {
          // 任务看板已移除（用户确认用不上）；todo 事件仍用于刷新 lastUpdate 时间戳
          set({ lastUpdate: now() });
          break;
        }
        case 'tool/call': {
          // 事件级流式：agent 正在调用某工具 → 前端实时渲染"正在做…"
          const args = typeof data?.args === 'string' ? data.args : JSON.stringify(data?.args ?? '');
          // 记住本次调用名（网关 tool/result 只带 callId 不带 name，靠 pending 配对补名）
          const name = String(data?.name ?? 'tool');
          pendingToolName = name;
          set({
            toolStatus: { kind: 'call', name, args: args.slice(0, 300) },
            lastUpdate: now(),
          });
          break;
        }
        case 'tool/result': {
          const err = data?.error;
          // 配对 tool/call 的名字（串行闸门：一一对应）；无 pending 时用 callId 兜底
          const name = pendingToolName || String(data?.callId ?? 'tool');
          pendingToolName = null;
          set((s) => ({
            toolStatus: {
              kind: 'result',
              name: data?.callId ? `#${data.callId}` : undefined,
              args: undefined,
              error: typeof err === 'string' ? err : err ? String(err) : null,
            },
            // 累积进当前 turn 的工具链（对话流内联轨迹数据源）
            toolTrace: [
              ...s.toolTrace,
              { name, ok: !err, error: typeof err === 'string' ? err : err ? String(err) : null, ts: now() },
            ],
            lastUpdate: now(),
          }));
          break;
        }
        case 'stage/update': {
          // 阶段状态同步：后端完成回写后广播，前端直接用 payload 更新卡片（实时 done/blocked）
          const token = data.token as StageToken;
          if (token && data.state) {
            const artifacts = Array.isArray(data.artifacts) ? data.artifacts.map((a: any) => a.path) : [];
            const gate = data.gate ?? null;
            set((s) => ({
              stages: {
                ...s.stages,
                [token]: {
                  ...(s.stages[token] || {}),
                  token,
                  status: mapDshStateToStageStatus(data.state, null),
                  artifacts,
                  artifacts_count: artifacts.length,
                  gate_message: gate?.message || undefined,
                  gate_state: computeGateState(gate),
                  last_update: data.lastUpdate || now(),
                  message: `阶段 ${data.state === 'done' ? '完成' : data.state === 'blocked' ? '阻塞' : data.state}`,
                } as StageStatus,
              },
              dshState: s.dshState
                ? {
                    ...s.dshState,
                    stages: {
                      ...s.dshState.stages,
                      [token]: {
                        ...(s.dshState.stages[token] || {}),
                        state: data.state,
                        artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
                        gate,
                      },
                    },
                  }
                : s.dshState,
              lastUpdate: now(),
            }));
          }
          break;
        }
        case 'turn/end': {
          // turn 结束 → 清空流式工具状态（本轮动作渲染结束）；工具链留待对话流
          // 在 pushAssistant 时用 consumeToolTrace() 取走并绑定到消息（避免重复追加）
          pendingToolName = null;
          set({ toolStatus: null, lastUpdate: now() });
          break;
        }
        default:
          break;
      }
    });
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

  consumeToolTrace: () => {
    const trace = get().toolTrace;
    set({ toolTrace: [] });
    return trace;
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