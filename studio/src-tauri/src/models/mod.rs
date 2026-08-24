// =============================================================================
// YXSpec Studio - Rust 数据模型
// 与前端 src/data/types.ts 镜像；前后端通过 serde_json 序列化对齐
// =============================================================================

use serde::{Deserialize, Serialize};

/// 25 个 stage_token（来自 .claude/commands/yxspec/next.md 权威映射表）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum StageToken {
    Init,
    SysElicitation,
    SysAnalysis,
    SysArch,
    HweAnalysis,
    SweAnalysis,
    SweArch,
    SweArchIf,
    SweDetail,
    SweCodingPlan,
    SweCodingDo,
    SweStaticVerify,
    SweCodingVerify,
    SweCodingVerifyPc,
    SweUnitVerify,
    SweIntegrationVerify,
    SgtStrategy,
    SgtTr,
    SgtCaseDesign,
    SgtScriptGen,
    SgtAutoTest,
    SgtDefectFeedback,
    Comp,
    Traceability,
    SweSdkRelease,
    SweRelease,
    SweReleasePromote,
}

/// 阶段状态机（7 状态）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StageStatusType {
    Completed,
    InProgress,
    Pending,
    PendingReview,
    Stale,
    Rejected,
    Blocked,
}

/// 任务状态机（7 状态）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatusType {
    Pending,
    Ready,
    InProgress,
    Blocked,
    Done,
    Skipped,
    Stale,
}

/// 审查裁决
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewVerdict {
    Approved,
    Conditional,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageMapping {
    pub token: String,
    pub command: String,
    pub command_name: String,
    pub aspice: String,
    pub spec_globs: Vec<String>,
    pub task_file: Option<String>,
    pub review_gate: String, // "yes" / "no"
    pub upstream: Vec<String>,
    pub downstream: Vec<String>,
    pub group: String,
    pub order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewSummary {
    pub verdict: ReviewVerdict,
    pub tech_lead: String,
    pub quality_lead: String,
    pub signoff: bool,
    pub date: String,
    pub file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageStatus {
    pub token: String,
    pub status: StageStatusType,
    pub artifacts: Vec<String>,
    pub review: Option<ReviewSummary>,
    pub last_update: String,
    pub message: String,
    pub artifacts_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub name: String,
    pub task_type: String,
    pub module: String,
    pub action: String,
    pub verify: String,
    pub status: TaskStatusType,
    pub done: bool,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub spec_id: String,
    pub product: String,
    pub git_branch: String,
    pub team_remote: String,
    pub personal_remote: String,
    pub baseline_branch: String,
    pub target_schedule: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub path: String,
    pub meta: ProjectMeta,
    pub progress_raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleState {
    pub status: String,
    pub last_success_sha: Option<String>,
    pub last_success_at: Option<String>,
    pub verified_at: Option<String>,
    pub evidence: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineState {
    pub project_id: String,
    pub last_update: String,
    pub modules: std::collections::HashMap<String, ModuleState>,
}
