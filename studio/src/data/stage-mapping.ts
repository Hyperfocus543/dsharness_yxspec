// =============================================================================
// 25 阶段权威映射表（人读权威）
// 来源：.claude/commands/yxspec/next.md 第 29~60 行（手抄一份 + 适配 V+ 工作流）
// 机读镜像：yxspec/.claude/scripts/next_decision.py:STAGE_TABLE（双通道冗余）
//
// 关键纪律：
//   1. stage_token 用下划线，命令名用连字符，二者经常不同形！
//      - sys_elicitation → /yxspec:prd-analysis
//      - sqt_tr → /yxspec:sqt-tr-analysis
//      - swe_coding_do → /yxspec:swe-coding-do-v2
//   2. 任务文件名有别名：swe_analysis → task_sw_req.md，swe_arch_if → task_sw_arch_if.md
//   3. review 报告定位规则（来自 next.md 第 75 行）：
//      - 默认与被审产物同目录：specs/<子目录>/review-{stage_token}-{spec_id}.md
//      - 例外①：swe_coding_plan 审查报告在 project/tasks/coding-plan/review-swe_coding_plan-*.md
//      - 例外②：swe_coding_do 源码符合性审查 token=swe_coding，报告在 project/tasks/coding-do/review-swe_coding-*.md
// =============================================================================

import type { StageMapping, StageToken } from './types';

