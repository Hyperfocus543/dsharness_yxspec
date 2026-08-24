// review-*.md 解析器
// 真实格式示例（来自 review-sqt_defect_feedback-trainees-2026.md）：
//   # Review - sqt_defect_feedback - 2026-...
//   ## 审查元信息
//   - 项目：trainees-2026
//   - 阶段：sqt_defect_feedback
//   - 审查日期：2026-08-02
//   - 审查人：[技术负责人] / [质量负责人]
//
//   ## 评分
//   - verdict: approved
//   - tech_lead: 林汉飞
//   - quality_lead: 林汉飞
//   - signoff: true
//
// 也支持 task_review_{stage}.md 格式（汇总在 tasks/ 目录下）：
//   | verdict | approved | signoff | ... |
//   | signoff_file | project/specs/sqt-dr/review-sqt_defect_feedback-trainees-2026-signoff.md |

use super::super::models::{ReviewSummary, ReviewVerdict};
use std::path::Path;

pub fn parse_review_file(review_file: &Path) -> Result<Option<ReviewSummary>, String> {
    if !review_file.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(review_file)
        .map_err(|e| format!("读取审查报告失败: {}", e))?;
    parse_review_content(&content, &review_file.to_string_lossy())
}

/// 解析 task_review_{stage}.md 的 verdict 字段
pub fn parse_task_review(task_review_file: &Path) -> Result<Option<ReviewSummary>, String> {
    if !task_review_file.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(task_review_file)
        .map_err(|e| format!("读取 task_review 失败: {}", e))?;

    let mut verdict: Option<ReviewVerdict> = None;
    let mut tech_lead = String::new();
    let mut quality_lead = String::new();
    let mut signoff = false;
    let mut date = String::new();
    let mut review_report = String::new();
    let mut signoff_file = String::new();

    for line in content.lines() {
        let trimmed = line.trim();
        // 表格行
        if trimmed.starts_with('|') {
            let cells: Vec<&str> = trimmed
                .split('|')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect();
            if cells.len() >= 2 {
                let key = cells[0];
                let value = cells[1];
                match key {
                    "verdict" => {
                        verdict = Some(match value.to_lowercase().as_str() {
                            "approved" => ReviewVerdict::Approved,
                            "conditional" => ReviewVerdict::Conditional,
                            "rejected" => ReviewVerdict::Rejected,
                            _ => continue,
                        });
                    }
                    "signoff" => {
                        signoff = value.to_lowercase().contains("已签") || value == "true";
                    }
                    "review_report" => review_report = value.to_string(),
                    "signoff_file" => signoff_file = value.to_string(),
                    "plan_start" | "finished_at" => {
                        if date.is_empty() {
                            date = value.to_string();
                        }
                    }
                    _ => {}
                }
            }
        }
        // 列表行
        if trimmed.starts_with("- ") {
            let body = &trimmed[2..];
            if let Some(rest) = body.strip_prefix("verdict:") {
                verdict = Some(match rest.trim().to_lowercase().as_str() {
                    "approved" => ReviewVerdict::Approved,
                    "conditional" => ReviewVerdict::Conditional,
                    "rejected" => ReviewVerdict::Rejected,
                    _ => continue,
                });
            } else if let Some(rest) = body.strip_prefix("tech_lead:") {
                tech_lead = rest.trim().to_string();
            } else if let Some(rest) = body.strip_prefix("quality_lead:") {
                quality_lead = rest.trim().to_string();
            } else if let Some(rest) = body.strip_prefix("signoff:") {
                signoff = rest.trim().to_lowercase() == "true";
            }
        }
    }

    if let Some(v) = verdict {
        let file = if !review_report.is_empty() {
            review_report
        } else {
            task_review_file.to_string_lossy().to_string()
        };
        return Ok(Some(ReviewSummary {
            verdict: v,
            tech_lead,
            quality_lead,
            signoff,
            date,
            file,
        }));
    }

    // 如果没解析到 verdict，尝试读对应的 review-{stage}-{spec_id}.md
    if !review_report.is_empty() {
        let path = std::path::Path::new(&review_report);
        if path.exists() {
            return parse_review_file(path);
        }
    }
    if !signoff_file.is_empty() {
        let path = std::path::Path::new(&signoff_file);
        if path.exists() {
            return parse_review_file(path);
        }
    }

    Ok(None)
}

fn parse_review_content(content: &str, file: &str) -> Result<Option<ReviewSummary>, String> {
    let mut verdict: Option<ReviewVerdict> = None;
    let mut tech_lead = String::new();
    let mut quality_lead = String::new();
    let mut signoff = false;
    let mut date = String::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("- ") {
            let body = &trimmed[2..];
            if let Some(rest) = body.strip_prefix("verdict:") {
                verdict = Some(match rest.trim().to_lowercase().as_str() {
                    "approved" => ReviewVerdict::Approved,
                    "conditional" => ReviewVerdict::Conditional,
                    "rejected" => ReviewVerdict::Rejected,
                    _ => continue,
                });
            } else if let Some(rest) = body.strip_prefix("tech_lead:") {
                tech_lead = rest.trim().to_string();
            } else if let Some(rest) = body.strip_prefix("quality_lead:") {
                quality_lead = rest.trim().to_string();
            } else if let Some(rest) = body.strip_prefix("signoff:") {
                signoff = rest.trim().to_lowercase() == "true";
            } else if let Some(rest) = body.strip_prefix("审查日期：") {
                date = rest.trim().to_string();
            } else if let Some(rest) = body.strip_prefix("审查日期:") {
                date = rest.trim().to_string();
            }
        }
        // 列表行
        if trimmed.starts_with('|') {
            let cells: Vec<&str> = trimmed
                .split('|')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect();
            if cells.len() >= 2 {
                let key = cells[0];
                let value = cells[1];
                match key {
                    "verdict" => {
                        verdict = Some(match value.to_lowercase().as_str() {
                            "approved" => ReviewVerdict::Approved,
                            "conditional" => ReviewVerdict::Conditional,
                            "rejected" => ReviewVerdict::Rejected,
                            _ => continue,
                        });
                    }
                    "tech_lead" => tech_lead = value.to_string(),
                    "quality_lead" => quality_lead = value.to_string(),
                    "signoff" => {
                        signoff = value.to_lowercase() == "true";
                    }
                    _ => {}
                }
            }
        }
    }

    if let Some(v) = verdict {
        Ok(Some(ReviewSummary {
            verdict: v,
            tech_lead,
            quality_lead,
            signoff,
            date,
            file: file.to_string(),
        }))
    } else {
        Ok(None)
    }
}
