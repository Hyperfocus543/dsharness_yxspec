// review 命令：列审查报告 / 读单个

use crate::models::{ReviewSummary, StageToken};
use crate::models::stage_table::{stage_token_to_str, STAGE_TABLE};
use crate::parser::review as review_parser;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewEntry {
    pub stage: String,
    pub review: Option<ReviewSummary>,
    pub signoff_file: Option<String>,
}

/// 列出所有 25 阶段的审查报告
#[tauri::command]
pub async fn list_reviews(project_path: String) -> Result<Vec<ReviewEntry>, String> {
    let path = PathBuf::from(&project_path);
    let mut results = Vec::new();
    for entry in STAGE_TABLE {
        let token_str = stage_token_to_str(&entry.token);
        // 先尝试 task_review_{stage}.md
        let task_review_path = path.join("project/tasks").join(format!("task_review_{}.md", token_str));
        let summary = if task_review_path.exists() {
            review_parser::parse_task_review(&task_review_path).ok().flatten()
        } else {
            // 再尝试 spec_dirs 同目录的 review-{stage_token}-{spec_id}.md
            find_review_summary(&path, &entry.token)
        };

        // 找 signoff 文件
        let signoff_file = find_signoff(&path, &entry.token);

        results.push(ReviewEntry {
            stage: token_str,
            review: summary,
            signoff_file,
        });
    }
    Ok(results)
}

#[tauri::command]
pub async fn read_review(stage: String, project_path: String) -> Result<String, String> {
    let path = PathBuf::from(project_path);
    let task_review = path
        .join("project/tasks")
        .join(format!("task_review_{}.md", stage));
    if task_review.exists() {
        return std::fs::read_to_string(&task_review).map_err(|e| e.to_string());
    }
    // 兜底
    let token = STAGE_TABLE
        .iter()
        .find(|e| stage_token_to_str(&e.token) == stage)
        .map(|e| e.token.clone());
    if let Some(t) = token {
        if let Some(summary) = find_review_summary(&path, &t) {
            return std::fs::read_to_string(Path::new(&summary.file))
                .map_err(|e| e.to_string());
        }
    }
    Err(format!("未找到 {} 的审查报告", stage))
}

fn find_review_summary(project_path: &Path, token: &StageToken) -> Option<ReviewSummary> {
    let token_str = stage_token_to_str(token);
    let entry = STAGE_TABLE.iter().find(|e| &e.token == token)?;

    // 取 spec_id
    let spec_id = read_spec_id(project_path).unwrap_or_default();

    let review_token = match token {
        StageToken::SweCodingDo => "swe_coding", // 例外
        _ => &token_str,
    };

    // 决定目录
    let dir = if token_str == "swe_coding_plan" {
        Some(project_path.join("project/tasks/coding-plan"))
    } else if matches!(token, StageToken::SweCodingDo) {
        Some(project_path.join("project/tasks/coding-do"))
    } else if !entry.spec_globs.is_empty() {
        let first = entry.spec_globs[0];
        let dir_str = first.split('*').next().unwrap_or("").trim_end_matches('/');
        Some(project_path.join(dir_str))
    } else {
        None
    };

    if let Some(d) = dir {
        let pattern = if !spec_id.is_empty() {
            d.join(format!("review-{}-{}.md", review_token, spec_id))
        } else {
            d.join(format!("review-{}-*.md", review_token))
        };
        if pattern.exists() {
            return review_parser::parse_review_file(&pattern).ok().flatten();
        }
    }
    None
}

fn find_signoff(project_path: &Path, token: &StageToken) -> Option<String> {
    let summary = find_review_summary(project_path, token)?;
    let review_path = Path::new(&summary.file);
    let signoff = review_path.to_path_buf().with_file_name(format!(
        "{}-signoff.md",
        review_path.file_stem()?.to_string_lossy()
    ));
    if signoff.exists() {
        Some(signoff.to_string_lossy().to_string())
    } else {
        None
    }
}

fn read_spec_id(project_path: &Path) -> Option<String> {
    let progress = project_path.join("PROGRESS.md");
    let content = std::fs::read_to_string(progress).ok()?;
    for line in content.lines() {
        if line.contains("| spec_id |") {
            let parts: Vec<&str> = line.split('|').map(|s| s.trim()).collect();
            if parts.len() >= 3 {
                return Some(parts[2].to_string());
            }
        }
    }
    None
}