// @vitest-environment node
// =============================================================================
// stageIterBadge.ts 纯逻辑单测（驾驶舱阶段卡 × 自迭代徽标派生）
// 只测无 DOM 的导出函数：单阶段徽标数据 / 全量索引。不渲染组件。
// =============================================================================

import { describe, it, expect } from 'vitest';
import { stageIterBadge, stageIterBadges } from './stageIterBadge';
import type { SelfIterationOverview, SelfIterationRound, SelfIterationStage } from './ipc';

function round(partial: Partial<SelfIterationRound>): SelfIterationRound {
  return {
    type: 'round',
    round: 1,
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
    at: null,
    ...partial,
  };
}

function stage(partial: Partial<SelfIterationStage>): SelfIterationStage {
  return {
    token: 'sys_elicitation',
    label: 'SYS 需求获取',
    aspice: 'SYS.1',
    command: '/yxspec:prd-analysis',
    rounds: [],
    latest: null,
    converged: false,
    ...partial,
  };
}

function overview(stages: SelfIterationStage[]): SelfIterationOverview {
  return { ok: true, state: null, stages };
}

describe('stageIterBadge（单阶段自迭代徽标派生）', () => {
  it('未跑过该阶段（stages 无此 token）→ null（卡片不渲染）', () => {
    expect(stageIterBadge(overview([]), 'sys_elicitation')).toBeNull();
  });

  it('该阶段无轮次留痕 → null', () => {
    const ov = overview([stage({ token: 'sys_elicitation', rounds: [], latest: null })]);
    expect(stageIterBadge(ov, 'sys_elicitation')).toBeNull();
  });

  it('有分轮次才给徽标；total = 有分轮 max（best 口径）', () => {
    const rounds = [
      round({ type: 'score', round: 1, total: 61, verdict: 'continue' }),
      round({ type: 'round', round: 1, total: 61, verdict: 'continue', reason: '继续打磨' }),
      round({ type: 'score', round: 2, total: 68, verdict: 'continue' }),
      round({ type: 'round', round: 2, total: 68, verdict: 'converge', reason: '达到目标' }),
    ];
    const s = stage({ token: 'swe_arch', rounds, latest: rounds[rounds.length - 1] });
    const b = stageIterBadge(overview([s]), 'swe_arch');
    expect(b).not.toBeNull();
    expect(b!.total).toBe(68);
    expect(b!.rounds).toBe(2);
  });

  it('无总分轮（total 全 null）→ null（不渲染无分徽标）', () => {
    const rounds = [
      round({ type: 'score', round: 1, total: null }),
      round({ type: 'round', round: 1, total: null, verdict: 'continue' }),
    ];
    const s = stage({ token: 'sys_elicitation', rounds, latest: rounds[rounds.length - 1] });
    expect(stageIterBadge(overview([s]), 'sys_elicitation')).toBeNull();
  });

  it('判定色：latest converge → converged（绿）', () => {
    const rounds = [
      round({ type: 'score', round: 1, total: 75 }),
      round({ type: 'round', round: 1, total: 75, verdict: 'converge_by_maxiter', reason: '用满轮次' }),
    ];
    const s = stage({ token: 'sqt_strategy', rounds, latest: rounds[rounds.length - 1] });
    expect(stageIterBadge(overview([s]), 'sqt_strategy')!.tone).toBe('converged');
  });

  it('判定色：latest degrade → degraded（红）', () => {
    const rounds = [
      round({ type: 'score', round: 1, total: 80 }),
      round({ type: 'round', round: 1, total: 80, verdict: 'degrade', reason: '低于基线回滚' }),
    ];
    const s = stage({ token: 'swe_coding_do', rounds, latest: rounds[rounds.length - 1] });
    expect(stageIterBadge(overview([s]), 'swe_coding_do')!.tone).toBe('degraded');
  });

  it('判定色：latest continue / 无 verdict → running（琥珀）', () => {
    const rounds = [
      round({ type: 'score', round: 1, total: 55 }),
      round({ type: 'round', round: 1, total: 55, verdict: 'continue' }),
    ];
    const s = stage({ token: 'sys_analysis', rounds, latest: rounds[rounds.length - 1] });
    expect(stageIterBadge(overview([s]), 'sys_analysis')!.tone).toBe('running');
    // 无 verdict（latest null）也归 running（有分但无判定 → 仍在迭代）
    const noVerdict = stage({ token: 'sys_analysis', rounds: [round({ type: 'score', round: 1, total: 55 })] });
    expect(stageIterBadge(overview([noVerdict]), 'sys_analysis')!.tone).toBe('running');
  });

  it('null overview → null（网关未起静默降级）', () => {
    expect(stageIterBadge(null, 'sys_elicitation')).toBeNull();
    expect(stageIterBadge(undefined, 'sys_elicitation')).toBeNull();
  });
});

describe('stageIterBadges（全量索引）', () => {
  it('只索引有分轮次的阶段（未跑/无分不占位）', () => {
    const ran = stage({
      token: 'sys_elicitation',
      rounds: [round({ type: 'score', round: 1, total: 70 }), round({ type: 'round', round: 1, total: 70, verdict: 'converge' })],
    });
    const never = stage({ token: 'init', rounds: [] });
    const m = stageIterBadges(overview([ran, never]));
    expect(m.size).toBe(1);
    expect(m.get('sys_elicitation')?.total).toBe(70);
    expect(m.has('init')).toBe(false);
  });

  it('null / 空数据 → 空 Map', () => {
    expect(stageIterBadges(null).size).toBe(0);
    expect(stageIterBadges({ ok: true, state: null, stages: [] }).size).toBe(0);
  });
});
