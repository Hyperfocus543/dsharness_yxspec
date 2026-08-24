// =============================================================================
// 阶段状态计算引擎（来自 build-spec §5）
// 输入：项目路径 + stage_token
// 输出：StageStatus（status + artifacts + review + message）
//
// 状态机：
//   completed / in_progress / pending / pending_review / stale / rejected / blocked
//
// 计算步骤：
//   1. 检查 spec_globs 产物
//   2. 编码阶段专项（swe_coding_plan/do/verify）读 pipeline_state.json
//   3. 检查 review 报告（仅 review_gate=yes）
//   4. 默认
// =============================================================================

use super::super::models::{
    PipelineState, ReviewSummary, ReviewVerdict, StageStatus, StageStatusType, StageToken,
};
use super::super::models::stage_table::{get_stage_meta, stage_token_to_str};
use super::super::parser::{pipeline as pipeline_parser, review as review_parser};
use chrono::Local;
use glob::glob;
use std::path::{Path, PathBuf};

pub fn compute_stage_status(project_path: &Path, token: &StageToken) -> StageStatus {
    let entry = match get_stage_meta(token) {
        Some(e) => e,
        None => {
            return StageStatus {
                token: stage_token_to_str(token),
                status: StageStatusType::Pending,
                artifacts: vec![],
                review: None,
                last_update: Local::now().to_string(),
                message: "未知 stage_token".to_string(),
                artifacts_count: 0,
            }
        }
    };

    let mut status = StageStatus {
        token: stage_token_to_str(token),
        status: StageStatusType::Pending,
        artifacts: vec![],
        review: None,
        last_update: Local::now().to_string(),
        message: String::new(),
        artifacts_count: 0,
    };

    // ===== Step 1: 检查产物 =====
    let mut spec_files: Vec<String> = Vec::new();
    for glob_pattern in entry.spec_globs {
        let full_pattern = project_path.join(glob_pattern);
        let pattern_str = full_pattern.to_string_lossy().to_string();
        for entry in glob(&pattern_str).unwrap_or_default() {
            if let Ok(p) = entry {
                if p.is_file() {
                    spec_files.push(strip_project_prefix(&p, project_path));
                }
            }
        }
    }
    status.artifacts = spec_files.clone();
    status.artifacts_count = spec_files.len();

    if spec_files.is_empty() && !entry.spec_globs.is_empty() {
        status.status = StageStatusType::Pending;
        status.message = "产物缺失（spec_globs 全部未命中）".to_string();
        return status;
    }

    // ===== Step 2: 编码阶段专项 =====
    let token_str = stage_token_to_str(token);
    if matches!(
        token,
        StageToken::SweCodingPlan | StageToken::SweCodingDo | StageToken::SweCodingVerify
    ) {
        return compute_coding_status(project_path, token, status);
    }

    // ===== Step 3: 检查审查报告 =====
    if entry.review_gate == "yes" {
        // 先看 task_review_{stage}.md（task_review 文件，含 verdict 字段）
        let task_review_path = find_task_review(project_path, &token_str);
        let review_summary = if let Some(p) = task_review_path {
            review_parser::parse_task_review(&p).ok().flatten()
        } else {
            None
        };

        let review_summary = review_summary.or_else(|| {
            // 兜底：找 spec_globs 同目录的 review-{stage_token}-{spec_id}.md
            find_review_in_spec_dirs(project_path, token, entry.spec_globs)
        });

        match review_summary {
            Some(r) => {
                status.review = Some(r.clone());
                match r.verdict {
                    ReviewVerdict::Approved | ReviewVerdict::Conditional => {
                        status.status = StageStatusType::Completed;
                        status.message = format!(
                            "产物齐备（{}）+ 审查{}通过",
                            spec_files.len(),
                            match r.verdict {
                                ReviewVerdict::Approved => "approved",
                                ReviewVerdict::Conditional => "conditional",
                                _ => "",
                            }
                        );
                    }
                    ReviewVerdict::Rejected => {
                        status.status = StageStatusType::Rejected;
                        status.message = "审查未通过".to_string();
                    }
                }
            }
            None => {
                status.status = StageStatusType::PendingReview;
                status.message = format!("产物齐备（{}），待审查", spec_files.len());
            }
        }
    } else {
        // 无门控：产物齐备即完成
        status.status = StageStatusType::Completed;
        status.message = format!(
            "产物齐备（{}，无审查门控）",
            spec_files.len()
        );
    }

    status
}

