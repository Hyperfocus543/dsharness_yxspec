// =============================================================================
// @yxspec/tool-guard — YXSpec 工具守卫 + 门控结构性化（阶段 3）
// =============================================================================
// 目标：把「coding 阶段只许 fs/bash」+「跳级派活禁止」从 prompt 软约束
//       → 结构性硬约束。
//
// 两个硬约束：
//   1. 工具裁剪：coding 类阶段（restrictTools）只允许 fs/bash/read + 状态工具，
//      白名单外工具调用直接 deny（模型拿到失败反馈，自主改用白名单工具）。
//   2. 门控检查：当前阶段的上游阶段未完成（dsh_state 里非 done）→ 结构性
//      拒绝该阶段全部工具调用（禁行），模型被迫停下，无法跳过上游。
//
// 当前阶段来源（实时解析，guard 回调每次调用时读取）：
//   1. 环境变量 YXSPEC_STAGE（测试/显式指定，网关可经 launch.env 注入）
//   2. dsh_state.current（动态，真实全流程每轮阶段自动变化，主推）
//   3. 插件 config stage 字段（cordis.yml，静态兜底）
//   都无 → 守卫空转（不影响非受限流程）。
//
// 红线：不动 harness 主仓源码；只读 dsh_state（门控判定）；不写 baselines/_monitor。
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';

/** 阶段 → 白名单工具（restrictTools 阶段，与网关 stages.mjs 一致）。 */
const STAGE_ALLOWED = {
  swe_coding_do: ['fs', 'bash', 'read'],
  swe_static_verify: ['fs', 'bash', 'read'],
  swe_coding_verify: ['fs', 'bash', 'read'],
  swe_coding_verify_pc: ['fs', 'bash', 'read'],
  sqt_auto_test: ['fs', 'bash', 'read'],
};

/** 通用允许工具（goal/todo 状态更新必须放行，否则阶段执行卡死）。 */
const ALWAYS_ALLOWED = ['create_goal', 'update_goal', 'get_goal', 'todo_write', 'todo_read', 'skill'];

/** 阶段 → 上游阶段（与网关 stages.mjs upstream 一致，门控判定用）。 */
const STAGE_UPSTREAM = {
  sys_elicitation: ['init'],
  sys_analysis: ['sys_elicitation'],
  sys_arch: ['sys_analysis'],
  hwe_analysis: ['sys_arch'],
  swe_analysis: ['sys_arch'],
  swe_arch: ['swe_analysis'],
  swe_arch_if: ['swe_arch'],
  swe_coding_plan: ['swe_arch_if'],
  swe_coding_do: ['swe_coding_plan'],
  swe_static_verify: ['swe_coding_do'],
  swe_coding_verify: ['swe_static_verify'],
  swe_unit_verify: ['swe_coding_verify'],
  swe_integration_verify: ['swe_unit_verify'],
  sqt_strategy: ['swe_integration_verify'],
  sqt_tr: ['sqt_strategy'],
  sqt_case_design: ['sqt_tr'],
  sqt_script_gen: ['sqt_case_design'],
  sqt_auto_test: ['sqt_script_gen'],
  sqt_defect_feedback: ['sqt_auto_test'],
  comp: ['sqt_defect_feedback'],
  traceability: ['comp'],
  swe_sdk_release: ['traceability'],
  swe_release: ['swe_sdk_release'],
  swe_release_promote: ['swe_release'],
};

export const name = 'yxspec-tool-guard';

/** 声明对 tools 服务的依赖（cordis 注入检查）。 */
export const inject = ['tools'];

/** dsh_state.json 路径（与网关 state.mjs 同源，env 优先）。 */
function statePath() {
  const ws = process.env.YXSPEC_PROJECT_ROOT || process.env.YXSPEC_WORKSPACE_CWD || 'D:/Work/01_Projects/Aima_X1_BCM';
  return `${ws.replace(/[\\/]+$/, '')}/.dsh/dsh_state.json`;
}

/** 读 dsh_state 里各阶段状态（only done 视为满足门控）。 */
function readStageStates() {
  try {
    const p = statePath();
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return raw?.stages ?? raw ?? null;
  } catch {
    return null;
  }
}

/** 读 dsh_state.current（当前进行中的阶段，动态阶段来源）。 */
function readCurrentStage() {
  try {
    const p = statePath();
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    const cur = raw?.current;
    return typeof cur === 'string' && cur.length > 0 ? cur : null;
  } catch {
    return null;
  }
}

export function apply(ctx, input = {}) {
  ctx.logger?.info?.('[yxspec-tool-guard] apply: 动态阶段守卫激活');

  // 注册结构性守卫：返回字符串 = 拒绝执行；返回 undefined = 放行
  // 阶段每次调用实时解析（优先级）：
  //   1. env YXSPEC_STAGE（测试/显式指定，网关可注入）
  //   2. dsh_state.current（动态，真实全流程每轮阶段自动变化）
  //   3. config stage（静态兜底）
  // 这样 runtime 进程复用（单例 harness）也能按当前阶段正确裁剪。
  const dispose = ctx.tools.guard((exec) => {
    const name = exec?.name;
    if (!name) return undefined;
    // 状态更新工具永远放行
    if (ALWAYS_ALLOWED.includes(name)) return undefined;

    // 阶段实时解析
    const stage = process.env.YXSPEC_STAGE || readCurrentStage() || input.stage || null;
    if (!stage) return undefined;

    const allowed = STAGE_ALLOWED[stage] ?? null;
    const upstream = STAGE_UPSTREAM[stage] ?? null;
    const gated = !!upstream;

    // 门控检查：上游未完成 → 禁行该阶段全部工具
    if (gated) {
      const states = readStageStates();
      if (states) {
        const unmet = upstream.filter((u) => states[u]?.state !== 'done');
        if (unmet.length > 0) {
          return `[yxspec-tool-guard] 阶段 ${stage} 被门控拦截：上游 ${unmet.join(',')} 未完成（dsh_state 非 done）。请先完成上游阶段，禁止跳级执行`;
        }
      }
    }

    // 工具裁剪：restrictTools 阶段白名单外 deny
    if (allowed && !allowed.includes(name)) {
      return `[yxspec-tool-guard] 阶段 ${stage} 仅允许 ${allowed.join('/')}，工具 ${name} 被结构性拦截`;
    }
    return undefined;
  });

  // 插件卸载时注销守卫
  ctx.effect(() => {
    ctx.logger?.info?.('[yxspec-tool-guard] 卸载');
    return dispose;
  });
}
