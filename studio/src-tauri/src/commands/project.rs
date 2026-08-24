// project 命令：打开项目 / 读 PROGRESS.md / 启动文件监听

use crate::models::ProjectInfo;
use crate::parser::progress;
use std::path::PathBuf;

#[tauri::command]
pub async fn open_project(project_path: String) -> Result<ProjectInfo, String> {
    let path = PathBuf::from(&project_path);
    if !path.exists() {
        return Err(format!("项目路径不存在: {}", project_path));
    }
    if !path.is_dir() {
        return Err(format!("项目路径不是目录: {}", project_path));
    }
    let progress_path = path.join("PROGRESS.md");
    if !progress_path.exists() {
        return Err(format!("PROGRESS.md 不存在: {:?}", progress_path));
    }
    progress::parse_progress(&path)
}

#[tauri::command]
pub async fn read_progress(project_path: String) -> Result<String, String> {
    let path = PathBuf::from(project_path).join("PROGRESS.md");
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败: {}", e))
}