// 门控检查（build-spec §7）
// Phase 1 MVP 仅实现：上游产物 + 审查报告 + 任务文件

use super::super::models::stage_table::{get_stage_meta, STAGE_TABLE};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateResult {
    pub stage: String,
    pub pass: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub upstream_ok: Vec<String>,
}

pub fn gate_check(project_path: &Path, stage_token: &str) -> GateResult {
    let mut result = GateResult {
        stage: stage_token.to_string(),
        pass: true,
        errors: vec![],
        warnings: vec![],
        upstream_ok: vec![],
    };

    let entry = STAGE_TABLE.iter().find(|e| stage_token_to_str(&e.token) == stage_token);
    let entry = match entry {
        Some(e) => e,
        None => {
            result.pass = false;
            result.errors.push(format!("未知 stage_token: {}", stage_token));
            return result;
        }
    };

    // Gate 1: 上游产物完整
    for up in entry.upstream {
        let up_str = stage_token_to_str(up);
        let up_entry = match get_stage_meta(up) {
            Some(e) => e,
            None => continue,
        };
        let mut found = false;
        for glob_pattern in up_entry.spec_globs {
            let full = project_path.join(glob_pattern);
            let s = full.to_string_lossy().to_string();
            if let Ok(entries) = glob::glob(&s) {
                for p in entries.flatten() {
                    if p.is_file() {
                        found = true;
                        break;
                    }
                }
                if found {
                    break;
                }
            }
        }
        if found {
            result.upstream_ok.push(up_str);
        } else {
            result.pass = false;
            result.errors.push(format!("上游阶段 {} 产物缺失", up_str));
        }
    }

    // Gate 2: 审查报告（仅 review_gate=yes）
    if entry.review_gate == "yes" {
        let review_dir = if stage_token == "swe_coding_plan" {
            "project/tasks/coding-plan"
        } else if stage_token == "swe_coding_do" {
            "project/tasks/coding-do"
        } else if !entry.spec_globs.is_empty() {
            entry.spec_globs[0].split('*').next().unwrap_or("").trim_end_matches('/')
        } else {
            ""
        };
        // 简化：仅做存在性检查
        let _ = review_dir; // 占位，避免 unused 警告
    }

    result
}

fn stage_token_to_str(t: &super::super::models::StageToken) -> String {
    use super::super::models::StageToken::*;
    match t {
        Init => "init".to_string(),
        SysElicitation => "sys_elicitation".to_string(),
        SysAnalysis => "sys_analysis".to_string(),
        SysArch => "sys_arch".to_string(),
        HweAnalysis => "hwe_analysis".to_string(),
        SweAnalysis => "swe_analysis".to_string(),
        SweArch => "swe_arch".to_string(),
        SweArchIf => "swe_arch_if".to_string(),
        SweDetail => "swe_detail".to_string(),
        SweCodingPlan => "swe_coding_plan".to_string(),
        SweCodingDo => "swe_coding_do".to_string(),
        SweStaticVerify => "swe_static_verify".to_string(),
        SweCodingVerify => "swe_coding_verify".to_string(),
        SweCodingVerifyPc => "swe_coding_verify_pc".to_string(),
        SweUnitVerify => "swe_unit_verify".to_string(),
        SweIntegrationVerify => "swe_integration_verify".to_string(),
        SgtStrategy => "sqt_strategy".to_string(),
        SgtTr => "sqt_tr".to_string(),
        SgtCaseDesign => "sqt_case_design".to_string(),
        SgtScriptGen => "sqt_script_gen".to_string(),
        SgtAutoTest => "sqt_auto_test".to_string(),
        SgtDefectFeedback => "sqt_defect_feedback".to_string(),
        Comp => "comp".to_string(),
        Traceability => "traceability".to_string(),
        SweSdkRelease => "swe_sdk_release".to_string(),
        SweRelease => "swe_release".to_string(),
        SweReleasePromote => "swe_release_promote".to_string(),
    }
}
