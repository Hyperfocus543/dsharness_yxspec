// =============================================================================
// gateEvidence — 全景阶段卡 × 轨迹门控联动徽标纯逻辑
// 数据源 = stageStore 已合并进 StageStatus 的轨迹门控字段
//   （gate_policy / gate_trajectory / gate_reason，来自 GET /api/trajectory-gate 全量），
//   与门控视图 GateOverview / 轨迹面板 TrajectoryPanel 同数据源、零新请求。
// 目标：全景卡一眼看出该阶段的轨迹证据是否支撑门控 —— 阶段标「完成」但轨迹证据
//   打回/未验证时给红色/琥珀提示，避免「产物在但证据没了」的信任盲区。
// 口径与 GateOverview TRAJ_BADGE / REASON_TEXT 严格一致：
//   · 仅 gate_policy==='artifact+trajectory' 显示（artifact 策略不参与轨迹门控）
//   · 三态 verified → sage / unverified → amber / blocked → red
//   · reason 映射为人类可读判定文案（未知 reason 透传原文）
// 未参与轨迹门控（策略不符 / 无三态）→ null，卡片不渲染（静默降级）。
// UI 基线：design-taste skill — 纯数据，色/文案由调用方组件负责。
// =============================================================================

import type { StageStatus } from '../data/types';

/** 轨迹门控三态 → 徽标色系（sage 通过 / amber 未验证 / red 打回）。 */
export type GateEvidenceTone = 'sage' | 'amber' | 'red';

export interface GateEvidence {
  policy: 'artifact' | 'artifact+trajectory';
  status: 'verified' | 'unverified' | 'blocked';
  /** 徽标主文案（如「迹·通过」） */
  label: string;
  tone: GateEvidenceTone;
  /** 门控打回/警告原因码（无 → null） */
  reason: string | null;
}

/** 轨迹证据三态 → 徽标文案 + 色系（与 GateOverview TRAJ_BADGE 一致）。 */
export const GATE_BADGE: Record<string, { label: string; tone: GateEvidenceTone }> = {
  verified: { label: '迹·通过', tone: 'sage' },
  unverified: { label: '迹·未验证', tone: 'amber' },
  blocked: { label: '迹·打回', tone: 'red' },
};

/** 门控打回/警告原因 → 人类可读文案（与 GateOverview REASON_TEXT 一致）。 */
export const REASON_TEXT: Record<string, string> = {
  'trajectory-blocked': '轨迹证据打回（failed/interrupted/反复失败）',
  'trajectory-unverified': '轨迹存在但缺关键证据（无 turn/end 或全工具失败）',
  'no-trajectory': '无轨迹记录（该阶段从未执行）',
  'artifact-passed-no-trajectory': '产物命中但无轨迹（artifact+trajectory 策略需证据）',
  'artifact-missing': '产物缺失',
  'upstream-blocked': '上游阶段未完成',
};

/**
 * 单阶段轨迹门控徽标数据（未参与轨迹门控 → null，卡片不渲染）。
 * 与 GateOverview.trajGateOf 同判定：策略 artifact+trajectory 且有三态才给徽标；
 * 策略符合但三态缺失（网关未合并/无轨迹判定）按「未验证」兜底。
 */
export function gateEvidence(
  status: Pick<StageStatus, 'gate_policy' | 'gate_trajectory' | 'gate_reason'> | null | undefined,
): GateEvidence | null {
  if (!status || status.gate_policy !== 'artifact+trajectory') return null;
  const st = status.gate_trajectory ?? 'unverified'; // 策略参与但无三态 → 未验证兜底
  const badge = GATE_BADGE[st] ?? GATE_BADGE.unverified;
  return {
    policy: status.gate_policy,
    status: st,
    label: badge.label,
    tone: badge.tone,
    reason: status.gate_reason ?? null,
  };
}

/** 徽标 tooltip（与门控视图 hover 门控证据同口径；多行文本）。 */
export function gateEvidenceTooltip(ev: GateEvidence): string {
  return [
    `轨迹门控：${ev.label}`,
    `策略：${ev.policy}`,
    `轨迹证据：${ev.status === 'verified' ? '已通过' : ev.status === 'unverified' ? '未验证' : '已打回'}`,
    ev.reason ? `判定：${REASON_TEXT[ev.reason] ?? ev.reason}` : null,
  ]
    .filter((l): l is string => Boolean(l))
    .join('\n');
}
