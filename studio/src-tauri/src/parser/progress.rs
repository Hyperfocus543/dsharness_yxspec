// PROGRESS.md 解析
// 真实格式示例（来自 trainees-2026/PROGRESS.md）：
//   # PROGRESS — <project_id> 循环工作流状态中心
//   ## 项目元信息
//   | 项 | 值 |
//   |----|-----|
//   | spec_id | trainees-2026 |
//   | 产品 | ... |
//   ...

use super::super::models::{ProjectMeta, ProjectInfo};
use std::path::Path;

pub fn parse_progress(project_path: &Path) -> Result<ProjectInfo, String> {
    let progress_path = project_path.join("PROGRESS.md");
    let content = std::fs::read_to_string(&progress_path)
        .map_err(|e| format!("读取 PROGRESS.md 失败 {:?}: {}", progress_path, e))?;

    let meta = parse_project_meta(&content);
    Ok(ProjectInfo {
        path: project_path.to_string_lossy().to_string(),
        meta,
        progress_raw: content,
    })
}

fn parse_project_meta(content: &str) -> ProjectMeta {
    let mut meta = ProjectMeta {
        spec_id: String::new(),
        product: String::new(),
        git_branch: String::new(),
        team_remote: String::new(),
        personal_remote: String::new(),
        baseline_branch: String::new(),
        target_schedule: String::new(),
    };

    let mut in_meta_section = false;
    for line in content.lines() {
        if line.starts_with("## 项目元信息") {
            in_meta_section = true;
            continue;
        }
        if in_meta_section && line.starts_with("## ") {
            break;
        }
        if !in_meta_section {
            continue;
        }
        // 解析 "| key | value |"
        let trimmed = line.trim();
        if !trimmed.starts_with('|') {
            continue;
        }
        let parts: Vec<&str> = trimmed
            .split('|')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() < 2 {
            continue;
        }
        let key = parts[0];
        let value = parts[1];
        match key {
            "spec_id" => meta.spec_id = value.to_string(),
            "产品" => meta.product = value.to_string(),
            "git 分支" => meta.git_branch = value.to_string(),
            "团队仓远端" => meta.team_remote = value.to_string(),
            "个人备份远端" => meta.personal_remote = value.to_string(),
            "基线分支" => meta.baseline_branch = value.to_string(),
            "工期目标" => meta.target_schedule = value.to_string(),
            _ => {}
        }
    }
    meta
}
