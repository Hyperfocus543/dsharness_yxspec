// @vitest-environment node
// =============================================================================
// selfIterationSummary.ts 纯逻辑单测（自迭代 run 汇总徽标行聚合）
// 只测无 DOM 的导出函数：单阶段汇总 / 收敛·退化计数 / 徽标文案。
// 不渲染组件（vitest 默认 node 环境，无 jsdom）。
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  summarizeStage,
  summarizeStages,
  convergedCount,
  runningCount,
  degradedCount,
  bestBadgeLabel,
  worstBadgeLabel,
} from './selfIterationSummary';
import type { SelfIterationOverview, SelfIterationRound, SelfIterationStage } from './ipc';

/** 单轮留痕（type=round 判定轮；total 可显式覆盖）。 */
function round(partial: Partial<SelfIterationRound> & { round: number }): SelfIterationRound {
  return {
    type: 'round',
    total: null,
    master: null,
    stageScore: null,
    level: null,
    weak: [],
    gateOk: false,
    verdict: null,
    baselineTotal: null,
    status: null,
    reason: null,
    at: '2026-08-29T00:00:00.000Z',
    ...partial,
  };
}

function stage(partial: Partial<SelfIterationStage> & { token: string }): SelfIterationStage {
  return {
    label: partial.token,
    aspice: '',
    command: '',
    rounds: [],
    latest: null,
    converged: false,
    ...partial,
  };
}

describe('summarizeStage（单阶段汇总）', () => {
  it('best = 最高总分轮；worst = 最低总分轮', () => {
    const s = stage({
      token: 'swe_coding_do',
      rounds: [
        round({ round: 1, total: 72 }),
        round({ round: 2, total: 85 }),
        round({ round: 3, total: 78 }),
      ],
    });
    const r = summarizeStage(s);
    expect(r.best?.round).toBe(2);
    expect(r.best?.total).toBe(85);
    expect(r.worst?.round).toBe(1);
    expect(r.worst?.total).toBe(72);
    expect(r.converged).toBe(false);
    expect(r.degraded).toBe(false);
  });

  it('converged 透传网关口径（latest verdict converge）', () => {
    const s = stage({
      token: 'sqt_strategy',
      rounds: [round({ round: 1, total: 90 })],
      converged: true,
    });
    expect(summarizeStage(s).converged).toBe(true);
  });

  it('degraded = 任一有分轮被判 degrade', () => {
    const s = stage({
      token: 'swe_arch',
      rounds: [
        round({ round: 1, total: 88, verdict: 'continue' }),
        round({ round: 2, total: 82, verdict: 'degrade' }),
      ],
    });
    expect(summarizeStage(s).degraded).toBe(true);
    expect(summarizeStage(s).converged).toBe(false);
  });

  it('无有分轮 → best/worst 均 null（徽标不渲染）', () => {
    const s = stage({
      token: 'swe_arch_if',
      rounds: [round({ round: 1, total: null })], // 无分轮（score tool 降级）
    });
    const r = summarizeStage(s);
    expect(r.best).toBeNull();
    expect(r.worst).toBeNull();
    expect(r.degraded).toBe(false);
  });

  it('并列总分 → 取较新轮（round 大者）', () => {
    const s = stage({
      token: 'swe_coding_verify',
      rounds: [
        round({ round: 1, total: 80 }),
        round({ round: 3, total: 80 }),
      ],
    });
    const r = summarizeStage(s);
    expect(r.best?.round).toBe(3);
    expect(r.worst?.round).toBe(3); // 并列时 best/worst 均取较新轮（同分最新体现）
  });
});

describe('summarizeStages / 计数（跨阶段横截面）', () => {
  it('汇总全部阶段；空 stages → 空数组', () => {
    expect(summarizeStages(null)).toEqual([]);
    expect(summarizeStages({ ok: true, state: null, stages: [] })).toEqual([]);
  });

  it('收敛 / 退化 / 进行中计数', () => {
    const data: SelfIterationOverview = {
      ok: true,
      state: null,
      stages: [
        stage({ token: 'sys_analysis', rounds: [round({ round: 1, total: 92 })], converged: true }),
        stage({ token: 'swe_arch', rounds: [round({ round: 1, total: 70, verdict: 'degrade' })] }),
        stage({ token: 'swe_coding_do', rounds: [round({ round: 1, total: 80, verdict: 'continue' })] }),
      ],
    };
    const sums = summarizeStages(data);
    expect(sums.length).toBe(3);
    expect(convergedCount(sums)).toBe(1);
    expect(degradedCount(sums)).toBe(1);
    expect(runningCount(sums)).toBe(1); // 未收敛且未退化
  });
});

describe('徽标文案', () => {
  it('best/worst 徽标 = R<n> <总分>', () => {
    const r = summarizeStage(
      stage({ token: 'sqt_case_design', rounds: [round({ round: 2, total: 84.5 })] }),
    );
    expect(bestBadgeLabel(r)).toBe('R2 84.5');
    expect(worstBadgeLabel(r)).toBe('R2 84.5');
  });

  it('无分轮 → 空串（徽标不渲染）', () => {
    const r = summarizeStage(stage({ token: 'swe_release', rounds: [round({ round: 1, total: null })] }));
    expect(bestBadgeLabel(r)).toBe('');
    expect(worstBadgeLabel(r)).toBe('');
  });
});
