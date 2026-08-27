// =============================================================================
// IPC 抽象层
// 关键设计：YXSpec Studio 必须能在两种模式下工作
//   1. 浏览器模式（开发/演示）：通过 fetch 直接读 yxspec 项目文件（相对路径）
//   2. Tauri 模式（生产）：通过 @tauri-apps/api invoke 调 Rust 命令
//
// 自动检测：window.__TAURI__（withGlobalTauri 注入）或 __TAURI_INTERNALS__
// （Tauri v2 必然注入）任一存在即视为 Tauri 模式。
// =============================================================================

import type {
  DshState,
  PipelineState,
  ProjectInfo,
  ResumeInfo,
  ReviewEntry,
  StageMapping,
  StageStatus,
  StageToken,
} from '../data/types';
import { STAGE_TABLE } from '../data/stage-mapping';

// 注意：Tauri v2 默认不注入 window.__TAURI__（需 withGlobalTauri:true），
// 但必然注入 __TAURI_INTERNALS__。这里两个都认，避免 Tauri 模式被误判成浏览器。
const isTauri =
  typeof window !== 'undefined' &&
  Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);

// =============================================================================
// 本地执行网关（后端 s2_a_gateway.py）地址
// 契约冻结：以下三个 API 均由后端网关提供
//   GET  /api/events   SSE 事件流（?session_id= 过滤）
//   GET  /api/session   session goal/todo 快照
//   POST /api/agent     派活（可选 session_id，返回真实 session_id）
// 默认 127.0.0.1:8001，可用 VITE_EXEC_GATEWAY 覆盖（与旧 LLMConsole 行为兼容）
// =============================================================================
// 默认 8787 = Track B 对话网关（server.mjs）。旧 8001 = s2_a_gateway.py（已弃用）。
// 可用 VITE_EXEC_GATEWAY 覆盖。
// 局域网挂载：浏览器与网关不在同一台机器时，127.0.0.1 指向访问者本机而连不到网关主机。
// 因此未显式指定时，用 window.location.hostname（访问 Vite 页面所用的主机名：
// 本机 = localhost，局域网 = 网关主机 IP）拼 :8787，让局域网机器也能连到网关。
export const GATEWAY_BASE: string =
  (import.meta as any)?.env?.VITE_EXEC_GATEWAY ||
  (typeof window !== 'undefined' && window.location
    ? `http://${window.location.hostname}:8787`
    : 'http://127.0.0.1:8787');

/** yxspec 车载嵌入式 ASPICE 流程助理系统提示词（Agent A 后端会把它并入 agent prompt）*/
export const YXSPEC_SYSTEM_PROMPT = '你是 yxspec 车载嵌入式 ASPICE 流程助理，回复简洁准确。';

/** 网关事件回调载荷（与后端 SSE 消息 {type, data} 对齐）*/
export type GatewayEvent = { type: string; data: any };

// =============================================================================
// sessionId 持久化（按 projectKey 隔离）
// key 格式：yxspec-studio.session.<projectKey>（projectKey 通常 = 项目绝对路径）
// 用途：刷新页面后 stageStore.sessionId 归零，SSE 不重连旧 session；刷新恢复时
// 从 localStorage 读回 sessionId → connectEvents 先拉 /api/session 快照再订阅，
// 驾驶舱状态即刻恢复，不必等下次派活。
// =============================================================================

/** 生成按项目隔离的 localStorage key */
function sessionStorageKey(projectKey: string): string {
  return `yxspec-studio.session.${projectKey}`;
}

/** 读取持久化的 sessionId（localStorage 不可用/无值时返回 null）*/
export function getStoredSessionId(projectKey: string): string | null {
  if (!projectKey) return null;
  try {
    const raw = localStorage.getItem(sessionStorageKey(projectKey));
    return raw ? raw : null;
  } catch {
    return null;
  }
}

