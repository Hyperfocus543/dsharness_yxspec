import { describe, expect, it } from 'vitest';
import { shouldDefaultResume, defaultRunIteration, defaultRunGoal, defaultRunMode } from './selfIterationResume';
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

describe('defaultRunIteration（续跑轮数预算预填）', () => {
  it('同阶段可续跑 → 返回该 run 的 maxIter 预算', () => {
    expect(defaultRunIteration(state({ maxIter: 10 }), 'sqt_script_gen')).toBe(10);
  });

  it('预算 = 默认 3 → 也返回 3（显式预填，角标标注「续跑预算」）', () => {
    expect(defaultRunIteration(state({ maxIter: 3 }), 'sqt_script_gen')).toBe(3);
  });

  it('判定为不续跑（阶段不符 / 已收敛 / 非 running / 无轮次）→ null', () => {
    expect(defaultRunIteration(state({ maxIter: 10 }), 'swe_arch')).toBe(null);
    expect(defaultRunIteration(state({ maxIter: 10, converged: true, status: 'converged' }), 'sqt_script_gen')).toBe(null);
    expect(defaultRunIteration(state({ maxIter: 10, status: 'stopped' }), 'sqt_script_gen')).toBe(null);
    expect(defaultRunIteration(state({ maxIter: 10, currentRound: 0 }), 'sqt_script_gen')).toBe(null);
  });

  it('maxIter 越界/非法（网关钳制域 [1,10] 外）→ null（不预填）', () => {
    expect(defaultRunIteration(state({ maxIter: 0 }), 'sqt_script_gen')).toBe(null);
    expect(defaultRunIteration(state({ maxIter: 99 }), 'sqt_script_gen')).toBe(null);
    expect(defaultRunIteration(state({ maxIter: NaN }), 'sqt_script_gen')).toBe(null);
    expect(defaultRunIteration(state({ maxIter: 2.5 }), 'sqt_script_gen')).toBe(2);
  });

  it('state 为 null / 无 run / stage 为空 → null', () => {
    expect(defaultRunIteration(null, 'sqt_script_gen')).toBe(null);
    expect(defaultRunIteration(undefined, 'sqt_script_gen')).toBe(null);
    expect(defaultRunIteration(state({ maxIter: 10 }), '')).toBe(null);
    expect(defaultRunIteration(state({ maxIter: 10 }), null)).toBe(null);
  });
});

describe('defaultRunGoal（续跑收敛目标预填）', () => {
  it('同阶段可续跑 → 返回该 run 的 goal（trim 归一）', () => {
    expect(defaultRunGoal(state({ goal: 'Total>=80 且门禁全绿' }), 'sqt_script_gen')).toBe(
      'Total>=80 且门禁全绿',
    );
    expect(defaultRunGoal(state({ goal: '  Total>=85  ' }), 'sqt_script_gen')).toBe('Total>=85');
  });

  it('goal 为空串 / 全空白 → null（无内容可预填，不误标「续跑目标」）', () => {
    expect(defaultRunGoal(state({ goal: '' }), 'sqt_script_gen')).toBe(null);
    expect(defaultRunGoal(state({ goal: '   ' }), 'sqt_script_gen')).toBe(null);
  });

  it('判定为不续跑（阶段不符 / 已收敛 / 非 running / 无轮次）→ null', () => {
    expect(defaultRunGoal(state({ goal: 'Total>=80' }), 'swe_arch')).toBe(null);
    expect(defaultRunGoal(state({ goal: 'Total>=80', converged: true, status: 'converged' }), 'sqt_script_gen')).toBe(null);
    expect(defaultRunGoal(state({ goal: 'Total>=80', status: 'stopped' }), 'sqt_script_gen')).toBe(null);
    expect(defaultRunGoal(state({ goal: 'Total>=80', currentRound: 0 }), 'sqt_script_gen')).toBe(null);
  });

  it('state 为 null / stage 为空 → null', () => {
    expect(defaultRunGoal(null, 'sqt_script_gen')).toBe(null);
    expect(defaultRunGoal(undefined, 'sqt_script_gen')).toBe(null);
    expect(defaultRunGoal(state({ goal: 'Total>=80' }), '')).toBe(null);
    expect(defaultRunGoal(state({ goal: 'Total>=80' }), null)).toBe(null);
  });

  it('goal 非字符串（run-state 缺字段）→ null', () => {
    expect(defaultRunGoal(state({ goal: '' }), 'sqt_script_gen')).toBe(null);
  });
});

describe('defaultRunMode（续跑评估模式预填）', () => {
  it('同阶段可续跑 + run-state mode=framework → 返回 framework（续跑延续评分口径）', () => {
    expect(defaultRunMode(state({ mode: 'framework' }), 'sqt_script_gen')).toBe('framework');
  });

  it('可续跑但 run-state 为 product / 无 mode 字段（老 run-state）→ null（维持默认 product，不误标）', () => {
    expect(defaultRunMode(state({ mode: 'product' }), 'sqt_script_gen')).toBe(null);
    expect(defaultRunMode(state({ mode: null }), 'sqt_script_gen')).toBe(null);
    expect(defaultRunMode(state(), 'sqt_script_gen')).toBe(null);
  });

  it('判定为不续跑（阶段不符 / 已收敛 / 非 running / 无轮次）→ null', () => {
    expect(defaultRunMode(state({ mode: 'framework' }), 'swe_arch')).toBe(null);
    expect(defaultRunMode(state({ mode: 'framework', converged: true, status: 'converged' }), 'sqt_script_gen')).toBe(null);
    expect(defaultRunMode(state({ mode: 'framework', status: 'stopped' }), 'sqt_script_gen')).toBe(null);
    expect(defaultRunMode(state({ mode: 'framework', currentRound: 0 }), 'sqt_script_gen')).toBe(null);
  });

  it('state 为 null / stage 为空 → null', () => {
    expect(defaultRunMode(null, 'sqt_script_gen')).toBe(null);
    expect(defaultRunMode(undefined, 'sqt_script_gen')).toBe(null);
    expect(defaultRunMode(state({ mode: 'framework' }), '')).toBe(null);
    expect(defaultRunMode(state({ mode: 'framework' }), null)).toBe(null);
  });
});
