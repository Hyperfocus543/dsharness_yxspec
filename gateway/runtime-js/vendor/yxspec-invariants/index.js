// =============================================================================
// @yxspec/invariants — YXSpec 跨事件不变量（方向 C POC · 已探明结论）
// =============================================================================
// 探明结论（2026-08-26，headless runtime 实证）：
//   1. ctx.invariants.register() 在 SDK 场景可达（服务挂载 + register + installer
//      专用 fiber + 事件监听全程生效，探针证明 installer 被调用、检查逻辑执行）。
//   2. fail() 抛 InvariantError 的语义：异常在 installer 的 child fiber 抛出，
//      **被吞掉，不传导到 session turn**——模型照常完成，产物照常落盘。
//      invariants 是「诊断/自证」机制（防止不变量包自身出 bug 悄悄通过），
//      **不是**「结构性拒绝模型」的执行层门控（那是 guard 的职责）。
//   3. 因此方向 C 的正确定位：invariants 做「装配/配置完整性校验」的强语义
//      （启动检查违反 → 不变量包被注销，日志可见），不替代 guard 做流程门控。
//
// 保留价值：与 guard 互补——guard 拦「违规调用」，invariants 校验「配置自洽」。
// 红线：不动 harness 主仓源码；不读 baselines/_monitor。
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';

export const name = 'yxspec-invariants';

/** 声明对 invariants 服务的依赖（cordis 注入检查）。 */
export const inject = ['invariants'];

/** dsh_state.json 路径（与 guard 同源）。 */
function statePath() {
  const ws = process.env.YXSPEC_PROJECT_ROOT || process.env.YXSPEC_WORKSPACE_CWD || 'D:/Work/01_Projects/Aima_X1_BCM';
  return `${ws.replace(/[\\/]+$/, '')}/.dsh/dsh_state.json`;
}

/** 读 dsh_state.current。 */
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

/** 阶段 → 上游（与 guard 的 STAGE_UPSTREAM 对齐，示例）。 */
const STAGE_UPSTREAM = {
  swe_coding_do: ['swe_coding_plan'],
};

const PACKAGE_NAME = '@yxspec/invariants';

export function apply(ctx) {
  ctx.logger?.info?.('[yxspec-invariants] apply: 注册不变量');

  // installer：启动检查型不变量。读 dsh_state，若当前阶段上游未 done → fail。
  // 探明：fail 抛 InvariantError 不传导到 turn（诊断语义），故这里只做日志化校验。
  const install = Object.assign((childCtx, fail) => {
    const stage = process.env.YXSPEC_STAGE || readCurrentStage() || null;
    if (!stage) return () => {};
    const upstream = STAGE_UPSTREAM[stage];
    if (!upstream) return () => {};

    try {
      const raw = JSON.parse(readFileSync(statePath(), 'utf8'));
      const states = raw?.stages ?? {};
      const unmet = upstream.filter((u) => states[u]?.state !== 'done');
      if (unmet.length > 0) {
        childCtx.logger?.warn?.(`[yxspec-invariants] 不变量违反（诊断）：阶段 ${stage} 上游 ${unmet.join(',')} 未完成`);
        fail(`[yxspec-invariants] 不变量违反：阶段 ${stage} 上游 ${unmet.join(',')} 未完成`);
      } else {
        childCtx.logger?.info?.(`[yxspec-invariants] 启动检查通过：${stage} 上游全 done`);
      }
    } catch (e) {
      childCtx.logger?.warn?.(`[yxspec-invariants] 启动检查 state 不可读: ${e?.message}`);
    }
    return () => {};
  }, { inject: [] });

  const dispose = ctx.invariants.register(PACKAGE_NAME, install);

  ctx.effect(() => {
    ctx.logger?.info?.('[yxspec-invariants] 卸载');
    try { dispose?.(); } catch {}
  });
}
