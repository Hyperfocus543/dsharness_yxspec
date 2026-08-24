// =============================================================================
// M5 产物图谱 - 节点元数据
// 把 25 阶段映射成"产物节点"：每个阶段一个节点，展示关键产物文件名 + 语义标签
// 数据来源：build-spec §1.2 "关键产物" 列 + STAGE_TABLE.spec_globs
// 节点颜色由存在性 + 阶段状态决定（见 ArtifactGraph.tsx 的 nodeColor 逻辑）
// =============================================================================

import type { StageToken } from './types';

// 每个阶段节点的展示元数据
export interface ArtifactNodeMeta {
  /** 阶段 token */
  stage: StageToken;
  /** 产物语义标签（人类可读，短）*/
  label: string;
  /** 该阶段的关键产物文件名（带路径前缀），用于在图节点上展示 */
  displayFile: string;
  /** 是否属于"编码类"阶段（有源码产物，走 pipeline_state）*/
  isCoding: boolean;
}

// key → 阶段（全部 25 个，按 order 排列）
export const ARTIFACT_NODE_META: Record<StageToken, ArtifactNodeMeta> = {
  init: {
    stage: 'init',
    label: '输入资料',
    displayFile: 'inputs/parsed/*.md',
    isCoding: false,
  },
  sys_elicitation: {
    stage: 'sys_elicitation',
    label: 'PRD 需求',
    displayFile: 'specs/prd/prd-*.md',
    isCoding: false,
  },
  sys_analysis: {
    stage: 'sys_analysis',
    label: '系统需求',
    displayFile: 'specs/sys/sys-req-*.md',
    isCoding: false,
  },
  sys_arch: {
    stage: 'sys_arch',
    label: '系统架构',
    displayFile: 'specs/sys/sys-arch-*.md',
    isCoding: false,
  },
  hwe_analysis: {
    stage: 'hwe_analysis',
    label: '硬件需求',
    displayFile: 'specs/hw-*/*.md',
    isCoding: false,
  },
  swe_analysis: {
    stage: 'swe_analysis',
    label: '软件需求',
    displayFile: 'specs/sw-srs/sw-srs-*.md',
    isCoding: false,
  },
  swe_arch: {
    stage: 'swe_arch',
    label: '软件架构',
    displayFile: 'specs/sw-arch/sw-arch-*.md',
    isCoding: false,
  },
  swe_arch_if: {
    stage: 'swe_arch_if',
    label: '软件接口',
    displayFile: 'specs/sw-arch/sw-if/*.md',
    isCoding: false,
  },
  swe_detail: {
    stage: 'swe_detail',
    label: '详细设计',
    displayFile: 'specs/sw-ddd/sw-ddd-*.md',
    isCoding: false,
  },
  swe_coding_plan: {
    stage: 'swe_coding_plan',
    label: '编码计划',
    displayFile: 'tasks/coding-plan/plan-*.md',
    isCoding: true,
  },
  swe_coding_do: {
    stage: 'swe_coding_do',
    label: '编码实现',
    displayFile: 'source/**/*.c',
    isCoding: true,
  },
  swe_static_verify: {
    stage: 'swe_static_verify',
    label: '静态检查',
    displayFile: 'tests/static/*.html',
    isCoding: false,
  },
  swe_coding_verify: {
    stage: 'swe_coding_verify',
    label: '编码验证',
    displayFile: 'tasks/coding-verify/report.md',
    isCoding: true,
  },
  swe_coding_verify_pc: {
    stage: 'swe_coding_verify_pc',
    label: 'PC 验证',
    displayFile: 'tasks/coding-verify-pc/report.md',
    isCoding: true,
  },
  swe_unit_verify: {
    stage: 'swe_unit_verify',
    label: '单元测试',
    displayFile: 'specs/ts-ut-*.md',
    isCoding: false,
  },
  swe_integration_verify: {
    stage: 'swe_integration_verify',
    label: '集成测试',
    displayFile: 'specs/ts-it-*.md',
    isCoding: false,
  },
  sqt_strategy: {
    stage: 'sqt_strategy',
    label: '测试策略',
    displayFile: 'specs/sqt-tp/sqt-tp-*.md',
    isCoding: false,
  },
  sqt_tr: {
    stage: 'sqt_tr',
    label: '测试需求',
    displayFile: 'specs/sqt-tr/sqt-tr-*.md',
    isCoding: false,
  },
  sqt_case_design: {
    stage: 'sqt_case_design',
    label: '测试用例',
    displayFile: 'specs/sqt-tc/sqt-tc-*.md',
    isCoding: false,
  },
  sqt_script_gen: {
    stage: 'sqt_script_gen',
    label: '脚本生成',
    displayFile: 'tests/auto_test/features/*.feature',
    isCoding: false,
  },
  sqt_auto_test: {
    stage: 'sqt_auto_test',
    label: '自动化执行',
    displayFile: 'tests/**/defect-reports/*/report.md',
    isCoding: false,
  },
  sqt_defect_feedback: {
    stage: 'sqt_defect_feedback',
    label: '缺陷反馈',
    displayFile: 'specs/sqt-dr/sqt-dr-*.md',
    isCoding: false,
  },
  comp: {
    stage: 'comp',
    label: '符合性检查',
    displayFile: 'specs/comp-report-*.md',
    isCoding: false,
  },
  traceability: {
    stage: 'traceability',
    label: '追溯矩阵',
    displayFile: 'traceability/traceability-report-*.md',
    isCoding: false,
  },
  swe_sdk_release: {
    stage: 'swe_sdk_release',
    label: 'SDK 发布',
    displayFile: 'SDK BSP tag',
    isCoding: false,
  },
  swe_release: {
    stage: 'swe_release',
    label: '软件发布',
    displayFile: 'CHANGELOG + tag',
    isCoding: false,
  },
  swe_release_promote: {
    stage: 'swe_release_promote',
    label: '发布过渡',
    displayFile: 'release 阶段过渡',
    isCoding: false,
  },
};