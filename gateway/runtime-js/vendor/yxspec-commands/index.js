// =============================================================================
// @yxspec/commands — YXSpec 阶段命令注册表（阶段 2）
// =============================================================================
// 架构结论（实测确认，2026-08-25）：
//   1. ctx.commands.register() 在 headless runtime 可用（27 命令注册成功）
//   2. SDK JSON-RPC 通道只支持 initialize/session/prompt/shutdown —— 命令
//      wire（commands/execute）不可达，命令以普通文本进 agent
//   3. 根 ctx 的 ctx.on('session/event') 收不到事件（事件绑定在 session 专属
//      ctx 作用域，root ctx 不广播）
//   4. 因此「runtime 内命令校验」在 SDK 场景无独立增量：命令识别与派活由
//      网关侧 resolveStage 承担（stages.mjs 权威表），已是结构性实现
//
// 本插件保留的确定性价值：把 25 个 /yxspec:* 命令注册进 harness 命令注册表，
// 证明命令元数据（name/description/阶段映射）在 harness 侧可见可查，
// 为未来接入 web UI wire（commands/execute 可达的场景）铺路。
//
// 红线：不动 harness 主仓源码；不读 baselines/_monitor。
// =============================================================================

/** 命令名 → 阶段 token（与网关 stages.mjs 命令表逐字一致）。 */
const COMMANDS = {
  init: 'init',
  'prd-analysis': 'sys_elicitation',
  'sys-analysis': 'sys_analysis',
  'sys-arch': 'sys_arch',
  'hwe-analysis': 'hwe_analysis',
  'swe-analysis': 'swe_analysis',
  'swe-arch-v2': 'swe_arch',
  'swe-arch-if-v2': 'swe_arch_if',
  'swe-detail': 'swe_detail',
  'swe-coding-plan-v2': 'swe_coding_plan',
  'swe-coding-do-v2': 'swe_coding_do',
  'swe-static-verify': 'swe_static_verify',
  'swe-coding-verify-v2': 'swe_coding_verify',
  'swe-coding-verify-pc-v2': 'swe_coding_verify_pc',
  'swe-unit-verify': 'swe_unit_verify',
  'swe-integration-verify': 'swe_integration_verify',
  'sqt-strategy': 'sqt_strategy',
  'sqt-tr-analysis': 'sqt_tr',
  'sqt-case-design': 'sqt_case_design',
  'sqt-script-gen': 'sqt_script_gen',
  'sqt-auto-test': 'sqt_auto_test',
  'sqt-defect-feedback': 'sqt_defect_feedback',
  comp: 'comp',
  traceability: 'traceability',
  'swe-sdk-release': 'swe_sdk_release',
  'swe-release': 'swe_release',
  'swe-release-promote': 'swe_release_promote',
};

/** 命令名 → 描述。 */
const DESCRIPTIONS = {
  init: '初始化项目（ACQ.4，SOR 引入）',
  'prd-analysis': 'PRD 需求分析',
  'sys-analysis': '系统需求分析',
  'sys-arch': '系统架构设计',
  'hwe-analysis': '硬件需求分析（合成命令）',
  'swe-analysis': '软件需求分析',
  'swe-arch-v2': '软件架构设计',
  'swe-arch-if-v2': '软件架构接口设计',
  'swe-detail': '软件详细设计（已废弃）',
  'swe-coding-plan-v2': '编码计划',
  'swe-coding-do-v2': '编码执行',
  'swe-static-verify': '静态验证',
  'swe-coding-verify-v2': '编码验证',
  'swe-coding-verify-pc-v2': '编码验证 PC（变体）',
  'swe-unit-verify': '单元验证',
  'swe-integration-verify': '集成验证',
  'sqt-strategy': '系统测试策略',
  'sqt-tr-analysis': '测试需求分析',
  'sqt-case-design': '测试用例设计',
  'sqt-script-gen': '测试脚本生成',
  'sqt-auto-test': '自动化测试执行',
  'sqt-defect-feedback': '缺陷反馈',
  comp: '完整性检查（合成命令）',
  traceability: '追溯性分析（合成命令）',
  'swe-sdk-release': 'SDK 发布',
  'swe-release': '软件发布',
  'swe-release-promote': '发布晋升',
};

export const name = 'yxspec-commands';

/** 声明对 commands 服务的依赖（cordis 注入检查）。 */
export const inject = ['commands'];

export function apply(ctx, input = {}) {
  const registered = [];
  for (const [cmd, token] of Object.entries(COMMANDS)) {
    const dispose = ctx.commands.register({
      name: cmd,
      description: `YXSpec 阶段命令: ${DESCRIPTIONS[cmd]}（token=${token}）`,
      handler: () => ({ kind: 'success', text: `已接收 YXSpec 阶段命令 /yxspec:${cmd}` }),
    });
    if (dispose) registered.push(dispose);
  }

  ctx.logger?.info?.(`[yxspec-commands] apply: 注册 ${registered.length}/${Object.keys(COMMANDS).length} 个阶段命令`);

  ctx.effect(() => {
    ctx.logger?.info?.('[yxspec-commands] 卸载');
    for (const d of registered) { try { d?.(); } catch {} }
  });
}
