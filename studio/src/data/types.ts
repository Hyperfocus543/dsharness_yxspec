// =============================================================================
// YXSpec Studio - 类型定义
// 来源：yxspec-studio-build-spec-v1.md §附录 B + 实际 trainees-2026 项目数据格式
// 适配说明：实际 pipeline_state.json 中每个模块直接是单一 status 字段（非 plan/do/verify
// 三段式），实际 task_*.md 是 Markdown 表格（非 YAML Front Matter），
// 这里以 build-spec 设计为主、保留对实际格式的适配钩子。
// =============================================================================

// 25 个 stage_token（来自 .claude/commands/yxspec/next.md 第 29~60 行权威映射表）
export type StageToken =
  // V+ 工作流 25 阶段（按 ASPICE 流程编号）
  | 'init'
  | 'sys_elicitation'
  | 'sys_analysis'
  | 'sys_arch'
  | 'hwe_analysis'
  | 'swe_analysis'
  | 'swe_arch'
  | 'swe_arch_if'
  | 'swe_detail'
  | 'swe_coding_plan'
  | 'swe_coding_do'
  | 'swe_static_verify'
  | 'swe_coding_verify'
  | 'swe_coding_verify_pc'
  | 'swe_unit_verify'
  | 'swe_integration_verify'
  | 'sqt_strategy'
  | 'sqt_tr'
  | 'sqt_case_design'
  | 'sqt_script_gen'
  | 'sqt_auto_test'
  | 'sqt_defect_feedback'
  | 'comp'
  | 'traceability'
  | 'swe_sdk_release'
  | 'swe_release'
  | 'swe_release_promote';

// 阶段状态机（来自 build-spec §5.1）
export type StageStatusType =
  | 'completed' // 产物齐备 + 审查通过
  | 'in_progress' // 部分模块/任务完成
  | 'pending' // 未开始
  | 'pending_review' // 产物已生成，待审查
  | 'stale' // 需重做
  | 'rejected' // 审查未通过
  | 'blocked'; // 阻塞

// 审查裁决（来自 build-spec §3.2.4）
export type ReviewVerdict = 'approved' | 'conditional' | 'rejected';

// =============================================================================
// 阶段映射（来自 next.md 第 29~60 行权威映射表，人读权威；机读镜像在
// yxspec/.claude/scripts/next_decision.py，YXSpec Studio 优先读机读）
// =============================================================================
export interface StageMapping {
  token: StageToken;
  /** 完整命令，如 /yxspec:prd-analysis（注意与 token 不同形！）*/
  command: string;
  /** 命令名（连字符，slash 命令后部分）*/
  command_name: string;
  /** ASPICE 阶段编号，如 SYS.5 / SWE.4 */
  aspice: string;
  /** 产物 glob（相对项目根）*/
  spec_globs: string[];
  /** 任务文件（含别名）；null 表示无任务文件 */
  task_file: string | null;
  /** 是否有审查门控 */
  review_gate: 'yes' | 'no';
  /** 门控策略（3.2 节）：artifact=产物存在即过（默认兼容旧行为）；
   *  artifact+trajectory=产物存在 AND 轨迹证据完整才放行（review_gate:'yes' 的阶段默认此项） */
  gate_policy?: 'artifact' | 'artifact+trajectory';
  /** 上游依赖 */
  upstream: StageToken[];
  /** 下游（仅取第一个作为"建议下一步"）*/
  downstream: StageToken[];
  /** 阶段分组（驾驶舱布局用）*/
  group: 'ACQ' | 'SYS' | 'HWE' | 'SWE' | 'SQT' | 'COMP' | 'REL';
  /** 序号（来自权威映射表第一列）*/
  order: number;
}

