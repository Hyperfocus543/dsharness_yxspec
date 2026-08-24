// =============================================================================
// 业务引擎模块
// - stage_status.rs: 阶段状态计算（build-spec §5）
// - task_machine.rs: 任务状态机（build-spec §6）
// - gate_check.rs:   门控检查（build-spec §7）
// - handoff.rs:      接力快照（Phase 2，本 MVP 不实现）
// =============================================================================

pub mod stage_status;
pub mod task_machine;
pub mod gate_check;
