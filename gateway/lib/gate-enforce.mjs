// =============================================================================
// gate-enforce.mjs — 派活前门控强制执行（Phase 2：门控接入）
// =============================================================================
// 职责：派活（调 harness 跑 turn）之前，对 gate_policy==='artifact+trajectory'
//       的阶段调用 gateStage() 检查轨迹证据，按门控三态决定拦截或放行：
//         通过（verified）               → 放行，正常派活
//         打回（blocked / 无轨迹）        → 拒绝派活，返回明确 reason，不启动 turn
//         警告（unverified）             → 默认放行但响应带 warning 字段
//
// 决策表（reason 为准；gateStage 的 passed 字段是门控展示语义，派活拦截
// 语义比它更严——artifact-passed-no-trajectory 在展示层 passed=true，但
// 派活要求"有轨迹证据才开新 turn"，故仍打回）：
//   trajectory-blocked               → 打回（轨迹失败/中断，走回滚协议）
//   no-trajectory                    → 打回（从未执行过，无证据）
//   artifact-passed-no-trajectory    → 打回（产物在但无轨迹证据，不盲跑）
//   trajectory-unverified            → 警告（轨迹缺关键证据，默认放行）
//   其它（verified / artifact-missing / artifact 策略 / unknown-stage）→ 放行
//
// 强制开关（默认开，关闭兜底）：
//   YXSPEC_GATE_ENFORCE=0|false|off|no → 完全关闭强制（轨迹证据仅提示）
//
// 纯函数无副作用（不做状态回写/广播），单测直接断言，不依赖网关进程。
// =============================================================================
import { gateStage } from './trajectory.mjs'

/** 门控强制是否开启（env YXSPEC_GATE_ENFORCE，默认开；'0'/'false'/'off'/'no' 关闭）。 */
export function gateEnforceEnabled() {
  const v = String(process.env.YXSPEC_GATE_ENFORCE ?? '').trim().toLowerCase()
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no')
}

/** 门控三态 → 拦截动作（不依赖 env 的纯判定，单测友好）。 */
export function gateAction(g) {
  if (!g || g.reason === 'unknown-stage') return { block: false, warn: false, reason: g?.reason ?? 'no-gate' }
  switch (g.reason) {
    case 'trajectory-blocked':
    case 'no-trajectory':
    case 'artifact-passed-no-trajectory':
      return { block: true, warn: false, reason: g.reason }
    case 'trajectory-unverified':
      return { block: false, warn: true, reason: g.reason }
    default:
      return { block: false, warn: false, reason: g.reason }
  }
}

/**
 * 派活前门控判定（供 server.mjs dispatchAgent 调用）：
 *   gate_policy !== 'artifact+trajectory' → 不适用（门控关闭时同）
 *   否则 gateStage() + gateAction()，并受 YXSPEC_GATE_ENFORCE 开关约束。
 * @returns {object} { enforce, applies, gate, action, blocked, reason, warning }
 *   blocked=true → 派活必须被拒绝（reason: trajectory-blocked / no-trajectory /
 *                  artifact-passed-no-trajectory）
 *   warning=true → 可放行但响应需带 warning 字段
 */
export function checkDispatchGate(stageToken) {
  if (!gateEnforceEnabled()) {
    return { enforce: false, applies: false, gate: null, action: null, blocked: false, reason: null, warning: null }
  }
  const gate = gateStage(stageToken)
  if (!gate || gate.gate_policy !== 'artifact+trajectory') {
    return { enforce: true, applies: false, gate: gate ?? null, action: null, blocked: false, reason: null, warning: null }
  }
  const action = gateAction(gate)
  return {
    enforce: true,
    applies: true,
    gate,
    action,
    blocked: action.block,
    reason: action.reason,
    warning: action.warn ? `门控警告（unverified）：${action.reason}，已放行` : null,
  }
}
