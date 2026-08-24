// =============================================================================
// 25 阶段权威映射表（Rust 镜像）
// 与 src/data/stage-mapping.ts 严格对齐；只读 src-tauri/src/models/stage_table.rs 的
// 改动必须同步到前端，否则会出现前后端阶段不一致 bug。
//
// 关键纪律（来自 .claude/commands/yxspec/next.md）：
//   1. stage_token 用下划线，命令名用连字符，二者经常不同形
//   2. 任务文件名有别名
//   3. review 报告默认与被审产物同目录，两个例外（swe_coding_plan/swe_coding_do）
// =============================================================================

use super::StageToken;

pub struct StageTableEntry {
    pub token: StageToken,
    pub command: &'static str,
    pub command_name: &'static str,
    pub aspice: &'static str,
    pub spec_globs: &'static [&'static str],
    pub task_file: Option<&'static str>,
    pub review_gate: &'static str, // "yes" / "no"
    pub upstream: &'static [StageToken],
    pub downstream: &'static [StageToken],
    pub group: &'static str,
    pub order: u32,
}

pub const STAGE_TABLE: &[StageTableEntry] = &[
    // ===== ACQ.4 阶段 1 =====
    StageTableEntry {
        token: StageToken::Init,
        command: "/yxspec:init",
        command_name: "init",
        aspice: "ACQ.4",
        spec_globs: &[
            "project/inputs/parsed/**/*.md",
            "project/inputs/parsed/parse-summary.md",
        ],
        task_file: Some("task_init.md"),
        review_gate: "no",
        upstream: &[],
        downstream: &[StageToken::SysElicitation],
        group: "ACQ",
        order: 1,
    },
    // ===== SYS.1 阶段 2 =====
    StageTableEntry {
        token: StageToken::SysElicitation,
        command: "/yxspec:prd-analysis",
        command_name: "prd-analysis",
        aspice: "SYS.1",
        spec_globs: &["project/specs/prd/prd-*.md"],
        task_file: Some("task_prd.md"),
        review_gate: "yes",
        upstream: &[StageToken::Init],
        downstream: &[StageToken::SysAnalysis],
        group: "SYS",
        order: 2,
    },
    // ===== SYS.2 阶段 3 =====
    StageTableEntry {
        token: StageToken::SysAnalysis,
        command: "/yxspec:sys-analysis",
        command_name: "sys-analysis",
        aspice: "SYS.2",
        spec_globs: &["project/specs/sys/sys-req-*.md"],
        task_file: Some("task_sys_analysis.md"),
        review_gate: "yes",
        upstream: &[StageToken::SysElicitation],
        downstream: &[StageToken::SysArch],
        group: "SYS",
        order: 3,
    },
    // ===== SYS.3 阶段 4 =====
    StageTableEntry {
        token: StageToken::SysArch,
        command: "/yxspec:sys-arch",
        command_name: "sys-arch",
        aspice: "SYS.3",
        spec_globs: &["project/specs/sys/sys-arch-*.md"],
        task_file: Some("task_sys_arch.md"),
        review_gate: "yes",
        upstream: &[StageToken::SysAnalysis],
        downstream: &[StageToken::HweAnalysis, StageToken::SweAnalysis],
        group: "SYS",
        order: 4,
    },
    // ===== HWE.1 阶段 5 =====
    StageTableEntry {
        token: StageToken::HweAnalysis,
        command: "（yxspec-hwe-analysis agent）",
        command_name: "yxspec-hwe-analysis",
        aspice: "HWE.1",
        spec_globs: &["project/specs/hw-*/*.md"],
        task_file: None,
        review_gate: "yes",
        upstream: &[StageToken::SysArch],
        downstream: &[],
        group: "HWE",
        order: 5,
    },
    // ===== SWE.1 阶段 6 =====
    StageTableEntry {
        token: StageToken::SweAnalysis,
        command: "/yxspec:swe-analysis",
        command_name: "swe-analysis",
        aspice: "SWE.1",
        spec_globs: &["project/specs/sw-srs/sw-srs-*.md"],
        task_file: Some("task_sw_req.md"),
        review_gate: "yes",
        upstream: &[StageToken::SysArch],
        downstream: &[StageToken::SweArch],
        group: "SWE",
        order: 6,
    },
    // ===== SWE.2 阶段 7 =====
    StageTableEntry {
        token: StageToken::SweArch,
        command: "/yxspec:swe-arch-v2",
        command_name: "swe-arch-v2",
        aspice: "SWE.2",
        spec_globs: &["project/specs/sw-arch/sw-arch-*.md"],
        task_file: Some("task_sw_arch.md"),
        review_gate: "yes",
        upstream: &[StageToken::SweAnalysis],
        downstream: &[StageToken::SweArchIf],
        group: "SWE",
        order: 7,
    },
    // ===== SWE.3 阶段 8 =====
    StageTableEntry {
        token: StageToken::SweArchIf,
        command: "/yxspec:swe-arch-if-v2",
        command_name: "swe-arch-if-v2",
        aspice: "SWE.3",
        spec_globs: &[
            "project/specs/sw-arch/sw-if/sw-if-*.md",
            "project/specs/sw-arch/sw-shared-types.md",
        ],
        task_file: Some("task_sw_arch_if.md"),
        review_gate: "no",
        upstream: &[StageToken::SweArch],
        downstream: &[StageToken::SweDetail],
        group: "SWE",
        order: 8,
    },
    // ===== SWE.3 阶段 9 =====
    StageTableEntry {
        token: StageToken::SweDetail,
        command: "/yxspec:swe-detail",
        command_name: "swe-detail",
        aspice: "SWE.3",
        spec_globs: &["project/specs/sw-ddd/sw-ddd-*-ddd-mod-*.md"],
        task_file: None,
        review_gate: "yes",
        upstream: &[StageToken::SweArchIf],
        downstream: &[StageToken::SweCodingPlan],
        group: "SWE",
        order: 9,
    },
    // ===== SWE.4 阶段 10a =====
    StageTableEntry {
        token: StageToken::SweCodingPlan,
        command: "/yxspec:swe-coding-plan-v2",
        command_name: "swe-coding-plan-v2",
        aspice: "SWE.4",
        spec_globs: &[
            "project/tasks/coding-plan/coding-plan-MOD-*.md",
            "project/tasks/coding-plan/coding-plan-index.md",
        ],
        task_file: Some("coding-plan/"),
        review_gate: "yes",
        upstream: &[StageToken::SweDetail],
        downstream: &[StageToken::SweCodingDo],
        group: "SWE",
        order: 10,
    },
    // ===== SWE.4 阶段 10b =====
    StageTableEntry {
        token: StageToken::SweCodingDo,
        command: "/yxspec:swe-coding-do-v2",
        command_name: "swe-coding-do-v2",
        aspice: "SWE.4",
        spec_globs: &[
            "project/tasks/coding-do/coding-result-MOD-*.md",
            "project/source/app_src/**/*",
        ],
        task_file: Some("coding-do/"),
        review_gate: "no",
        upstream: &[StageToken::SweCodingPlan],
        downstream: &[StageToken::SweStaticVerify],
        group: "SWE",
        order: 11,
    },
    // ===== SWE.4 阶段 11 =====
    StageTableEntry {
        token: StageToken::SweStaticVerify,
        command: "/yxspec:swe-static-verify",
        command_name: "swe-static-verify",
        aspice: "SWE.4",
        spec_globs: &["tests/static/*.html"],
        task_file: None,
        review_gate: "no",
        upstream: &[StageToken::SweCodingDo],
        downstream: &[StageToken::SweCodingVerify],
        group: "SWE",
        order: 12,
    },
    // ===== SWE.4 阶段 12 =====
    StageTableEntry {
        token: StageToken::SweCodingVerify,
        command: "/yxspec:swe-coding-verify-v2",
        command_name: "swe-coding-verify-v2",
        aspice: "SWE.4",
        spec_globs: &["project/tasks/coding-verify/coding-verify-report.md"],
        task_file: Some("coding-verify/"),
        review_gate: "no",
        upstream: &[StageToken::SweStaticVerify],
        downstream: &[StageToken::SweUnitVerify],
        group: "SWE",
        order: 13,
    },
    // ===== SWE.4 阶段 12a =====
    StageTableEntry {
        token: StageToken::SweCodingVerifyPc,
        command: "/yxspec:swe-coding-verify-pc-v2",
        command_name: "swe-coding-verify-pc-v2",
        aspice: "SWE.4",
        spec_globs: &["project/tasks/coding-verify-pc/coding-verify-pc-report.md"],
        task_file: Some("coding-verify-pc/"),
        review_gate: "no",
        upstream: &[StageToken::SweStaticVerify],
        downstream: &[StageToken::SweUnitVerify],
        group: "SWE",
        order: 14,
    },
    // ===== SWE.4 阶段 13 =====
    StageTableEntry {
        token: StageToken::SweUnitVerify,
        command: "/yxspec:swe-unit-verify",
        command_name: "swe-unit-verify",
        aspice: "SWE.4",
        spec_globs: &["project/specs/ts-ut-*.md"],
        task_file: Some("task_sw_ut.md"),
        review_gate: "yes",
        upstream: &[StageToken::SweCodingVerify],
        downstream: &[StageToken::SweIntegrationVerify],
        group: "SWE",
        order: 15,
    },
    // ===== SWE.5 阶段 14 =====
    StageTableEntry {
        token: StageToken::SweIntegrationVerify,
        command: "/yxspec:swe-integration-verify",
        command_name: "swe-integration-verify",
        aspice: "SWE.5",
        spec_globs: &["project/specs/ts-it-*.md"],
        task_file: None,
        review_gate: "yes",
        upstream: &[StageToken::SweUnitVerify],
        downstream: &[StageToken::SgtStrategy],
        group: "SWE",
        order: 16,
    },
    // ===== SYS.5 BP1 阶段 15 =====
    StageTableEntry {
        token: StageToken::SgtStrategy,
        command: "/yxspec:sqt-strategy",
        command_name: "sqt-strategy",
        aspice: "SYS.5/MAN.3",
        spec_globs: &["project/specs/sqt-tp/sqt-tp-*.md"],
        task_file: Some("task_sqt_strategy.md"),
        review_gate: "yes",
        upstream: &[StageToken::SweIntegrationVerify],
        downstream: &[StageToken::SgtTr],
        group: "SQT",
        order: 17,
    },
    // ===== SYS.5 BP2 阶段 16 =====
    StageTableEntry {
        token: StageToken::SgtTr,
        command: "/yxspec:sqt-tr-analysis",
        command_name: "sqt-tr-analysis",
        aspice: "SYS.5",
        spec_globs: &["project/specs/sqt-tr/sqt-tr-*.md"],
        task_file: Some("task_sqt_tr_analysis.md"),
        review_gate: "yes",
        upstream: &[StageToken::SgtStrategy],
        downstream: &[StageToken::SgtCaseDesign],
        group: "SQT",
        order: 18,
    },
    // ===== SYS.5 BP3 阶段 17 =====
    StageTableEntry {
        token: StageToken::SgtCaseDesign,
        command: "/yxspec:sqt-case-design",
        command_name: "sqt-case-design",
        aspice: "SYS.5",
        spec_globs: &["project/specs/sqt-tc/sqt-tc-*.md"],
        task_file: Some("task_sqt_case_design.md"),
        review_gate: "yes",
        upstream: &[StageToken::SgtTr],
        downstream: &[StageToken::SgtScriptGen],
        group: "SQT",
        order: 19,
    },
    // ===== SYS.5 BP4 阶段 18 =====
    StageTableEntry {
        token: StageToken::SgtScriptGen,
        command: "/yxspec:sqt-script-gen",
        command_name: "sqt-script-gen",
        aspice: "SYS.5",
        spec_globs: &[
            "tests/auto_test/features/*.feature",
            "tests/auto_test/features/steps/*.py",
        ],
        task_file: Some("task_sqt_script_gen.md"),
        review_gate: "no",
        upstream: &[StageToken::SgtCaseDesign],
        downstream: &[StageToken::SgtAutoTest],
        group: "SQT",
        order: 20,
    },
    // ===== SYS.5 阶段 19 =====
    StageTableEntry {
        token: StageToken::SgtAutoTest,
        command: "/yxspec:sqt-auto-test",
        command_name: "sqt-auto-test",
        aspice: "SYS.5/SUP.8",
        spec_globs: &["tests/**/defect-reports/**/report.md"],
        task_file: None,
        review_gate: "no",
        upstream: &[StageToken::SgtScriptGen],
        downstream: &[StageToken::SgtDefectFeedback],
        group: "SQT",
        order: 21,
    },
    // ===== SUP.8 阶段 20 =====
    StageTableEntry {
        token: StageToken::SgtDefectFeedback,
        command: "/yxspec:sqt-defect-feedback",
        command_name: "sqt-defect-feedback",
        aspice: "SUP.8",
        spec_globs: &["project/specs/sqt-dr/sqt-dr-*.md"],
        task_file: Some("task_sqt_defect_feedback.md"),
        review_gate: "yes",
        upstream: &[StageToken::SgtAutoTest],
        downstream: &[StageToken::Comp],
        group: "SQT",
        order: 22,
    },
    // ===== SUP.1 阶段 21 =====
    StageTableEntry {
        token: StageToken::Comp,
        command: "（yxspec-comp agent）",
        command_name: "yxspec-comp",
        aspice: "SUP.1",
        spec_globs: &["project/specs/comp-report-*.md"],
        task_file: None,
        review_gate: "no",
        upstream: &[StageToken::SgtDefectFeedback],
        downstream: &[StageToken::Traceability],
        group: "COMP",
        order: 23,
    },
    // ===== SUP.2 阶段 22 =====
    StageTableEntry {
        token: StageToken::Traceability,
        command: "（yxspec-traceability agent）",
        command_name: "yxspec-traceability",
        aspice: "SUP.2",
        spec_globs: &["project/traceability/traceability-report-*.md"],
        task_file: Some("task_traceability.md"),
        review_gate: "no",
        upstream: &[StageToken::Comp],
        downstream: &[StageToken::SweSdkRelease],
        group: "COMP",
        order: 24,
    },
    // ===== SPL.2 阶段 23 =====
    StageTableEntry {
        token: StageToken::SweSdkRelease,
        command: "/yxspec:swe-sdk-release",
        command_name: "swe-sdk-release",
        aspice: "SPL.2",
        spec_globs: &[],
        task_file: None,
        review_gate: "no",
        upstream: &[StageToken::Traceability],
        downstream: &[StageToken::SweRelease],
        group: "REL",
        order: 25,
    },
    // ===== SPL.2 阶段 24 =====
    StageTableEntry {
        token: StageToken::SweRelease,
        command: "/yxspec:swe-release",
        command_name: "swe-release",
        aspice: "SPL.2",
        spec_globs: &["CHANGELOG.md"],
        task_file: None,
        review_gate: "no",
        upstream: &[StageToken::SweSdkRelease],
        downstream: &[StageToken::SweReleasePromote],
        group: "REL",
        order: 26,
    },
    // ===== SPL.2 阶段 25 =====
    StageTableEntry {
        token: StageToken::SweReleasePromote,
        command: "/yxspec:swe-release-promote",
        command_name: "swe-release-promote",
        aspice: "SPL.2",
        spec_globs: &[],
        task_file: None,
        review_gate: "no",
        upstream: &[StageToken::SweRelease],
        downstream: &[],
        group: "REL",
        order: 27,
    },
];