// 阶段状态计算结果
export interface StageStatus {
  token: StageToken;
  status: StageStatusType;
  /** 该阶段产物文件相对路径列表 */
  artifacts: string[];
  /** 最近审查摘要（如果有）*/
  review: ReviewSummary | null;
  /** 计算时间戳 */
  last_update: string;
  /** 状态说明（人类可读）*/
  message: string;
  /** 产物数量（衍生统计）*/
  artifacts_count?: number;
  /** 门控提示（来自 .dsh/dsh_state.json 的 gate.message，驾驶舱节点上直接展示）*/
  gate_message?: string;
  /**
   * 门控三态（stageStore 从 gate.upstream 布尔值算出来，供驾驶舱决定提示风格）：
   *   'blocked'  → 上游有未完成（真阻塞，红色警告）
   *   'pending'  → 上游齐备但产物缺失（待补产物，琥珀提示）
   *   'ok'       → 上游齐备且产物命中（正向提示，"可进入 review"）
   *   undefined  → 无门控（不显示提示条）
   */
  gate_state?: 'blocked' | 'pending' | 'ok';
  /** 轨迹门控三态（来自 GET /api/trajectory-gate 的 status 字段，Phase 1 只读展示）：
   *   verified  → 轨迹证据完整（绿色徽标）
   *   unverified → 轨迹存在但缺关键证据（黄色徽标）
   *   blocked  → 轨迹失败/打回（红色徽标） */
  gate_trajectory?: 'verified' | 'unverified' | 'blocked';
  /** 派活被门控打回的原因（Phase 2：读取 /api/agent 拦截响应的 reason 字段）：
   *   trajectory-blocked / no-trajectory / artifact-passed-no-trajectory /
   *   trajectory-unverified（警告） / upstream-blocked / artifact-missing */
  gate_reason?: string;
}

// 审查摘要
export interface ReviewSummary {
  verdict: ReviewVerdict;
  tech_lead: string;
  quality_lead: string;
  signoff: boolean;
  date: string;
  /** review-{stage_token}-{spec_id}.md 路径 */
  file: string;
}

// 审查条目（ReviewCenter 用）：一个阶段的审查报告 + 签字文件
export interface ReviewEntry {
  stage: string;
  review: ReviewSummary | null;
  /** 签字文件相对路径（如有）*/
  signoff_file: string | null;
}

// =============================================================================
// Pipeline 模型（适配真实 pipeline_state.json 格式：每模块直接是单一 status）
// =============================================================================
export interface PipelineState {
  project_id: string;
  last_update: string;
  modules: Record<string, ModuleState>;
}

export interface ModuleState {
  /** 直接是模块最终状态（plan→coding→done→verified 的当前值）*/
  status:
    | 'planned'
    | 'coding'
    | 'partial_done'
    | 'done'
    | 'failed'
    | 'verified'
    | 'verify_stuck'
    | 'blocked'
    | 'review_failed'
    | 'review_cleared';
  last_success_sha?: string;
  last_success_submodule_sha?: string;
  last_success_at?: string;
  last_success_files?: string[];
  evidence?: {
    plan_file?: string;
    result_file?: string;
    checkpoint_file?: string;
    worktree_clean?: boolean;
    worktree?: string;
  };
  verified_at?: string;
  warnings?: string[];
  fix_history?: unknown[];
}

// =============================================================================
// 项目根（PROGRESS.md 顶部表格）
// =============================================================================
export interface ProjectMeta {
  spec_id: string;
  product: string;
  git_branch: string;
  team_remote: string;
  personal_remote: string;
  baseline_branch: string;
  target_schedule: string;
}

export interface ProjectInfo {
  path: string;
  meta: ProjectMeta;
  /** PROGRESS.md 全文 */
  progress_raw: string;
}

// =============================================================================
// UI 状态（4 个 store）
// =============================================================================
export interface ToastMessage {
  id: string;
  level: 'info' | 'success' | 'warn' | 'error';
  text: string;
}