/** 写入/清除持久化的 sessionId（传 null 清除；localStorage 不可用时静默忽略）*/
export function setStoredSessionId(projectKey: string, sessionId: string | null): void {
  if (!projectKey) return;
  try {
    if (sessionId) {
      localStorage.setItem(sessionStorageKey(projectKey), sessionId);
    } else {
      localStorage.removeItem(sessionStorageKey(projectKey));
    }
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

// =============================================================================
// 浏览器模式：通过 Vite 中间件 /yxspec/* 读取 yxspec 项目文件
// 流程：先调用 /yxspec/set-project?path=... 设置路径，然后通过 /yxspec/PROGRESS.md 等读取
// =============================================================================

async function setProjectPath(projectPath: string): Promise<void> {
  const res = await fetch(`/yxspec/set-project?path=${encodeURIComponent(projectPath)}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`设置 project 路径失败: ${text}`);
  }
}

async function fetchText(path: string): Promise<string> {
  const url = `/yxspec/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
  return res.text();
}

async function fetchJson<T>(path: string): Promise<T> {
  return JSON.parse(await fetchText(path));
}

// 浏览器模式的实现
async function browserOpenProject(projectPath: string): Promise<ProjectInfo> {
  await setProjectPath(projectPath);
  const raw = await fetchText('PROGRESS.md');
  return {
    path: projectPath,
    meta: parseProgressMeta(raw),
    progress_raw: raw,
  };
}

async function browserComputeAllStatus(_projectPath: string): Promise<StageStatus[]> {
  // 浏览器模式计算：读 PROGRESS.md 推断状态 + 服务端 glob 产物存在性（M5 产物图谱用）
  const raw = await fetchText('PROGRESS.md');
  const base = computeFromProgress(raw);
  try {
    const artifactMap = await browserGlobAllSpecs();
    return base.map((s) => {
      const files = artifactMap[s.token] || [];
      return { ...s, artifacts: files, artifacts_count: files.length };
    });
  } catch {
    return base;
  }
}

// 调用服务端 /yxspec/glob 一次性检查所有阶段的 spec_globs
async function browserGlobAllSpecs(): Promise<Record<string, string[]>> {
  const patternsByStage: Record<string, string[]> = {};
  for (const token of Object.keys(STAGE_TABLE) as StageToken[]) {
    patternsByStage[token] = STAGE_TABLE[token].spec_globs;
  }
  const res = await fetch('/yxspec/glob', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patterns: Object.values(patternsByStage).flat() }),
  });
  if (!res.ok) throw new Error(`glob 失败: ${res.status}`);
  const data = await res.json();
  if (!data?.ok || !Array.isArray(data?.results)) throw new Error('glob 返回格式异常');

  const result: Record<string, string[]> = {};
  // 逐阶段收集命中
  let rIdx = 0;
  for (const token of Object.keys(patternsByStage) as StageToken[]) {
    const files: string[] = [];
    for (const _pat of patternsByStage[token]) {
      const r = data.results[rIdx++];
      if (r?.matched) files.push(...r.matched);
    }
    result[token] = [...new Set(files)];
  }
  return result;
}

async function browserReadPipelineState(_projectPath: string): Promise<PipelineState | null> {
  try {
    return await fetchJson<PipelineState>('project/tasks/pipeline_state.json');
  } catch {
    return null;
  }
}

async function browserListReviews(_projectPath: string): Promise<ReviewEntry[]> {
  // 浏览器模式下遍历 project/specs/*/review-*.md + project/tasks/task_review_*.md
  // 由于浏览器无法直接 glob，需要先读 PROGRESS.md 推断
  const tasks = [
    'task_review_sqt_strategy.md',
    'task_review_sqt_tr.md',
    'task_review_sqt_case_design.md',
    'task_review_sqt_defect_feedback.md',
    'task_review_swe_analysis.md',
    'task_review_swe_arch.md',
    'task_review_swe_coding.md',
    'task_review_swe_coding_plan.md',
  ];
  const reviews: ReviewEntry[] = [];
  for (const f of tasks) {
    try {
      const raw = await fetchText(`project/tasks/${f}`);
      const stage = f.replace('task_review_', '').replace('.md', '');
      reviews.push({
        stage,
        review: parseReviewFromTask(raw),
        signoff_file: null,
      });
    } catch {
      // 文件不存在
    }
  }
  return reviews;
}

// =============================================================================
// 公共 API
// =============================================================================

// 动态导入 Tauri API，避免 Vite 在浏览器模式下静态解析
// 使用 Function 构造函数构造 eval 调用，彻底绕过 Vite 静态分析
// Tauri invoke 的类型化签名：让调用方能用 invoke<T>(...) 拿到类型化的 Promise
type TauriInvoke = <T>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

let tauriInvoke: TauriInvoke | null = null;
async function getTauriInvoke(): Promise<TauriInvoke | null> {
  if (tauriInvoke !== null) return tauriInvoke;
  try {
    const mod = await new Function('return import("@tauri-apps/api/tauri")')();
    tauriInvoke = mod.invoke as TauriInvoke;
    return tauriInvoke;
  } catch {
    tauriInvoke = null;
    return null;
  }
}

export async function openProject(projectPath: string): Promise<ProjectInfo> {
  if (isTauri) {
    const invoke = await getTauriInvoke();
    if (invoke) return invoke<ProjectInfo>('open_project', { projectPath });
  }
  return browserOpenProject(projectPath);
}

// =============================================================================
// 列出可用项目（可交互点：选择项目路径下拉）
// 浏览器模式经 Vite 中间件 /yxspec/projects 扫描 D:/Work/01_Projects；
// Tauri 模式暂不提供（无对应 Rust 命令），返回空数组。
// =============================================================================

export interface ProjectListItem {
  name: string;
  path: string;
  hasProgress: boolean;
}

async function browserListProjects(): Promise<ProjectListItem[]> {
  try {
    const res = await fetch('/yxspec/projects');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.projects) ? data.projects : [];
  } catch (e) {
    console.warn('[ipc] 列出项目失败:', e);
    return [];
  }
}

export async function listProjects(): Promise<ProjectListItem[]> {
  if (isTauri) return []; // Tauri 模式暂无命令，后续可加 Rust 命令
  return browserListProjects();
}

export async function computeAllStatus(projectPath: string): Promise<StageStatus[]> {
  if (isTauri) {
    const invoke = await getTauriInvoke();
    if (invoke) return invoke<StageStatus[]>('compute_all_status', { projectPath });
  }
  return browserComputeAllStatus(projectPath);
}