pub fn get_stage_meta(token: &StageToken) -> Option<&'static StageTableEntry> {
    STAGE_TABLE.iter().find(|s| &s.token == token)
}

pub fn token_from_str(s: &str) -> Option<StageToken> {
    let normalized = s.replace('-', "_").to_lowercase();
    STAGE_TABLE
        .iter()
        .find(|entry| {
            let t_str = stage_token_to_str(&entry.token);
            t_str == normalized || entry.command_name.replace('-', "_").to_lowercase() == normalized
        })
        .map(|e| e.token.clone())
}

pub fn stage_token_to_str(t: &StageToken) -> String {
    match t {
        StageToken::Init => "init".to_string(),
        StageToken::SysElicitation => "sys_elicitation".to_string(),
        StageToken::SysAnalysis => "sys_analysis".to_string(),
        StageToken::SysArch => "sys_arch".to_string(),
        StageToken::HweAnalysis => "hwe_analysis".to_string(),
        StageToken::SweAnalysis => "swe_analysis".to_string(),
        StageToken::SweArch => "swe_arch".to_string(),
        StageToken::SweArchIf => "swe_arch_if".to_string(),
        StageToken::SweDetail => "swe_detail".to_string(),
        StageToken::SweCodingPlan => "swe_coding_plan".to_string(),
        StageToken::SweCodingDo => "swe_coding_do".to_string(),
        StageToken::SweStaticVerify => "swe_static_verify".to_string(),
        StageToken::SweCodingVerify => "swe_coding_verify".to_string(),
        StageToken::SweCodingVerifyPc => "swe_coding_verify_pc".to_string(),
        StageToken::SweUnitVerify => "swe_unit_verify".to_string(),
        StageToken::SweIntegrationVerify => "swe_integration_verify".to_string(),
        StageToken::SgtStrategy => "sqt_strategy".to_string(),
        StageToken::SgtTr => "sqt_tr".to_string(),
        StageToken::SgtCaseDesign => "sqt_case_design".to_string(),
        StageToken::SgtScriptGen => "sqt_script_gen".to_string(),
        StageToken::SgtAutoTest => "sqt_auto_test".to_string(),
        StageToken::SgtDefectFeedback => "sqt_defect_feedback".to_string(),
        StageToken::Comp => "comp".to_string(),
        StageToken::Traceability => "traceability".to_string(),
        StageToken::SweSdkRelease => "swe_sdk_release".to_string(),
        StageToken::SweRelease => "swe_release".to_string(),
        StageToken::SweReleasePromote => "swe_release_promote".to_string(),
    }
}