export const STAGE_TABLE: Record<StageToken, StageMapping> = {
  // ===== ACQ.4 阶段 1 =====
  init: {
    token: 'init',
    command: '/yxspec:init',
    command_name: 'init',
    aspice: 'ACQ.4',
    spec_globs: ['project/inputs/parsed/**/*.md', 'project/inputs/parsed/parse-summary.md'],
    task_file: 'task_init.md',
    review_gate: 'no',
    gate_policy: 'artifact',
    upstream: [],
    downstream: ['sys_elicitation'],
    group: 'ACQ',
    order: 1,
  },

  // ===== SYS.1 阶段 2 =====
  sys_elicitation: {
    token: 'sys_elicitation',
    command: '/yxspec:prd-analysis',
    command_name: 'prd-analysis',
    aspice: 'SYS.1',
    spec_globs: ['project/specs/prd/prd-*.md'],
    task_file: 'task_prd.md',
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['init'],
    downstream: ['sys_analysis'],
    group: 'SYS',
    order: 2,
  },

  // ===== SYS.2 阶段 3 =====
  sys_analysis: {
    token: 'sys_analysis',
    command: '/yxspec:sys-analysis',
    command_name: 'sys-analysis',
    aspice: 'SYS.2',
    spec_globs: ['project/specs/sys/sys-req-*.md'],
    task_file: 'task_sys_analysis.md',
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['sys_elicitation'],
    downstream: ['sys_arch'],
    group: 'SYS',
    order: 3,
  },

  // ===== SYS.3 阶段 4 =====
  sys_arch: {
    token: 'sys_arch',
    command: '/yxspec:sys-arch',
    command_name: 'sys-arch',
    aspice: 'SYS.3',
    spec_globs: ['project/specs/sys/sys-arch-*.md'],
    task_file: 'task_sys_arch.md',
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['sys_analysis'],
    downstream: ['hwe_analysis', 'swe_analysis'],
    group: 'SYS',
    order: 4,
  },

  // ===== HWE.1 阶段 5（无原生 slash 命令，网关层合成 /yxspec:hwe-analysis，经 yxspec-hwe-analysis agent 触发）=====
  hwe_analysis: {
    token: 'hwe_analysis',
    command: '/yxspec:hwe-analysis',
    command_name: 'hwe-analysis',
    aspice: 'HWE.1',
    spec_globs: ['project/specs/sys/hw-analyse-*.md'],
    task_file: null,
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['sys_arch'],
    downstream: [],
    group: 'HWE',
    order: 5,
  },

  // ===== SWE.1 阶段 6（注意：任务文件名是 task_sw_req.md，含别名 task_sw_req_from_prd.md）=====
  swe_analysis: {
    token: 'swe_analysis',
    command: '/yxspec:swe-analysis',
    command_name: 'swe-analysis',
    aspice: 'SWE.1',
    spec_globs: ['project/specs/sw-srs/sw-srs-*.md'],
    task_file: 'task_sw_req.md',
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['sys_arch'],
    downstream: ['swe_arch'],
    group: 'SWE',
    order: 6,
  },

  // ===== SWE.2 阶段 7 =====
  swe_arch: {
    token: 'swe_arch',
    command: '/yxspec:swe-arch-v2',
    command_name: 'swe-arch-v2',
    aspice: 'SWE.2',
    spec_globs: ['project/specs/sw-arch/sw-arch-*.md'],
    task_file: 'task_sw_arch.md',
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['swe_analysis'],
    downstream: ['swe_arch_if'],
    group: 'SWE',
    order: 7,
  },

  // ===== SWE.3 阶段 8（无审查门控）=====
  swe_arch_if: {
    token: 'swe_arch_if',
    command: '/yxspec:swe-arch-if-v2',
    command_name: 'swe-arch-if-v2',
    aspice: 'SWE.3',
    spec_globs: [
      'project/specs/sw-arch/sw-if/sw-if-*.md',
      'project/specs/sw-arch/sw-shared-types.md',
    ],
    task_file: 'task_sw_arch_if.md',
    review_gate: 'no',
    gate_policy: 'artifact',
    upstream: ['swe_arch'],
    downstream: ['swe_detail'],
    group: 'SWE',
    order: 8,
  },

  // ===== SWE.3 阶段 9 =====
  swe_detail: {
    token: 'swe_detail',
    command: '/yxspec:swe-detail',
    command_name: 'swe-detail',
    aspice: 'SWE.3',
    spec_globs: ['project/specs/sw-ddd/sw-ddd-*-ddd-mod-*.md'],
    task_file: null, // 按模块
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['swe_arch_if'],
    downstream: ['swe_coding_plan'],
    group: 'SWE',
    order: 9,
  },

  // ===== SWE.4 阶段 10a（编码计划）=====
  // 注意：完成度读 pipeline_state.json，按模块状态阈值推算
  swe_coding_plan: {
    token: 'swe_coding_plan',
    command: '/yxspec:swe-coding-plan-v2',
    command_name: 'swe-coding-plan-v2',
    aspice: 'SWE.4',
    spec_globs: [
      'project/tasks/coding-plan/coding-plan-MOD-*.md',
      'project/tasks/coding-plan/coding-plan-index.md',
    ],
    task_file: 'coding-plan/',
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['swe_detail'],
    downstream: ['swe_coding_do'],
    group: 'SWE',
    order: 10,
  },

  // ===== SWE.4 阶段 10b（编码执行）=====
  // 审查 token=swe_coding，报告在 project/tasks/coding-do/review-swe_coding-*.md
  swe_coding_do: {
    token: 'swe_coding_do',
    command: '/yxspec:swe-coding-do-v2',
    command_name: 'swe-coding-do-v2',
    aspice: 'SWE.4',
    spec_globs: [
      'project/tasks/coding-do/coding-result-MOD-*.md',
      'project/source/app_src/**/*',
    ],
    task_file: 'coding-do/',
    review_gate: 'no', // 可选审查
    gate_policy: 'artifact',
    upstream: ['swe_coding_plan'],
    downstream: ['swe_static_verify'],
    group: 'SWE',
    order: 11,
  },

  // ===== SWE.4 阶段 11（静态验证，无门控）=====
  swe_static_verify: {
    token: 'swe_static_verify',
    command: '/yxspec:swe-static-verify',
    command_name: 'swe-static-verify',
    aspice: 'SWE.4',
    spec_globs: ['tests/static/*.html'],
    task_file: null,
    review_gate: 'no',
    gate_policy: 'artifact',
    upstream: ['swe_coding_do'],
    downstream: ['swe_coding_verify'],
    group: 'SWE',
    order: 12,
  },

  // ===== SWE.4 阶段 12（实机验证）=====
  swe_coding_verify: {
    token: 'swe_coding_verify',
    command: '/yxspec:swe-coding-verify-v2',
    command_name: 'swe-coding-verify-v2',
    aspice: 'SWE.4',
    spec_globs: ['project/tasks/coding-verify/coding-verify-report.md'],
    task_file: 'coding-verify/',
    review_gate: 'no',
    gate_policy: 'artifact',
    upstream: ['swe_static_verify'],
    downstream: ['swe_unit_verify'],
    group: 'SWE',
    order: 13,
  },

  // ===== SWE.4 阶段 12a（PC 验证变体，与 12 二选一/并行）=====
  swe_coding_verify_pc: {
    token: 'swe_coding_verify_pc',
    command: '/yxspec:swe-coding-verify-pc-v2',
    command_name: 'swe-coding-verify-pc-v2',
    aspice: 'SWE.4',
    spec_globs: ['project/tasks/coding-verify-pc/coding-verify-pc-report.md'],
    task_file: 'coding-verify-pc/',
    review_gate: 'no',
    gate_policy: 'artifact',
    upstream: ['swe_static_verify'],
    downstream: ['swe_unit_verify'],
    group: 'SWE',
    order: 14,
  },

  // ===== SWE.4 阶段 13（单元测试；任务文件名 task_sw_ut.md 是别名）=====
  swe_unit_verify: {
    token: 'swe_unit_verify',
    command: '/yxspec:swe-unit-verify',
    command_name: 'swe-unit-verify',
    aspice: 'SWE.4',
    spec_globs: ['project/specs/ts-ut-*.md'],
    task_file: 'task_sw_ut.md',
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['swe_coding_verify'],
    downstream: ['swe_integration_verify'],
    group: 'SWE',
    order: 15,
  },

  // ===== SWE.5 阶段 14 =====
  swe_integration_verify: {
    token: 'swe_integration_verify',
    command: '/yxspec:swe-integration-verify',
    command_name: 'swe-integration-verify',
    aspice: 'SWE.5',
    spec_globs: ['project/specs/ts-it-*.md'],
    task_file: null,
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['swe_unit_verify'],
    downstream: ['sqt_strategy'],
    group: 'SWE',
    order: 16,
  },

  // ===== SYS.5 BP1 阶段 15 =====
  sqt_strategy: {
    token: 'sqt_strategy',
    command: '/yxspec:sqt-strategy',
    command_name: 'sqt-strategy',
    aspice: 'SYS.5/MAN.3',
    spec_globs: ['project/specs/sqt-tp/sqt-tp-*.md'],
    task_file: 'task_sqt_strategy.md',
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['swe_integration_verify'],
    downstream: ['sqt_tr'],
    group: 'SQT',
    order: 17,
  },

  // ===== SYS.5 BP2 阶段 16 =====
  sqt_tr: {
    token: 'sqt_tr',
    command: '/yxspec:sqt-tr-analysis',
    command_name: 'sqt-tr-analysis',
    aspice: 'SYS.5',
    spec_globs: ['project/specs/sqt-tr/sqt-tr-*.md'],
    task_file: 'task_sqt_tr_analysis.md',
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['sqt_strategy'],
    downstream: ['sqt_case_design'],
    group: 'SQT',
    order: 18,
  },

  // ===== SYS.5 BP3 阶段 17 =====
  sqt_case_design: {
    token: 'sqt_case_design',
    command: '/yxspec:sqt-case-design',
    command_name: 'sqt-case-design',
    aspice: 'SYS.5',
    spec_globs: ['project/specs/sqt-tc/sqt-tc-*.md'],
    task_file: 'task_sqt_case_design.md',
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['sqt_tr'],
    downstream: ['sqt_script_gen'],
    group: 'SQT',
    order: 19,
  },

  // ===== SYS.5 BP4 阶段 18（脚本生成，无门控）=====
  sqt_script_gen: {
    token: 'sqt_script_gen',
    command: '/yxspec:sqt-script-gen',
    command_name: 'sqt-script-gen',
    aspice: 'SYS.5',
    spec_globs: [
      'tests/auto_test/features/*.feature',
      'tests/auto_test/features/steps/*.py',
    ],
    task_file: 'task_sqt_script_gen.md',
    review_gate: 'no',
    gate_policy: 'artifact',
    upstream: ['sqt_case_design'],
    downstream: ['sqt_auto_test'],
    group: 'SQT',
    order: 20,
  },

  // ===== SYS.5 阶段 19（自动化测试）=====
  sqt_auto_test: {
    token: 'sqt_auto_test',
    command: '/yxspec:sqt-auto-test',
    command_name: 'sqt-auto-test',
    aspice: 'SYS.5/SUP.8',
    spec_globs: ['tests/**/defect-reports/**/report.md'],
    task_file: null,
    review_gate: 'no',
    gate_policy: 'artifact',
    upstream: ['sqt_script_gen'],
    downstream: ['sqt_defect_feedback'],
    group: 'SQT',
    order: 21,
  },

  // ===== SUP.8 阶段 20（缺陷闭环）=====
  sqt_defect_feedback: {
    token: 'sqt_defect_feedback',
    command: '/yxspec:sqt-defect-feedback',
    command_name: 'sqt-defect-feedback',
    aspice: 'SUP.8',
    spec_globs: ['project/specs/sqt-dr/sqt-dr-*.md'],
    task_file: 'task_sqt_defect_feedback.md',
    review_gate: 'yes',
    gate_policy: 'artifact+trajectory',
    upstream: ['sqt_auto_test'],
    downstream: ['comp'],
    group: 'SQT',
    order: 22,
  },

  // ===== SUP.1 阶段 21（合规检查，网关层合成 /yxspec:comp）=====
  comp: {
    token: 'comp',
    command: '/yxspec:comp',
    command_name: 'comp',
    aspice: 'SUP.1',
    spec_globs: ['project/specs/comp-report-*.md'],
    task_file: null,
    review_gate: 'no',
    gate_policy: 'artifact',
    upstream: ['sqt_defect_feedback'],
    downstream: ['traceability'],
    group: 'COMP',
    order: 23,
  },

  // ===== SUP.2 阶段 22（追溯矩阵，网关层合成 /yxspec:traceability）=====
  traceability: {
    token: 'traceability',
    command: '/yxspec:traceability',
    command_name: 'traceability',
    aspice: 'SUP.2',
    spec_globs: ['project/traceability/traceability-report-*.md'],
    task_file: 'task_traceability.md',
    review_gate: 'no',
    gate_policy: 'artifact',
    upstream: ['comp'],
    downstream: ['swe_sdk_release'],
    group: 'COMP',
    order: 24,
  },

  // ===== SPL.2 阶段 23 =====
  swe_sdk_release: {
    token: 'swe_sdk_release',
    command: '/yxspec:swe-sdk-release',
    command_name: 'swe-sdk-release',
    aspice: 'SPL.2',
    spec_globs: [], // SDK BSP tag，无文件产物
    task_file: null,
    review_gate: 'no',
    gate_policy: 'artifact',
    upstream: ['traceability'],
    downstream: ['swe_release'],
    group: 'REL',
    order: 25,
  },

  // ===== SPL.2 阶段 24 =====
  swe_release: {
    token: 'swe_release',
    command: '/yxspec:swe-release',
    command_name: 'swe-release',
    aspice: 'SPL.2',
    spec_globs: ['CHANGELOG.md'],
    task_file: null,
    review_gate: 'no',
    gate_policy: 'artifact',
    upstream: ['swe_sdk_release'],
    downstream: ['swe_release_promote'],
    group: 'REL',
    order: 26,
  },

  // ===== SPL.2 阶段 25 =====
  swe_release_promote: {
    token: 'swe_release_promote',
    command: '/yxspec:swe-release-promote',
    command_name: 'swe-release-promote',
    aspice: 'SPL.2',
    spec_globs: [], // stage 过渡，无文件产物
    task_file: null,
    review_gate: 'no',
    gate_policy: 'artifact',
    upstream: ['swe_release'],
    downstream: [],
    group: 'REL',
    order: 27,
  },
};

// 全部 stage_token 列表（按 order 排序）
export const STAGE_ORDER: StageToken[] = Object.values(STAGE_TABLE)
  .sort((a, b) => a.order - b.order)
  .map((s) => s.token);

// 按 group 分组（驾驶舱布局用）
export const STAGE_GROUPS: Record<string, StageToken[]> = {
  ACQ: STAGE_ORDER.filter((t) => STAGE_TABLE[t].group === 'ACQ'),
  SYS: STAGE_ORDER.filter((t) => STAGE_TABLE[t].group === 'SYS'),
  HWE: STAGE_ORDER.filter((t) => STAGE_TABLE[t].group === 'HWE'),
  SWE: STAGE_ORDER.filter((t) => STAGE_TABLE[t].group === 'SWE'),
  SQT: STAGE_ORDER.filter((t) => STAGE_TABLE[t].group === 'SQT'),
  COMP: STAGE_ORDER.filter((t) => STAGE_TABLE[t].group === 'COMP'),
  REL: STAGE_ORDER.filter((t) => STAGE_TABLE[t].group === 'REL'),
};
