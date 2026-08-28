// @vitest-environment node
// =============================================================================
// gateEvidence.ts 纯逻辑单测（全景阶段卡 × 轨迹门控徽标派生）
// 只测无 DOM 的导出函数：单阶段徽标数据 / tooltip 文案。不渲染组件。
// =============================================================================

import { describe, it, expect } from 'vitest';
import { gateEvidence, gateEvidenceTooltip } from './gateEvidence';
import type { StageStatus } from '../data/types';

function status(
  partial: Partial<Pick<StageStatus, 'gate_policy' | 'gate_trajectory' | 'gate_reason'>>,
): Pick<StageStatus, 'gate_policy' | 'gate_trajectory' | 'gate_reason'> {
  return {
    gate_policy: undefined,
    gate_trajectory: undefined,
    gate_reason: undefined,
    ...partial,
  };
}

describe('gateEvidence（单阶段轨迹门控徽标派生）', () => {
  it('artifact 策略不参与轨迹门控 → null（不渲染）', () => {
    expect(gateEvidence(status({ gate_policy: 'artifact' }))).toBeNull();
  });

  it('无门控字段（undefined / null）→ null（静默降级）', () => {
    expect(gateEvidence(null)).toBeNull();
    expect(gateEvidence(undefined)).toBeNull();
    expect(gateEvidence(status({}))).toBeNull();
  });

  it('artifact+trajectory 策略 + verified → sage 通过徽标', () => {
    const ev = gateEvidence(
      status({ gate_policy: 'artifact+trajectory', gate_trajectory: 'verified' }),
    );
    expect(ev).not.toBeNull();
    expect(ev!.label).toBe('迹·通过');
    expect(ev!.tone).toBe('sage');
    expect(ev!.status).toBe('verified');
  });

  it('artifact+trajectory 策略 + unverified → amber 未验证', () => {
    const ev = gateEvidence(
      status({ gate_policy: 'artifact+trajectory', gate_trajectory: 'unverified', gate_reason: 'trajectory-unverified' }),
    );
    expect(ev!.label).toBe('迹·未验证');
    expect(ev!.tone).toBe('amber');
    expect(ev!.reason).toBe('trajectory-unverified');
  });

  it('artifact+trajectory 策略 + blocked → red 打回', () => {
    const ev = gateEvidence(
      status({ gate_policy: 'artifact+trajectory', gate_trajectory: 'blocked', gate_reason: 'trajectory-blocked' }),
    );
    expect(ev!.label).toBe('迹·打回');
    expect(ev!.tone).toBe('red');
  });

  it('策略参与但三态缺失（网关未合并）→ 未验证兜底', () => {
    const ev = gateEvidence(status({ gate_policy: 'artifact+trajectory' }));
    expect(ev).not.toBeNull();
    expect(ev!.status).toBe('unverified');
    expect(ev!.tone).toBe('amber');
  });
});

describe('gateEvidenceTooltip（hover 门控证据）', () => {
  it('verified 无 reason → 给三行证据', () => {
    const ev = gateEvidence(
      status({ gate_policy: 'artifact+trajectory', gate_trajectory: 'verified' }),
    )!;
    const tip = gateEvidenceTooltip(ev);
    expect(tip).toContain('轨迹门控：迹·通过');
    expect(tip).toContain('策略：artifact+trajectory');
    expect(tip).toContain('轨迹证据：已通过');
    expect(tip).not.toContain('判定：');
  });

  it('blocked 带已知 reason → 映射人类可读文案', () => {
    const ev = gateEvidence(
      status({ gate_policy: 'artifact+trajectory', gate_trajectory: 'blocked', gate_reason: 'trajectory-blocked' }),
    )!;
    const tip = gateEvidenceTooltip(ev);
    expect(tip).toContain('轨迹证据：已打回');
    expect(tip).toContain('判定：轨迹证据打回（failed/interrupted/反复失败）');
  });

  it('未知 reason → 透传原文（不丢信息）', () => {
    const ev = gateEvidence(
      status({ gate_policy: 'artifact+trajectory', gate_trajectory: 'blocked', gate_reason: 'custom-block' }),
    )!;
    expect(gateEvidenceTooltip(ev)).toContain('判定：custom-block');
  });
});
