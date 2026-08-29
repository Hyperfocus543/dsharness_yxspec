// @vitest-environment node
// =============================================================================
// gateEvidence.ts 纯逻辑单测（全景阶段卡 × 轨迹门控徽标派生）
// 只测无 DOM 的导出函数：单阶段徽标数据 / tooltip 文案 / 门控证据详情行。
// 不渲染组件。
// =============================================================================

import { describe, it, expect } from 'vitest';
import { gateEvidence, gateEvidenceTooltip, gateDetail, gateDetailLines } from './gateEvidence';
import type { StageStatus } from '../data/types';
import type { TrajectoryGate } from './ipc';

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

// —— 门控证据详情（v2 tooltip 增强）夹具：与网关 /api/trajectory-gate payload 同形 ——
function gate(partial: any): TrajectoryGate {
  return {
    stage: 'swe_unit_verify',
    gate_policy: 'artifact+trajectory',
    artifact: { passed: true, files: ['project/specs/ts-ut/ts-ut-001.md'] },
    trajectory: {
      status: 'verified',
      hasTurnEnd: true,
      toolOk: true,
      toolCalls: 3,
      toolResults: 2,
      tokens: 1200,
      reason: null,
    },
    status: 'verified',
    passed: true,
    reason: 'artifact+trajectory-passed',
    ...partial,
  };
}

describe('gateDetail（门控证据详情派生）', () => {
  it('无数据（null / undefined）→ null（静默降级）', () => {
    expect(gateDetail(null)).toBeNull();
    expect(gateDetail(undefined)).toBeNull();
  });

  it('artifact+trajectory 全量 payload → 产物/轨迹证据都带', () => {
    const d = gateDetail(gate({}))!;
    expect(d).not.toBeNull();
    expect(d.artifact.passed).toBe(true);
    expect(d.artifact.files).toEqual(['project/specs/ts-ut/ts-ut-001.md']);
    expect(d.trajectory).toEqual({
      hasTurnEnd: true,
      toolOk: true,
      toolCalls: 3,
      toolResults: 2,
      tokens: 1200,
    });
  });

  it('产物缺失 + 无轨迹 → artifact 未命中、trajectory null（不抛）', () => {
    const d = gateDetail(
      gate({ artifact: { passed: false, files: ['project/specs/ts-ut/ts-ut-001.md'] }, trajectory: null }),
    )!;
    expect(d.artifact.passed).toBe(false);
    expect(d.trajectory).toBeNull();
  });

  it('缺 artifact/trajectory 字段 → 安全兜底（pass false / trajectory null）', () => {
    const d = gateDetail(gate({ artifact: undefined, trajectory: undefined }))!;
    expect(d.artifact.passed).toBe(false);
    expect(d.artifact.files).toEqual([]);
    expect(d.trajectory).toBeNull();
  });

  it('非数字计数 → 归一为 0（不渲染 NaN）', () => {
    const d = gateDetail(gate({ trajectory: { hasTurnEnd: true, toolOk: true, toolCalls: 'x' as any, toolResults: null as any, tokens: undefined as any } }))!;
    expect(d.trajectory!.toolCalls).toBe(0);
    expect(d.trajectory!.toolResults).toBe(0);
    expect(d.trajectory!.tokens).toBe(0);
  });
});

describe('gateDetailLines（门控证据详情可读行）', () => {
  it('产物命中 + 轨迹完整 → 两行证据', () => {
    const lines = gateDetailLines(gateDetail(gate({}))!);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('产物：命中');
    expect(lines[0]).toContain('1 项');
    expect(lines[1]).toContain('轨迹：');
    expect(lines[1]).toContain('有 turn/end');
    expect(lines[1]).toContain('有成功工具结果');
    expect(lines[1]).toContain('工具 3/2');
    expect(lines[1]).toContain('1,200 tok');
  });

  it('产物缺失 → 「产物：缺失」', () => {
    const d = gateDetail(gate({ artifact: { passed: false, files: ['a.md', 'b.md'] }, trajectory: null }));
    expect(gateDetailLines(d!)[0]).toContain('产物：缺失');
  });

  it('产物命中但无文件产物阶段（glob 空）→ 视为通过', () => {
    const d = gateDetail(gate({ artifact: { passed: true, files: [] }, trajectory: null }));
    const lines = gateDetailLines(d!);
    expect(lines[0]).toContain('命中');
    expect(lines[0]).toContain('视为通过');
  });

  it('无轨迹 → 「轨迹：无记录」', () => {
    const d = gateDetail(gate({ trajectory: null }));
    expect(gateDetailLines(d!)[1]).toContain('轨迹：无记录');
  });

  it('轨迹缺关键证据（无 turn/end / 无成功工具）→ 明示', () => {
    const d = gateDetail(
      gate({ trajectory: { status: 'unverified', hasTurnEnd: false, toolOk: false, toolCalls: 1, toolResults: 0, tokens: 0, reason: null } }),
    );
    const line = gateDetailLines(d!)[1];
    expect(line).toContain('无 turn/end');
    expect(line).toContain('无成功工具结果');
  });

  it('产物文件多 → 只列前 3 个样例 + 总数', () => {
    const files = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'];
    const d = gateDetail(gate({ artifact: { passed: true, files } }));
    const line = gateDetailLines(d!)[0];
    expect(line).toContain('等 5 项');
    expect(line).toContain('a.md');
    expect(line).toContain('c.md');
  });
});