/// 编码阶段专项（build-spec §5.3）
/// 适配真实 pipeline_state.json：每模块直接是单一 status 字段
fn compute_coding_status(
    project_path: &Path,
    token: &StageToken,
    mut status: StageStatus,
) -> StageStatus {
    let ps_path = project_path.join("project/tasks/pipeline_state.json");
    let ps: Option<PipelineState> = pipeline_parser::parse_pipeline_state(&ps_path)
        .ok()
        .flatten();

    let modules = match ps {
        Some(p) => p.modules,
        None => {
            status.status = StageStatusType::Pending;
            status.message = "pipeline_state.json 不存在".to_string();
            return status;
        }
    };

    let total = modules.len();
    if total == 0 {
        status.status = StageStatusType::Pending;
        status.message = "pipeline_state.json 中无模块".to_string();
        return status;
    }

    // 阶段判定规则（适配真实单 status 字段）：
    // - swe_coding_plan：完成度 = 已有 planned 状态以上的模块数 / 总数
    //   阈值：status ∈ {planned, coding, partial_done, done, verified, verify_stuck, review_failed, review_cleared}
    // - swe_coding_do：完成度 = status ∈ {done, verified} 的模块数 / 总数
    // - swe_coding_verify：完成度 = status == verified 的模块数 / 总数
    let (done_count, in_progress_count) = match token {
        StageToken::SweCodingPlan => {
            let planned_set = [
                "planned",
                "coding",
                "partial_done",
                "done",
                "verified",
                "verify_stuck",
                "review_failed",
                "review_cleared",
            ];
            let mut planned = 0;
            let mut coding = 0;
            for m in modules.values() {
                if planned_set.contains(&m.status.as_str()) {
                    planned += 1;
                }
                if m.status == "coding" || m.status == "partial_done" {
                    coding += 1;
                }
            }
            (planned, coding)
        }
        StageToken::SweCodingDo => {
            let mut done = 0;
            let mut verified = 0;
            for m in modules.values() {
                if m.status == "done" || m.status == "verified" {
                    done += 1;
                }
                if m.status == "verified" {
                    verified += 1;
                }
            }
            (done, verified)
        }
        StageToken::SweCodingVerify => {
            let mut verified = 0;
            let mut blocked = 0;
            for m in modules.values() {
                if m.status == "verified" {
                    verified += 1;
                }
                if m.status == "blocked" || m.status == "verify_stuck" {
                    blocked += 1;
                }
            }
            (verified, blocked)
        }
        _ => (0, 0),
    };

    status.status = if done_count == total {
        StageStatusType::Completed
    } else if matches!(token, StageToken::SweCodingVerify) && in_progress_count > 0 {
        // 编码验证阶段：阻塞模块存在则置 blocked
        StageStatusType::Blocked
    } else if in_progress_count > 0 || done_count > 0 {
        StageStatusType::InProgress
    } else {
        StageStatusType::Pending
    };
    status.message = format!(
        "{}/{} 模块达成 ({}/total = {}%)",
        done_count,
        total,
        done_count,
        (done_count * 100) / total.max(1)
    );
    status
}

/// 找 task_review_{stage_token}.md
fn find_task_review(project_path: &Path, token_str: &str) -> Option<PathBuf> {
    let tasks_dir = project_path.join("project/tasks");
    let pattern = tasks_dir.join(format!("task_review_{}.md", token_str));
    if pattern.exists() {
        Some(pattern)
    } else {
        None
    }
}

/// 兜底：在 spec_globs 第一项的目录里找 review-{stage_token}-{spec_id}.md
fn find_review_in_spec_dirs(
    project_path: &Path,
    token: &StageToken,
    spec_globs: &[&str],
) -> Option<ReviewSummary> {
    // 取项目 spec_id（从 PROGRESS.md）
    let progress_path = project_path.join("PROGRESS.md");
    let spec_id = if let Ok(content) = std::fs::read_to_string(&progress_path) {
        extract_spec_id(&content).unwrap_or_default()
    } else {
        String::new()
    };

    let review_token = match token {
        StageToken::SweCodingDo => "swe_coding", // 例外
        _ => return None, // 这里只处理 swe_coding_do 的兜底，其他走 spec_dirs
    };

    if spec_globs.is_empty() {
        return None;
    }

    let first = spec_globs[0];
    // coding-do/ 的 review 在 coding-do/ 同目录
    let review_dir = if first.starts_with("project/tasks/coding-do/") {
        project_path.join("project/tasks/coding-do")
    } else {
        return None;
    };

    let pattern = if !spec_id.is_empty() {
        review_dir.join(format!("review-{}-{}-{}.md", review_token, "{}", spec_id))
    } else {
        return None;
    };

    review_parser::parse_review_file(&pattern).ok().flatten()
}

fn extract_spec_id(progress_content: &str) -> Option<String> {
    for line in progress_content.lines() {
        if line.contains("| spec_id |") {
            let parts: Vec<&str> = line.split('|').map(|s| s.trim()).collect();
            if parts.len() >= 3 {
                return Some(parts[2].to_string());
            }
        }
    }
    None
}

fn strip_project_prefix(p: &Path, project_root: &Path) -> String {
    p.strip_prefix(project_root)
        .map(|x| x.to_string_lossy().to_string().replace('\\', "/"))
        .unwrap_or_else(|_| p.to_string_lossy().to_string())
}