// =============================================================================
// M1「数据源换血」：实时事件订阅 + 快照 + 派活
// 浏览器模式与 Tauri 模式走同一套逻辑：Tauri webview 原生支持 EventSource，
// 直接订阅本地网关 127.0.0.1:8001（Tauri CSP 需允许 connect-src http://127.0.0.1:8001，
// 详见 tauri.conf.json / README 说明）。
// =============================================================================

/**
 * 订阅网关实时事件（SSE / EventSource）。
 * 浏览器模式与 Tauri 模式一致：new EventSource(...)，onmessage 里 JSON.parse 后回调。
 * 不传 sessionId → 订阅全部事件（subscribeAll），无论谁派活（含编排脚本 verify-*）
 * 都能看到模型实时动作。
 * @returns 取消订阅函数（调用后关闭连接并清理）
 */
export function subscribeEvents(
  onEvent: (ev: GatewayEvent) => void,
  sessionId?: string,
): () => void {
  const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
  const es = new EventSource(`${GATEWAY_BASE}/api/events${query}`);
  es.onmessage = (msg) => {
    try {
      const ev = JSON.parse(msg.data) as GatewayEvent;
      if (ev && typeof ev.type === 'string') onEvent(ev);
    } catch (e) {
      console.warn('[events] 解析 SSE 消息失败:', e);
    }
  };
  es.onerror = () => {
    // EventSource 会自动重连；仅打日志便于排查
    console.debug('[events] SSE 连接异常（自动重连中）');
  };
  return () => {
    es.onmessage = null;
    es.onerror = null;
    es.close();
  };
}

/**
 * 拉取指定 session 的 goal/todo 快照。
 * GET /api/session?session_id=...；失败返回 null（Tauri 与浏览器一致）。
 */
export async function fetchSessionSnapshot(
  sessionId: string,
): Promise<{ goal: any | null; todos: any[] } | null> {
  if (!sessionId) return null;
  try {
    const res = await fetch(
      `${GATEWAY_BASE}/api/session?session_id=${encodeURIComponent(sessionId)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { goal: data?.goal ?? null, todos: Array.isArray(data?.todos) ? data.todos : [] };
  } catch {
    return null;
  }
}

/**
 * 派活给真实模型（走网关 /api/agent）。
 *
 * 长任务轮询契约（网关 server.mjs）：
 *   POST /api/agent 不再阻塞等 turn 跑完 —— 长任务（3-5 分钟）若占着 HTTP 请求，
 *   客户端连接抖动会让 fetch 抛 "Failed to fetch" 且结果丢在网关里。
 *   新行为：
 *     · 门控拦截等即时结果  → HTTP 200，直接返回 {finish_reason, final_response, ...}
 *     · 真实推进（后台跑 turn）→ HTTP 202，返回 {task_id, session_id, accepted}
 *   调用方拿 task_id 后应走 pollTask() 轮询直到终态。
 *
 * @returns {Promise<any>} 即时结果，或 {task_id, session_id, accepted}
 */
export async function runAgent(
  prompt: string,
  opts?: { system?: string; sessionId?: string; model?: string },
): Promise<any> {
  const res = await fetch(`${GATEWAY_BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      system: opts?.system,
      session_id: opts?.sessionId || undefined,
      model: opts?.model || undefined,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
  }
  return data;
}

// =============================================================================
// 长任务轮询（网关后台任务） —— GET /api/tasks/:id
// 派活后若拿到 task_id，用 pollTask 轮询到 done|error 终态。
// =============================================================================

/** 任务终态：{status, result|error}（result = 原 /api/agent 的即时结果体）*/
export interface TaskStatus {
  task_id: string;
  /** running=还在跑；done=有 result（含 blocked/aborted）；error=网关内部异常 */
  status: 'running' | 'done' | 'error';
  session_id: string | null;
  result: {
    finish_reason?: string;
    final_response?: string;
    session_id?: string;
    error?: unknown;
    stage?: string | null;
    artifacts?: unknown[];
    gate?: unknown;
    model?: string | null;
  } | null;
  error: unknown;
  created_at: string;
}

/**
 * 拉取一次任务状态。
 * 三态返回（关键：区分「网络抖动」与「任务丢失」）：
 *   TaskStatus      正常返回（running/done/error）
 *   'missing'       任务不存在（404，网关重启后内存清空）—— 真丢失，调用方应退出
 *   null            网络错误/抖动 —— 调用方应退避重试，不能误判为丢失
 */
export async function fetchTask(taskId: string): Promise<TaskStatus | 'missing' | null> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/api/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) return 'missing';
    if (!res.ok) return null;
    return (await res.json()) as TaskStatus;
  } catch {
    // 网络抖动：调用方重试轮询
    return null;
  }
}

/**
 * 轮询长任务直到终态（done/error）或超时。
 * @param taskId 派活拿到的 task_id
 * @param opts.timeoutMs 总超时，默认 15 分钟（长阶段 3-5 分钟，留足余量）
 * @param opts.intervalMs 轮询间隔，默认 3s（turn 长，不需要高频）
 * @param opts.shouldStop 每轮轮询前检查；返回 true 则立即停止（用于用户取消）
 * @param opts.onPoll 每次查询后的回调（可用于刷新 UI 进度），查询异常时为 null
 * @returns 终态 TaskStatus；超时/任务丢失/被 shouldStop 中止返回 null
 */
