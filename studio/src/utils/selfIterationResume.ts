// =============================================================================
// selfIterationResume — 自迭代启动表单「断点恢复」默认勾选纯逻辑
// 数据源 = SelfIterationCard 已拉取的 /api/self-iteration run-state 摘要
//   （SelfIterationState：stage / currentRound / status / converged / maxIter）。
// 目标：表单「断点恢复」（--resume）默认关，但同阶段 run 进行中时续跑几乎是
//   必然意图 —— 若忘了勾选，@yxspec/self-iteration 插件的 openRun 会因
//   `st.stage===stage && opts.resume` 不成立而 emptyState(stage) 重置 run-state：
//   冻结基线丢失（首轮重新锚定）、轮次计数归零，降级护栏与收敛进度一并失效。
//   本函数判定「是否应默认勾选」，只在用户未手动改过时由调用方套用。
// 配套的 defaultRunIteration：续跑时应把轮数预填为该 run 的 maxIter 预算
//   （续跑时 openRun 会用表单 maxIter 覆盖预算，默认 3 会让大预算 run 续跑缩水；
//   预填 + 只读角标让「所见 = 所跑」）。
// 纯前端派生、零新接口；UI 状态/覆盖逻辑由调用方组件负责。
// =============================================================================

import type { SelfIterationState } from './ipc';

/**
 * 断点恢复默认勾选判定：表单阶段 = 当前 run 阶段 且 该 run 仍在进行中
 * （status='running' 且 currentRound>=1）→ 应默认勾选「断点恢复」。
 * 语义对齐插件 openRun（runtime-js/vendor/@yxspec/self-iteration）：
 *   --resume 只在同阶段时续跑（保留 baseline/rounds），否则重置 —— 故
 *   阶段不符的 resume 是 no-op，不应预勾（选了别的阶段 = 跑新 run）。
 * 收敛 / 无轮次（currentRound=0，首轮未完成无断点可续）/ 非 running 态
 * （stopped/dropped 语义歧义，不替用户做主）→ false。
 * @param state run-state 摘要（/api/self-iteration 的 state；无 → null）
 * @param stage 表单当前所选阶段（空 → 不预勾）
 */
export function shouldDefaultResume(
  state: SelfIterationState | null | undefined,
  stage: string | null | undefined,
): boolean {
  if (!state || !stage) return false;
  if (state.stage !== stage) return false; // 阶段不符：resume 对插件是 no-op
  if (state.converged) return false; // 已收敛：新 run 是自然下一步
  if (state.status !== 'running') return false; // 非进行中不替用户做主
  return state.currentRound >= 1; // 无完成轮次 → 无断点可续
}

/**
 * 断点恢复时「轮数」应预填的 run 预算：同阶段 run 进行中（可续跑）→ 返回该 run 的
 * maxIter（run-state.json 的轮数上限）；否则 → null（表单维持默认 3）。
 * 判定与 shouldDefaultResume 严格一致——预填轮数只在「将要续跑」时才有意义：
 * 续跑时 openRun 的 `st.maxIter = opts.maxIter` 会用表单值覆盖 run 预算，
 * 表单默认「3」会让 maxIter=10 的 run 续跑后预算缩水；用户看不到 run 的真实预算，
 * 更糟的是在轮数框里打任意数字都会静默重设预算（所见 ≠ 所跑）。
 * 预算在 [1,10]（网关钳制域）外 / 非运行态 / 阶段不符 / 已收敛 → null（不预填，
 * 新 run 走默认 3；该阶段无关 run 的预算不泄漏到别的阶段）。
 * @param state run-state 摘要（/api/self-iteration 的 state；无 → null）
 * @param stage 表单当前所选阶段（空 → 不预填）
 */
export function defaultRunIteration(
  state: SelfIterationState | null | undefined,
  stage: string | null | undefined,
): number | null {
  if (!shouldDefaultResume(state, stage)) return null;
  const n = state?.maxIter;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1 || n > 10) return null;
  return Math.floor(n);
}
