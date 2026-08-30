import { describe, expect, it } from 'vitest';
import { shouldDefaultResume } from './selfIterationResume';
import type { SelfIterationState } from './ipc';

/** run-state 摘要构造器（非收敛、running、有完成轮次 = 可续跑的最小形态）。 */
function state(over: Partial<SelfIterationState> = {}): SelfIterationState {
  return {
    stage: 'sqt_script_gen',
    currentRound: 2,
    maxIter: 3,
    goal: 'Total>=80',
    status: 'running',
    converged: false,
    baselineTotal: 70,
    bestTotal: 85,
    lastScore: null,
    updatedAt: '2026-08-30T08:00:00.000Z',
    ...over,
  };
}

describe('shouldDefaultResume', () => {
  it('同阶段 + running + 有完成轮次 → 默认勾选（续跑保留基线/轮次计数）', () => {
    expect(shouldDefaultResume(state(), 'sqt_script_gen')).toBe(true);
  });

  it('无 run-state / 阶段为空 → 不勾', () => {
    expect(shouldDefaultResume(null, 'sqt_script_gen')).toBe(false);
    expect(shouldDefaultResume(undefined, undefined)).toBe(false);
    expect(shouldDefaultResume(state(), '')).toBe(false);
  });

  it('表单阶段 ≠ 当前 run 阶段 → 不勾（resume 对插件是 no-op，换阶段=新 run）', () => {
    expect(shouldDefaultResume(state(), 'swe_arch')).toBe(false);
    expect(shouldDefaultResume(state(), null)).toBe(false);
  });

  it('已收敛 → 不勾（新 run 是自然下一步，无需续跑）', () => {
    expect(
      shouldDefaultResume(state({ converged: true, status: 'converged' }), 'sqt_script_gen'),
    ).toBe(false);
  });

  it('非 running 态（dropped/stopped）→ 不替用户做主', () => {
    expect(shouldDefaultResume(state({ status: 'dropped' }), 'sqt_script_gen')).toBe(false);
    expect(shouldDefaultResume(state({ status: 'stopped' }), 'sqt_script_gen')).toBe(false);
  });

  it('无完成轮次（currentRound=0）→ 无断点可续，不勾', () => {
    expect(shouldDefaultResume(state({ currentRound: 0 }), 'sqt_script_gen')).toBe(false);
  });
});