export async function pollTask(
  taskId: string,
  opts?: {
    timeoutMs?: number;
    intervalMs?: number;
    shouldStop?: () => boolean;
    onPoll?: (t: TaskStatus | null) => void;
  },
): Promise<TaskStatus | null> {
  const timeout = opts?.timeoutMs ?? 15 * 60 * 1000;
  const interval = opts?.intervalMs ?? 3000;
  const deadline = Date.now() + timeout;
  // 轮询是短请求，天然免疫长连接超时；偶发网络错误不中断，退避后重试
  let backoff = 1000;
  while (Date.now() < deadline) {
    if (opts?.shouldStop?.()) return null; // 用户取消 → 立即停止
    const t = await fetchTask(taskId);
    // onPoll 只看"是否拿到状态"（网络抖动/丢失给 null，不外泄 'missing' 细节）
    opts?.onPoll?.(t === 'missing' ? null : t);
    // 先排除 'missing'（任务真丢失，网关重启），再按 status 判断终态
    if (t === 'missing') return null;
    if (t?.status === 'done' || t?.status === 'error') return t;
    if (t === null) {
      // 网络抖动：退避重试，不中断（最长退避 5s）
      await sleep(Math.min(backoff, 5000));
      backoff *= 1.5;
      continue;
    }
    // running：正常间隔轮询
    await sleep(interval);
    backoff = 1000;
  }
  return null; // 超时
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 便捷工具：判断某 TaskStatus.result 是否为门控拦截 */
export function isTaskBlocked(t: TaskStatus): boolean {
  return t?.status === 'done' && t?.result?.finish_reason === 'blocked';
}

/** 便捷工具：判断某 TaskStatus.result 是否为用户取消 */
export function isTaskAborted(t: TaskStatus): boolean {
  return t?.status === 'done' && t?.result?.finish_reason === 'aborted';
}

// =============================================================================
// 模型管理 API（网关 /api/models*）
// =============================================================================

export interface ModelEntry {
  /** 唯一 id；缺省时网关按 provider/model 生成 */
  id?: string;
  provider: string;
  model: string;
  label?: string;
  modalities?: string[];
  contextWindow?: number | null;
  maxTokens?: number;
}

export interface ModelsResponse {
  ok: boolean;
  defaultModelId: string;
  models: ModelEntry[];
  current: { provider: string; model: string; maxTokens: number } | null;
}

async function modelsFetch(url: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export async function getModels(): Promise<ModelsResponse> {
  return modelsFetch(`${GATEWAY_BASE}/api/models`);
}

export async function setDefaultModel(modelId: string): Promise<any> {
  return modelsFetch(`${GATEWAY_BASE}/api/models/default`, {
    method: 'POST',
    body: JSON.stringify({ modelId }),
  });
}

export async function addModel(entry: ModelEntry): Promise<any> {
  return modelsFetch(`${GATEWAY_BASE}/api/models`, {
    method: 'POST',
    body: JSON.stringify({ entry }),
  });
}

export async function removeModel(id: string): Promise<any> {
  return modelsFetch(`${GATEWAY_BASE}/api/models`, {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  });
}

export async function applyModel(): Promise<any> {
  return modelsFetch(`${GATEWAY_BASE}/api/models/apply`, { method: 'POST' });
}

// =============================================================================
// 功能商店 API（网关 /api/features*）
// 网关真相源：features.mjs 注册表 + project/config/features.yaml
// =============================================================================

export interface FeatureItem {
  id: string;
  name: string;
  desc: string;
  appliesTo: string[];
  cost: string;
  depends: string[];
  available: boolean;
  always: boolean;
  enabled: boolean;
  loaded: { path: string } | null;
  /** 纯 UI 功能（如周报）：不进 agent prompt，只控制前端功能卡显隐 */
  uiOnly?: boolean;
  /** 用户自定义功能（custom-features.yaml 写入）标记 */
  custom?: boolean;
  /** A+A：该 feature 对应的 harness 原生 dsh skill（存在 .dsh/skills/<id>/SKILL.md 才有值） */
  skill?: { name: string; invocation: 'model-invocable' | 'model-disabled' } | null;
}

export interface FeatureSkillItem {
  id: string;
  name: string;
  desc: string;
  description: string;
  enabled: boolean;
  invocation: 'model-invocable' | 'model-disabled';
  source: string;
  path: string;
}

export interface FeaturesResponse {
  ok: boolean;
  features: FeatureItem[];
}

export interface FeatureSkillsResponse {
  ok: boolean;
  skills: FeatureSkillItem[];
}

/** 新增自定义功能所需字段（与后端 addCustomFeature 对齐）。 */
export interface CustomFeatureFields {
  id: string;
  name: string;
  desc?: string;
  appliesTo: string[] | string;
  cost?: string;
  defaultEnabled?: boolean;
  ruleFile?: string;
  maxChars?: number;
}

/** 拉取全部功能条目（元数据 + 启用状态 + 规则可加载性）。 */
export async function getFeatures(): Promise<FeaturesResponse> {
  return modelsFetch(`${GATEWAY_BASE}/api/features`);
}

/** A+A：拉取 .dsh/skills 下已生成的原生 dsh skill 只读清单。 */
export async function getFeatureSkills(): Promise<FeatureSkillsResponse> {
  return modelsFetch(`${GATEWAY_BASE}/api/features/skills`);
}

/** 设置开关；灰置（available=false）会得到 HTTP 400（后端拒绝）。 */
export async function setFeature(id: string, enabled: boolean): Promise<any> {
  return modelsFetch(`${GATEWAY_BASE}/api/features/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

/** 新增自定义功能（POST /api/features/custom）；校验失败后端返回 HTTP 400。 */
export async function addCustomFeature(fields: CustomFeatureFields): Promise<any> {
  return modelsFetch(`${GATEWAY_BASE}/api/features/custom`, {
    method: 'POST',
    body: JSON.stringify(fields),
  });
}

/** 删除自定义功能（DELETE /api/features/custom/{id}）。 */
export async function removeCustomFeature(id: string): Promise<any> {
  return modelsFetch(`${GATEWAY_BASE}/api/features/custom/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function readPipelineState(projectPath: string): Promise<PipelineState | null> {
  if (isTauri) {
    const invoke = await getTauriInvoke();
    if (invoke) return invoke<PipelineState | null>('read_pipeline_state', { projectPath });
  }
  return browserReadPipelineState(projectPath);
}

export async function listReviews(projectPath: string): Promise<ReviewEntry[]> {
  if (isTauri) {
    const invoke = await getTauriInvoke();
    if (invoke) return invoke<ReviewEntry[]>('list_reviews', { projectPath });
  }
  return browserListReviews(projectPath);
}

// =============================================================================
// dsh_state.json 读取（SQT 最小演示 · 契约 .dsh/CONTRACT.md §1）
// 浏览器模式：Vite 中间件 /yxspec/.dsh/dsh_state.json（set-project 后即可读）
// Tauri 模式：调用 Rust 命令 read_dsh_state（尚未实现时返回 null）
// 两种模式任何失败都返回 null，调用方按"无 dsh_state"降级。
// =============================================================================
async function browserFetchDshState(): Promise<DshState | null> {
  try {
    return await fetchJson<DshState>('.dsh/dsh_state.json');
  } catch (e) {
    console.warn('[ipc] 读取 .dsh/dsh_state.json 失败（浏览器模式）:', e);
    return null;
  }
}

export async function fetchDshState(projectPath: string): Promise<DshState | null> {
  if (isTauri) {
    const invoke = await getTauriInvoke();
    if (invoke) {
      try {
        return await invoke<DshState | null>('read_dsh_state', { projectPath });
      } catch (e) {
        console.warn('[ipc] read_dsh_state 命令不可用（Tauri 模式），按无 dsh_state 降级:', e);
        return null;
      }
    }
  }
  return browserFetchDshState();
}

/**
 * 断点续跑：拉取网关 GET /api/resume 恢复信息。
 * 网关重启/电脑休眠后前端据此显示「已恢复到 X 阶段」+ 一键续跑。
 * 失败（网关未起/项目无 dsh_state/结构异常）静默返回 null，保持现有加载链行为，
 * 不抛错不 toast —— 恢复提示条缺失不应影响驾驶舱正常使用。
 */
export async function fetchResumeInfo(projectPath: string): Promise<ResumeInfo | null> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/api/resume`);
    if (!res.ok) return null;
    const data = (await res.json()) as ResumeInfo;
    // 结构校验：resumable 为 false 或 current 缺失时仍返回（前端据此不渲染提示条），
    // 但必须保证字段形态可被前端安全读取。
    if (!data || typeof data !== 'object') return null;
    if (typeof data.resumable !== 'boolean') data.resumable = Boolean(data.current && data.currentIndex >= 0);
    return data;
  } catch {
    return null; // 网关未起 / 网络错：静默降级
  }
}

/** 读取单个产物文件全文（浏览器模式经 /yxspec 中间件；Tauri 经 read_file 命令）。 */
export async function fetchArtifactContent(
  projectPath: string,
  relPath: string,
): Promise<string | null> {
  const clean = relPath.replace(/^\/+/, '');
  if (isTauri) {
    const invoke = await getTauriInvoke();
    if (invoke) {
      try {
        return await invoke<string | null>('read_file', {
          projectPath,
          relPath: clean,
        });
      } catch {
        return null;
      }
    }
  }
  try {
    return await fetchText(clean);
  } catch (e) {
    console.warn('[ipc] 读取产物内容失败:', clean, e);
    return null;
  }
}

export async function suggestNextCommand(stage: string): Promise<string | null> {
  if (isTauri) {
    const invoke = await getTauriInvoke();
    if (invoke) return invoke<string | null>('suggest_next_command', { stage });
  }
  // 浏览器模式：直接从 STAGE_TABLE 计算
  const mapping: StageMapping | undefined = STAGE_TABLE[stage as StageToken];
  if (!mapping) return null;
  if (mapping.downstream.length > 0) {
    const next = mapping.downstream[0];
    const cmd = STAGE_TABLE[next].command;
    // 只返回真正的 /yxspec: 命令；无 slash 命令阶段（如 comp/traceability 的占位符）不可派活
    if (cmd && cmd.startsWith('/yxspec:')) return cmd;
    // 无有效下游命令 → 回退到当前阶段的 review 建议
    if (mapping.review_gate === 'yes') {
      return `/yxspec:review ${stage}`;
    }
    return null;
  }
  if (mapping.review_gate === 'yes') {
    return `/yxspec:review ${stage}`;
  }
  return null;
}

// =============================================================================
// 执行成本统计 API（网关 /api/cost）
// 聚合审计账本（.dsh/gateway-log）按阶段统计负载：耗时/次数/工具调用。
// 账本未记 token usage → prompt/completionTokens 恒 0，hasTokenData=false；
// 单价可经网关环境变量配置，未配置为 0（不估金额）。
// =============================================================================

export interface CostStageStat {
  token: string;
  runs: number;
  elapsedMs: number;
  promptTokens: number;
  completionTokens: number;
  toolCalls: number;
  lastRunAt: string | null;
}

export interface CostTotals {
  runs: number;
  elapsedMs: number;
  promptTokens: number;
  completionTokens: number;
  toolCalls: number;
}

export interface CostData {
  perStage: CostStageStat[];
  totals: CostTotals;
  pricePerMillion: { input: number; output: number };
  hasTokenData: boolean;
  note: string;
}

/** 拉取执行成本统计（GET /api/cost）；失败返回 null（网关未开/路由未就绪时降级）。 */
export async function fetchCost(): Promise<CostData | null> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/api/cost`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as CostData;
  } catch {
    return null;
  }
}

// =============================================================================
// 阶段执行轨迹 API（网关 /api/trajectory + /api/trajectory-gate）
// 数据源：@yxspec/aspice-trajectory 插件落盘的 runtime-data/trajectory JSONL。
// 只读展示（Phase 1 不接门控写回）；失败一律静默降级 null，不阻塞驾驶舱。
// =============================================================================

/** 轨迹单条工具调用（瀑布行之一）。 */
export interface TrajectoryTool {
  type: 'tool/call' | 'tool/result';
  name: string | null;
  ok?: boolean;
  error?: string | null;
  ts?: number;
}

/** 单条阶段执行记录（JSONL 行，schema 与网关 trajectory.mjs 对齐）。 */
export interface TrajectoryRecord {
  stage: string;
  seq: number;
  sessionId: string;
  /** passed | failed | unverified | blocked */
  status: string;
  startedAt: number;
  finishedAt: number | null;
  turnCount?: number;
  stepCount?: number;
  events?: string[];
  tools?: TrajectoryTool[];
  cost?: { tokens: number; inputTokens: number; outputTokens: number };
  reason?: string | null;
  /** Phase 3：回滚协议 —— 该条被标记 rolled_back 时由网关合并进记录 */
  rollbackId?: string | null;
  rolled_back?: boolean;
  rollbackAt?: number;
  rollbackReason?: string | null;
}

/** 轨迹证据三态（门控判定用）。 */
export interface TrajectoryGateStatus {
  /** verified | unverified | blocked */
  status: string;
  hasTurnEnd: boolean;
  toolOk: boolean;
  toolCalls: number;
  toolResults: number;
  tokens: number;
  reason: string | null;
}

/** GET /api/trajectory?stage= 响应（轨迹面板视图）。 */
export interface TrajectoryView {
  stage: string;
  label: string;
  aspice: string;
  command: string;
  gate_policy: string;
  exists: boolean;
  artifacts: { path: string; kind: string }[];
  totalRuns: number;
  latest: TrajectoryRecord | null;
  status: TrajectoryGateStatus | null;
  rows: TrajectoryRecord[];
}

/** GET /api/trajectory-gate?stage= 响应（门控判定结果）。 */
export interface TrajectoryGate {
  stage: string;
  gate_policy: string;
  artifact: { passed: boolean; files: string[] } | null;
  trajectory: TrajectoryGateStatus | null;
  /** verified | unverified | blocked */
  status: string;
  passed: boolean;
  reason: string;
}

/** 拉取某阶段轨迹视图；失败返回 null（网关未起/无轨迹）。 */
export async function fetchTrajectory(stage: string, limit = 50): Promise<TrajectoryView | null> {
  try {
    const res = await fetch(
      `${GATEWAY_BASE}/api/trajectory?stage=${encodeURIComponent(stage)}&limit=${limit}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    return (await res.json()) as TrajectoryView;
  } catch {
    return null;
  }
}

/** 拉取某阶段门控判定；失败返回 null。 */
export async function fetchTrajectoryGate(stage: string): Promise<TrajectoryGate | null> {
  try {
    const res = await fetch(
      `${GATEWAY_BASE}/api/trajectory-gate?stage=${encodeURIComponent(stage)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    return (await res.json()) as TrajectoryGate;
  } catch {
    return null;
  }
}

// =============================================================================
// 阶段轨迹回滚 + OTel 导出 API（Phase 3：回滚协议 + 导出）
// 回滚 = 网关侧把该阶段最新轨迹标记 rolled_back（JSONL 尾部追加审计行），
//       并返回回滚指令（含 git 提示，对齐 guard.sh 块起始语义）——网关不执行 git。
// 导出 = GET /api/trajectory/:stage/export → OTel GenAI spans（Langfuse/LangSmith 可消费）。
// =============================================================================

/** POST /api/trajectory/:stage/rollback 响应（回滚指令）。 */
export interface TrajectoryRollbackResult {
  ok: boolean;
  /** 幂等命中（同一 rollbackId 已标记过）时 true */
  already?: boolean;
  rollbackId?: string;
  seq?: number;
  targetStatus?: string;
  /** 该阶段执行前的 HEAD commit（可 git reset --hard 到此处）；null = 无记录 */
  rollbackCommit?: string | null;
  instructions: string[];
  command?: string | null;
  error?: string;
}

/**
 * 标记该阶段最新轨迹回滚（确认后调用）。网关只发指令留档，不执行 git。
 * 成功 → 返回回滚指令；失败抛错（未知阶段/无轨迹/写盘失败）。
 */
export async function markTrajectoryRollback(
  stage: string,
  reason?: string,
): Promise<TrajectoryRollbackResult> {
  const res = await fetch(`${GATEWAY_BASE}/api/trajectory/${encodeURIComponent(stage)}/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  const data = (await res.json().catch(() => null)) as TrajectoryRollbackResult | null;
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data || { ok: false, instructions: [] };
}

/** GET /api/trajectory/:stage/export 响应（OTel GenAI spans）。 */
export interface OtelExportResponse {
  resource: Record<string, string>;
  trace_id: string;
  stage: string;
  span_count: number;
  spans: OtelSpan[];
}

/** 单条 OTel span（gen_ai 语义约定，Langfuse/LangSmith 可消费）。 */
export interface OtelSpan {
  name: string;
  kind: 'client';
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  start_time_unix_nano: number;
  end_time_unix_nano: number;
  attributes: Record<string, unknown>;
  model: string | null;
}

/**
 * 导出该阶段 OTel GenAI spans（下载 JSON）。
 * 无轨迹 → 返回 null（前端禁用按钮）；网络错误抛错。
 */
export async function fetchTrajectoryOtelExport(stage: string): Promise<OtelExportResponse | null> {
  const res = await fetch(
    `${GATEWAY_BASE}/api/trajectory/${encodeURIComponent(stage)}/export`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  return (await res.json()) as OtelExportResponse;
}

/** 触发浏览器下载 JSON 文件（OTel 导出 + 回滚指令共用）。 */
export function downloadJson(filename: string, obj: unknown): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// =============================================================================
// 社区插件市场 API（网关 /api/community-plugins）
// 只读浏览/筛选：数据源为 GitHub search（topic:dsh-plugin），网关缓存 6h；
// GitHub 挂/限流时降级旧缓存(stale)或内置静态精选(static)。
// 本期不做安装，不挂进 runtime。
// =============================================================================

/** 单个社区插件条目（网关精简映射后的字段）。 */
export interface CommunityPlugin {
  fullName: string;
  name: string;
  owner: string;
  description: string;
  stars: number;
  pushedAt: string | null;
  url: string;
}

export interface CommunityPluginsResponse {
  ok: boolean;
  /** github=刚拉的实时数据；cache=命中 6h 缓存；static=内置精选兜底 */
  source: 'github' | 'cache' | 'static';
  /** 命中旧缓存但刷新 GitHub 失败（数据可能过期） */
  stale: boolean;
  fetchedAt: string | null;
  count: number;
  plugins: CommunityPlugin[];
}

/** 拉取社区插件列表；失败返回 null（前端静默降级，不 toast）。 */
export async function fetchCommunityPlugins(): Promise<CommunityPluginsResponse | null> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/api/community-plugins`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as CommunityPluginsResponse;
  } catch {
    return null;
  }
}

// =============================================================================
// 已安装插件 API（网关 /api/installed-plugins）
// 真相源 = runtime 装配表 cordis.yml 解析；返回已接入 runtime 的非内置插件
// （graph-memory / weknora 等），带版本号。功能开关 tab 顶部展示。
// =============================================================================

/** 单个已安装插件条目。 */
export interface InstalledPlugin {
  id: string;
  /** cordis.yml 里的插件名（@scope/pkg 或 pkg/entry）。 */
  name: string;
  /** npm 包名（name 归一化后用于查 node_modules）。 */
  package: string | null;
  /** node_modules/<pkg>/package.json 的 version（未装/读不到 → null）。 */
  version: string | null;
  source: string;
  /** 分类：base=DSH 基座必需 / ours=我们接入/新增（前端高亮）。 */
  tier?: 'base' | 'ours';
}

export interface InstalledPluginsResponse {
  ok: boolean;
  count: number;
  plugins: InstalledPlugin[];
}

/** 拉取已安装插件清单；失败返回 null（静默降级）。 */
export async function fetchInstalledPlugins(): Promise<InstalledPluginsResponse | null> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/api/installed-plugins`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as InstalledPluginsResponse;
  } catch {
    return null;
  }
}

// =============================================================================
// 已验证待接入能力（GET /api/capability-candidates）
// subagent / session-query / ralph / schedule / feedback / commands / invariants
// 已 POC 验证但尚未进主 cordis.yml；插件中心据此展示候选，避免"做了但看不出来"。
// =============================================================================

/** 单个已验证待接入能力条目。 */
export interface CapabilityCandidate {
  id: string;
  name: string;
  desc: string;
  packages: string[];
  verified: boolean;
  verifiedAt: string;
  evidence: string;
  port: number;
  /** 接入时是否需 @yxspec/tool-guard 白名单放行。 */
  guard: boolean;
  /** 是否已真正接进主 cordis.yml（false=候选待接入）。 */
  wired: boolean;
}

export interface CapabilityCandidatesResponse {
  ok: boolean;
  count: number;
  candidates: CapabilityCandidate[];
}

/** 拉取已验证待接入能力清单；失败返回 null（静默降级）。 */
export async function fetchCapabilityCandidates(): Promise<CapabilityCandidatesResponse | null> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/api/capability-candidates`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as CapabilityCandidatesResponse;
  } catch {
    return null;
  }
}

// =============================================================================
// 插件统一模型（Everything-is-a-Plugin 开关层）
// 后端 /api/plugins：已装配插件（plugin）+ 候选能力（candidate）+ 基座（base）
// 统一成可开关的插件条目。开关生效 = 开关即重建（写装配 → 重建 runtime）。
// =============================================================================

export interface UnifiedPlugin {
  id: string;
  name: string;
  desc: string;
  /** plugin=已装配 / candidate=候选能力 / base=基座 */
  kind: 'plugin' | 'candidate' | 'base';
  tier: 'plugin' | 'candidate' | 'base';
  enabled: boolean;
  /** base 不可关（只读）；agent-spine 也锁 */
  switchable: boolean;
}

export interface PluginsResponse {
  ok: boolean;
  count: number;
  plugins: UnifiedPlugin[];
}

/** 拉取统一插件列表。 */
export async function fetchPlugins(): Promise<PluginsResponse | null> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/api/plugins`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as PluginsResponse;
  } catch {
    return null;
  }
}

/**
 * 开关插件（开关即重建）。后端会 closeHarness() 重建 runtime（~2-5s）。
 * 有 active turn 时后端返回 409；base 返回 400。
 */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<any> {
  return modelsFetch(`${GATEWAY_BASE}/api/plugins/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

// =============================================================================
// 浏览器模式下的解析器（与 Rust 解析器等价）
// =============================================================================

function parseProgressMeta(content: string): ProjectInfo['meta'] {
  const meta: ProjectInfo['meta'] = {
    spec_id: '',
    product: '',
    git_branch: '',
    team_remote: '',
    personal_remote: '',
    baseline_branch: '',
    target_schedule: '',
  };
  let inMeta = false;
  for (const line of content.split('\n')) {
    if (line.startsWith('## 项目元信息')) {
      inMeta = true;
      continue;
    }
    if (inMeta && line.startsWith('## ')) break;
    if (!inMeta) continue;
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const parts = trimmed
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length < 2) continue;
    const key = parts[0];
    const value = parts[1];
    if (key === 'spec_id') meta.spec_id = value;
    else if (key === '产品') meta.product = value;
    else if (key === 'git 分支') meta.git_branch = value;
    else if (key === '团队仓远端') meta.team_remote = value;
    else if (key === '个人备份远端') meta.personal_remote = value;
    else if (key === '基线分支') meta.baseline_branch = value;
    else if (key === '工期目标') meta.target_schedule = value;
  }
  return meta;
}

function parseReviewFromTask(content: string): ReviewEntry['review'] {
  let verdict: 'approved' | 'conditional' | 'rejected' | null = null;
  let signoff = false;
  let techLead = '';
  let qualityLead = '';
  let date = '';
  let file = '';

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|')) {
      const cells = trimmed
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (cells.length < 2) continue;
      const key = cells[0];
      const value = cells[1];
      if (key === 'verdict') {
        if (value === 'approved') verdict = 'approved';
        else if (value === 'conditional') verdict = 'conditional';
        else if (value === 'rejected') verdict = 'rejected';
      } else if (key === 'signoff') {
        signoff = value.includes('已签') || value === 'true';
      } else if (key === 'review_report') {
        file = value;
      } else if (key === 'plan_start' || key === 'finished_at') {
        if (!date) date = value;
      }
    }
  }

  if (!verdict) return null;
  return { verdict, tech_lead: techLead, quality_lead: qualityLead, signoff, date, file };
}

