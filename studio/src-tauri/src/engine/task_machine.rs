// 任务状态机（build-spec §6）
// 合法状态转换：来自 build-spec §6.1 VALID_TRANSITIONS

use super::super::models::TaskStatusType;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransitionResult {
    pub ok: bool,
    pub reason: String,
}

pub fn validate_transition(from: &TaskStatusType, to: &TaskStatusType) -> TransitionResult {
    let valid = match from {
        TaskStatusType::Pending => vec![
            TaskStatusType::Ready,
            TaskStatusType::InProgress,
            TaskStatusType::Skipped,
        ],
        TaskStatusType::Ready => vec![
            TaskStatusType::InProgress,
            TaskStatusType::Pending,
            TaskStatusType::Skipped,
        ],
        TaskStatusType::InProgress => vec![
            TaskStatusType::Done,
            TaskStatusType::Blocked,
            TaskStatusType::Pending,
        ],
        TaskStatusType::Blocked => vec![
            TaskStatusType::InProgress,
            TaskStatusType::Pending,
            TaskStatusType::Skipped,
        ],
        TaskStatusType::Done => vec![TaskStatusType::Stale],
        TaskStatusType::Skipped => vec![TaskStatusType::Pending],
        TaskStatusType::Stale => vec![TaskStatusType::Pending, TaskStatusType::InProgress],
    };

    if valid.contains(to) {
        TransitionResult {
            ok: true,
            reason: format!("合法转换: {:?} -> {:?}", from, to),
        }
    } else {
        TransitionResult {
            ok: false,
            reason: format!("非法转换: {:?} -> {:?}（合法目标: {:?}）", from, to, valid),
        }
    }
}
