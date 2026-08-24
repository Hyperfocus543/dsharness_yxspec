// =============================================================================
// 解析器模块：把 yxspec 文件解析成结构化数据
// - progress.rs: PROGRESS.md 解析（项目元信息 + 阶段进度表）
// - task.rs: task_*.md 解析（适配真实 Markdown 表格格式）
// - review.rs: review-*.md 解析（verdict / signoff / tech_lead / quality_lead）
// - pipeline.rs: pipeline_state.json 解析
// =============================================================================

pub mod progress;
pub mod task;
pub mod review;
pub mod pipeline;