function computeFromProgress(content: string): StageStatus[] {
  const result: StageStatus[] = [];
  const sections: Record<string, StageStatus['status']> = {};
  for (const line of content.split('\n')) {
    const match = line.match(/\|\s*([\w.\/]+)\s*\|\s*(\/yxspec:[\w-]+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/);
    if (match) {
      const [, aspice, , state, review] = match;
      const stageName = aspice.toLowerCase().replace(/[^a-z]/g, '');
      // 简化推断：根据 state 文本
      let status: StageStatus['status'] = 'pending';
      if (state.includes('完成') && review.includes('approved')) status = 'completed';
      else if (state.includes('完成') && review.includes('conditional')) status = 'completed';
      else if (state.includes('进行') || state.includes('run')) status = 'in_progress';
      else if (state.includes('待审查')) status = 'pending_review';
      else if (state.includes('rejected')) status = 'rejected';
      else if (state.includes('env_blocked') || state.includes('阻塞')) status = 'blocked';
      sections[stageName] = status;
    }
  }
  for (const token of Object.keys(STAGE_TABLE) as StageToken[]) {
    const mapping = STAGE_TABLE[token];
    result.push({
      token,
      status: sections[mapping.aspice.toLowerCase().replace(/[^a-z]/g, '').replace('sys5', 'sys.5')] || 'pending',
      artifacts: [],
      review: null,
      last_update: '',
      message: '从 PROGRESS.md 推断（浏览器模式）',
    });
  }
  return result;
}