// =============================================================================
// dsh_state.json（SQT 最小演示 · 契约见 .dsh/CONTRACT.md）
// 与 Track B（对话闭环）共用的状态真相文件，字段名必须一字不差。
// =============================================================================
/** yxspec 7 状态（契约 §1 状态机）*/
export type DshStageState =
  | 'pending'
  | 'ready'
  | 'in_progress'
  | 'done'
  | 'blocked'
  | 'stale'
  | 'skipped';

/** 审查状态（契约 §1 review 字段）*/
export type DshReviewState = 'pending' | 'approved' | 'conditional' | 'rejected' | null;

/** 单条产物（契约 artifacts[] 元素：{path, kind, size, mtime}）*/
export interface DshArtifact {
  path: string;
  kind: string;
  size: number;
  mtime: string;
}

/** 门控扫描结果（契约 gate 字段）*/
export interface DshGate {
  upstream: Record<string, boolean>;
  spec_glob: string;
  spec_hit: boolean;
  message: string;
}

/** 单个 SQT 子阶段（契约 stages 值）*/
export interface DshStageEntry {
  token: string;
  command: string;
  aspice: string;
  state: DshStageState;
  review: DshReviewState;
  artifacts: DshArtifact[];
  gate: DshGate;
  owner: string | null;
  lastUpdate: string | null;
}

/** dsh_state.json 根对象（契约 §1 完整 schema）*/
export interface DshState {
  $schema: string;
  project: string;
  version: number;
  updatedAt: string;
  stages: Record<string, DshStageEntry>;
  current: string;
  productAdapters: Record<string, boolean>;
  /** 后端 /api/session 快照可能带当前 goal（可选字段，刷新恢复时驱动阶段轨道点亮）*/
  goal?: any;
  /** 后端 /api/session 快照可能带 todos 列表（可选字段，导入实时看板）*/
  todos?: any[];
}

// =============================================================================
// 断点续跑（网关 GET /api/resume）
// 网关重启/电脑休眠后，前端据此恢复断点：提示「已恢复到 X 阶段（剩 N 个待完成）」
// 并提供「一键续跑」按钮（复用现有派活机制）。
// =============================================================================

/** /api/resume 建议继续执行的命令信息 */
export interface ResumeSuggestedNext {
  token: string;
  command: string;
  command_name: string;
  aspice: string;
  label?: string;
}

/** GET /api/resume 响应（断点恢复信息）*/
export interface ResumeInfo {
  projectPath: string;
  /** 断点阶段 token；无 current 且全部完成时为 null */
  current: string | null;
  /** 在 STAGE_ORDER 里的下标；无断点时 -1 */
  currentIndex: number;
  /** 未完成（非 done/skipped）的活跃阶段数 */
  pendingCount: number;
  /** gate_state === blocked 的 token 列表 */
  blockedStages: string[];
  /** current 阶段的命令信息；无断点时 null */
  suggestedNext: ResumeSuggestedNext | null;
  /** false = 全部完成（或状态文件异常），前端不渲染恢复提示条 */
  resumable: boolean;
}

// =============================================================================
// 功能商店（Feature Store）类型 — 与网关 GET /api/features 契约对齐
// =============================================================================

/** 网关返回的单个功能条目（features.mjs listFeatures）*/
export interface FeatureItem {
  id: string;
  name: string;
  desc: string;
  /** 适用阶段 token 数组；'all'=全部，'review'=所有 review_gate 阶段 */
  appliesTo: string[];
  /** low | medium | high */
  cost: string;
  /** 依赖说明（重开关灰置时的提示）*/
  depends: string[];
  /** 是否可开关（false=灰置，依赖 harness 链路未确认）*/
  available: boolean;
  /** 始终启用（如审计账本，无开关）*/
  always: boolean;
  enabled: boolean;
  /** 规则文件是否加载到（可选）*/
  loaded: { path: string } | null;
  /** 纯 UI 功能（如周报）：不进 agent prompt，只控制前端功能卡显隐 */
  uiOnly?: boolean;
}

/** GET /api/features 响应 */
export interface FeaturesResponse {
  ok: boolean;
  features: FeatureItem[];
}
