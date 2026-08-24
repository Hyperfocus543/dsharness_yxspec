// stage 命令：计算 25 阶段状态 + 建议下一步 + 门控

use crate::engine::{gate_check, stage_status};
use crate::models::stage_table::{stage_token_to_str, STAGE_TABLE};
use crate::models::StageStatus;
use crate::models::StageToken;
use std::path::PathBuf;

#[tauri::command]
pub async fn compute_all_status(project_path: String) -> Result<Vec<StageStatus>, String> {
    let path = PathBuf::from(&project_path);
    if !path.exists() {
        return Err(format!("项目路径不存在: {}", project_path));
    }
    let mut result = Vec::new();
    for entry in STAGE_TABLE {
        let status = stage_status::compute_stage_status(&path, &entry.token);
        result.push(status);
    }
    Ok(result)
}

#[tauri::command]
pub async fn compute_stage_status(
    project_path: String,
    stage: String,
) -> Result<StageStatus, String> {
    let path = PathBuf::from(&project_path);
    let token = STAGE_TABLE
        .iter()
        .find(|e| stage_token_to_str(&e.token) == stage)
        .map(|e| e.token.clone())
        .ok_or_else(|| format!("未知 stage: {}", stage))?;
    Ok(stage_status::compute_stage_status(&path, &token))
}

#[tauri::command]
pub async fn suggest_next_command(stage: String) -> Result<Option<String>, String> {
    let entry = STAGE_TABLE
        .iter()
        .find(|e| stage_token_to_str(&e.token) == stage)
        .ok_or_else(|| format!("未知 stage: {}", stage))?;

    // 受限链式调用：能推荐下个命令，但 UI 上不自动执行
    if !entry.downstream.is_empty() {
        let next = &entry.downstream[0];
        let cmd = STAGE_TABLE
            .iter()
            .find(|e| e.token == *next)
            .map(|e| e.command.to_string())
            .unwrap_or_default();
        return Ok(Some(cmd));
    }

    // 边界：检查是否需要 review
    if entry.review_gate == "yes" {
        return Ok(Some(format!("/yxspec:review {}", stage)));
    }

    Ok(None)
}

#[tauri::command]
pub async fn gate_check_cmd(
    project_path: String,
    stage: String,
) -> Result<gate_check::GateResult, String> {
    let path = PathBuf::from(&project_path);
    Ok(gate_check::gate_check(&path, &stage))
}

#[tauri::command]
pub async fn list_stages() -> Result<Vec<serde_json::Value>, String> {
    Ok(STAGE_TABLE
        .iter()
        .map(|e| {
            serde_json::json!({
                "token": stage_token_to_str(&e.token),
                "command": e.command,
                "command_name": e.command_name,
                "aspice": e.aspice,
                "spec_globs": e.spec_globs,
                "task_file": e.task_file,
                "review_gate": e.review_gate,
                "upstream": e.upstream.iter().map(stage_token_to_str).collect::<Vec<_>>(),
                "downstream": e.downstream.iter().map(stage_token_to_str).collect::<Vec<_>>(),
                "group": e.group,
                "order": e.order,
            })
        })
        .collect())
}

// 抑制 StageToken 的 unused 警告（被 macro 使用）
#[allow(dead_code)]
fn _force_use_stage_token(_t: StageToken) {}