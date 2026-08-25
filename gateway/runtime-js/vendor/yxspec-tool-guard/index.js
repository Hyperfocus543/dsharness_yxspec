// =============================================================================
// @yxspec/tool-guard — YXSpec 工具守卫（POC）
// =============================================================================
// 目标：把「coding 阶段只许 fs/bash」从 prompt 软约束 → 结构性硬约束。
//
// 机制：注册 tools.guard()，按「当前阶段」拒绝白名单外的工具调用。
//   当前阶段来源：插件配置 stage 字段（网关派活时经环境变量 / 配置注入）。
//   POC 阶段不做 goal 解析，直接用配置的 stage 判定 —— 验证 guard API 在
//   headless runtime 下是否真生效（turn 事件可见 denied），机制跑通后再接
//   阶段自动解析。
//
// 红线：不动 harness 主仓源码；只读执行上下文；不写任何文件。
// =============================================================================

/** 阶段 → 白名单工具（POC 只测 coding 阶段）。 */
const STAGE_ALLOWED = {
  swe_coding_do: ['fs', 'bash', 'read'],
  swe_static_verify: ['fs', 'bash', 'read'],
  swe_coding_verify: ['fs', 'bash', 'read'],
  swe_coding_verify_pc: ['fs', 'bash', 'read'],
  sqt_auto_test: ['fs', 'bash', 'read'],
};

/** 通用允许工具（goal/todo 状态更新必须放行，否则阶段执行卡死）。 */
const ALWAYS_ALLOWED = ['create_goal', 'update_goal', 'get_goal', 'todo_write', 'todo_read', 'skill'];

export const name = 'yxspec-tool-guard';

/** 声明对 tools 服务的依赖（cordis 注入检查：未声明访问 ctx.tools 会拒绝加载）。 */
export const inject = ['tools'];

export function apply(ctx, input = {}) {
  const stage = input.stage;
  ctx.logger?.info?.(`[yxspec-tool-guard] apply stage=${stage ?? '(none)'}`);

  if (!stage || !STAGE_ALLOWED[stage]) {
    // POC：未配置阶段或非受限阶段 → 不拦
    ctx.logger?.info?.(`[yxspec-tool-guard] 阶段 ${stage ?? 'none'} 无白名单，守卫空转`);
    return;
  }

  const allowed = STAGE_ALLOWED[stage];
  ctx.logger?.info?.(`[yxspec-tool-guard] 阶段 ${stage} 白名单: ${allowed.join(', ')}`);

  // 注册结构性守卫：返回字符串 = 拒绝执行；返回 undefined = 放行
  const dispose = ctx.tools.guard((exec) => {
    const name = exec?.name;
    if (!name) return undefined;
    // 状态更新工具永远放行
    if (ALWAYS_ALLOWED.includes(name)) return undefined;
    if (allowed.includes(name)) return undefined;
    return `[yxspec-tool-guard] 阶段 ${stage} 仅允许 ${allowed.join('/')}，工具 ${name} 被结构性拦截`;
  });

  // 插件卸载时注销守卫
  ctx.effect(() => {
    ctx.logger?.info?.('[yxspec-tool-guard] 卸载');
    return dispose;
  });
}
