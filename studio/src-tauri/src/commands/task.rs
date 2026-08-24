// task 命令：列出 task_*.md / 读单个 / 更新状态（写回）

use crate::engine::task_machine::validate_transition;
use crate::models::{Task, TaskStatusType};
use crate::parser::task as task_parser;
use std::path::PathBuf;

#[tauri::command]
pub async fn list_tasks(
    project_path: String,
    task_file: String,
) -> Result<Vec<Task>, String> {
    let path = PathBuf::from(project_path).join(&task_file);
    task_parser::parse_task_file(&path)
}

#[tauri::command]
pub async fn read_task(
    project_path: String,
    task_file: String,
) -> Result<String, String> {
    let path = PathBuf::from(project_path).join(&task_file);
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败: {}", e))
}

#[tauri::command]
pub async fn update_task(
    project_path: String,
    task_file: String,
    task_id: String,
    new_status: String,
    timestamp: String,
) -> Result<String, String> {
    let path = PathBuf::from(project_path).join(&task_file);

    // 解析新状态
    let new_status_enum = match new_status.as_str() {
        "pending" => TaskStatusType::Pending,
        "ready" => TaskStatusType::Ready,
        "in_progress" => TaskStatusType::InProgress,
        "blocked" => TaskStatusType::Blocked,
        "done" => TaskStatusType::Done,
        "skipped" => TaskStatusType::Skipped,
        "stale" => TaskStatusType::Stale,
        _ => return Err(format!("未知状态: {}", new_status)),
    };

    // 找到任务当前状态
    let tasks = task_parser::parse_task_file(&path)?;
    let current = tasks
        .iter()
        .find(|t| t.id == task_id)
        .ok_or_else(|| format!("任务不存在: {}", task_id))?;

    // 校验转换合法性
    let transition = validate_transition(&current.status, &new_status_enum);
    if !transition.ok {
        return Err(transition.reason);
    }

    // 写回
    task_parser::write_task_status(&path, &task_id, new_status_enum, &timestamp)?;
    Ok("OK".to_string())
}