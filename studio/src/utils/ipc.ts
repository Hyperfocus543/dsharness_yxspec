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
  ReviewEntry,
  StageMapping,
  StageStatus,
  StageToken,
  Task,
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
export const GATEWAY_BASE: string =
  (import.meta as any)?.env?.VITE_EXEC_GATEWAY || 'http://127.0.0.1:8787';

/** 网关事件回调载荷（与后端 SSE 消息 {type, data} 对齐）*/
export type GatewayEvent = { type: string; data: any };

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

async function browserListTasks(_projectPath: string, taskFile: string): Promise<Task[]> {
  // 裸文件名（如 task_sqt_case_design.md）→ 补 project/tasks/ 前缀（task 文件都在该目录）
  const file = taskFile.includes('/') ? taskFile : `project/tasks/${taskFile}`;
  const raw = await fetchText(file);
  return parseTaskTable(raw);
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

export async function listTasks(projectPath: string, taskFile: string): Promise<Task[]> {
  if (isTauri) {
    const invoke = await getTauriInvoke();
    if (invoke) return invoke<Task[]>('list_tasks', { projectPath, taskFile });
  }
  return browserListTasks(projectPath, taskFile);
}

export async function updateTask(
  projectPath: string,
  taskFile: string,
  taskId: string,
  newStatus: string,
  timestamp: string,
): Promise<string> {
  if (isTauri) {
    const invoke = await getTauriInvoke();
    if (invoke) {
      return invoke<string>('update_task', {
        projectPath,
        taskFile,
        taskId,
        newStatus,
        timestamp,
      });
    }
  }
  // 浏览器模式：POST /yxspec/task-status，由 Vite 中间件代理写回 task_*.md
  // （路径白名单仅 project/tasks/*.md，防穿越/越权）
  const res = await fetch('/yxspec/task-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskFile, taskId, newStatus, timestamp }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `写回失败 HTTP ${res.status}`);
  }
  return data?.ok ? 'OK' : data?.message || 'OK';
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
 * 派活给真实模型（走网关 /api/agent，可选复用常驻 harness session）。
 * 返回后端 JSON：{final_response, finish_reason, session_id, error}
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
    throw new Error(data?.detail || `HTTP ${res.status}`);
  }
  return data;
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

function parseTaskTable(content: string): Task[] {
  const tasks: Task[] = [];
  let inTaskSection = false;
  let headers: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## 任务表') || trimmed.startsWith('## 任务列表')) {
      inTaskSection = true;
      continue;
    }
    if (inTaskSection && trimmed.startsWith('## ') && !trimmed.includes('任务')) {
      break;
    }
    if (!inTaskSection || !trimmed.startsWith('|')) continue;

    const cells = trimmed
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (cells.every((c) => c.split('').every((ch) => ch === '-' || ch === ' '))) continue;

    if (headers.length === 0) {
      headers = cells.map((c) => normalizeHeader(c));
      continue;
    }

    if (cells.length < headers.length) continue;

    const task: Task = {
      id: '',
      name: '',
      type: '',
      module: '',
      action: '',
      verify: '',
      status: 'pending',
      done: false,
      started_at: null,
      finished_at: null,
      duration: null,
    };

    for (let i = 0; i < headers.length; i++) {
      const val = cells[i];
      const valOpt = val === '—' || val === '-' || val === '' ? null : val;
      switch (headers[i]) {
        case 'id':
          task.id = valOpt || '';
          break;
        case 'name':
          task.name = valOpt || '';
          break;
        case 'type':
          task.type = valOpt || '';
          break;
        case 'module':
          task.module = valOpt || '';
          break;
        case 'action':
          task.action = valOpt || '';
          break;
        case 'verify':
          task.verify = valOpt || '';
          break;
        case 'done':
          task.done = valOpt === 'true';
          break;
        case 'started_at':
          task.started_at = valOpt;
          break;
        case 'finished_at':
          task.finished_at = valOpt;
          break;
        case 'duration':
          task.duration = valOpt;
          break;
        case 'status':
          task.status = parseTaskStatus(val);
          break;
      }
    }

    if (!headers.includes('status')) {
      task.status = inferStatus(task);
    }

    tasks.push(task);
  }
  return tasks;
}

function normalizeHeader(s: string): string {
  const trimmed = s.trim();
  if (trimmed === 'ID' || trimmed === 'id') return 'id';
  if (trimmed === '名称') return 'name';
  if (trimmed === '类型') return 'type';
  if (trimmed === '模块') return 'module';
  if (trimmed === '动作') return 'action';
  if (trimmed === '验证') return 'verify';
  if (trimmed === '完成') return 'done';
  if (trimmed === 'started_at' || trimmed === '开始时间') return 'started_at';
  if (trimmed === 'finished_at' || trimmed === '结束时间') return 'finished_at';
  if (trimmed === 'duration' || trimmed === '时长') return 'duration';
  if (trimmed === '状态' || trimmed === 'status') return 'status';
  return trimmed;
}

function parseTaskStatus(s: string): Task['status'] {
  switch (s) {
    case 'pending':
      return 'pending';
    case 'ready':
      return 'ready';
    case 'in_progress':
      return 'in_progress';
    case 'blocked':
      return 'blocked';
    case 'done':
      return 'done';
    case 'skipped':
      return 'skipped';
    case 'stale':
      return 'stale';
    default:
      return 'pending';
  }
}

function inferStatus(task: Task): Task['status'] {
  if (task.done) return 'done';
  if (task.started_at && !task.finished_at) return 'in_progress';
  if (!task.started_at && !task.finished_at) return 'pending';
  return 'ready';
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