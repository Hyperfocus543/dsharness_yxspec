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
//
// v2 门控证据详情（门控徽标 tooltip 增强）：
//   /api/trajectory-gate 全量 payload 里本就有产物命中/文件数、轨迹 turn/end、
//   工具成败/调用计数、token 用量 —— 旧 tooltip 只展示抽象三态，把已拉到的
//   具体证据丢掉了。gateDetail() 把这些字段派生为 GateEvidenceDetail，
//   StageNode 徽标 hover 时拼进 tooltip（零新请求），让「迹·通过/打回」有据可查。
// UI 基线：design-taste skill — 纯数据，色/文案由调用方组件负责。
// =============================================================================

import type { StageStatus } from '../data/types';
import type { TrajectoryGate } from './ipc';

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

// =============================================================================
// 门控证据详情（v2 · 门控徽标 tooltip 增强）
// 数据源 = GET /api/trajectory-gate 全量 payload（stageStore 已拉取并存
//   trajectoryGates，字段契约见 utils/ipc.ts TrajectoryGate / TrajectoryGateStatus）。
// 把「产物命中 + 轨迹三态」的具体证据拼成可读行，替代原抽象三态文案。
// 口径与 TrajectoryPanel / GateOverview 严格一致：artifact.files 为产物文件清单、
// trajectory.hasTurnEnd / toolOk / toolCalls / toolResults / tokens 为轨迹证据计数。
// =============================================================================

/** 单阶段门控证据详情（可读行由 gateDetailLines 拼装）。 */
export interface GateEvidenceDetail {
  /** 产物门：是否命中 + 命中文件数（无产物 glob 阶段 → files 空数组，pass 恒 true） */
  artifact: { passed: boolean; files: string[] };
  /** 轨迹证据（null = 无轨迹 / artifact 策略不参与；字段详见 ipc TrajectoryGateStatus） */
  trajectory: {
    hasTurnEnd: boolean;
    toolOk: boolean;
    toolCalls: number;
    toolResults: number;
    tokens: number;
  } | null;
}

/** 从 /api/trajectory-gate 全量 payload 派生门控证据详情（无该阶段数据 → null）。 */
export function gateDetail(gate: TrajectoryGate | null | undefined): GateEvidenceDetail | null {
  if (!gate || typeof gate !== 'object') return null;
  const art = gate.artifact ?? null;
  const traj = gate.trajectory ?? null;
  return {
    artifact: {
      passed: art?.passed === true,
      files: Array.isArray(art?.files) ? art.files : [],
    },
    trajectory: traj
      ? {
          hasTurnEnd: traj.hasTurnEnd === true,
          toolOk: traj.toolOk === true,
          toolCalls: Number.isFinite(traj.toolCalls) ? traj.toolCalls : 0,
          toolResults: Number.isFinite(traj.toolResults) ? traj.toolResults : 0,
          tokens: Number.isFinite(traj.tokens) ? traj.tokens : 0,
        }
      : null,
  };
}

/** 产物命中 → 人类可读行（命中：文件数 + 文件名样例；未命中：缺失；无产物 glob → 视为过）。 */
function artifactLine(d: GateEvidenceDetail): string {
  const files = d.artifact.files;
  if (d.artifact.passed) {
    if (files.length === 0) return '产物：命中（无文件产物阶段，视为通过）';
    const preview = files.length > 3 ? `${files.slice(0, 3).join('、')} 等 ${files.length} 项` : files.join('、');
    return `产物：命中 ${files.length} 项 · ${preview}`;
  }
  return `产物：缺失（应命中 ${files.length} 项 glob 产物）`;
}

/** 轨迹证据 → 人类可读行（有轨迹：turn/end + 工具成败计数 + token；无轨迹 → 未执行）。 */
function trajectoryLine(d: GateEvidenceDetail): string {
  const t = d.trajectory;
  if (!t) return '轨迹：无记录（该阶段从未执行 / 未参与轨迹门控）';
  const te = t.hasTurnEnd ? '有 turn/end' : '无 turn/end';
  const tool = t.toolOk ? '有成功工具结果' : '无成功工具结果';
  return `轨迹：${te} · ${tool} · 工具 ${t.toolCalls}/${t.toolResults} · ${t.tokens.toLocaleString('zh-CN')} tok`;
}

/**
 * 门控证据详情可读行（v2 tooltip 证据段）。
 * 只列「有信息量」的行：产物命中给文件数/样例（空产物阶段降级为「视为通过」），
 * 轨迹缺失/未参与给「无记录」，避免空行占位。返回数组，由调用方拼进 tooltip。
 */
export function gateDetailLines(d: GateEvidenceDetail): string[] {
  return [
    artifactLine(d),
    trajectoryLine(d),
  ];
}

// =============================================================================
// 轨迹面板门控证据详情（TrajectoryPanel 门控徽标 tooltip 增强）
// 数据源 = GET /api/trajectory 视图自身字段（与 gateDetail 的 /api/trajectory-gate
//   payload 同语义，零新请求）：
//   · view.exists  = 阶段产物 glob 是否命中（stageGlobHit 同源，等价 artifact.passed）
//   · view.artifacts = 产物文件清单（已按 glob 扫描，等价 artifact.files）
//   · view.status = 轨迹证据三态 + turn/end + 工具成败计数 + token（trajectoryStatus 同源）
// 产物命中行与 gateDetail 口径对齐：无产物 glob 阶段（artifacts 空且 exists=true）
//   → 「视为通过」；exists=false → 「缺失（应命中 N 项 glob 产物）」。
// =============================================================================

/** 轨迹面板门控证据详情（无轨迹面板形态数据 / 无可用字段 → null，静默降级）。 */
export function trajectoryViewDetail(
  view: TrajectoryViewLike | null | undefined,
): GateEvidenceDetail | null {
  if (!view || typeof view !== 'object') return null;
  const traj = view.status ?? null;
  // 归一化辅助：仅 typeof === 'number' 才算数（可选字段缺省/非法 → 0，不渲染 NaN）
  const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    artifact: {
      // exists = stageGlobHit（任一 spec glob 命中）；无产物 glob 阶段恒 true，
      // 与 gateDetail 的 artifact.passed 语义对齐（缺省按缺失兜底，不误报命中）
      passed: view.exists === true,
      files: Array.isArray(view.artifacts) ? view.artifacts.map((a) => a.path) : [],
    },
    trajectory: traj
      ? {
          hasTurnEnd: traj.hasTurnEnd === true,
          toolOk: traj.toolOk === true,
          toolCalls: n(traj.toolCalls),
          toolResults: n(traj.toolResults),
          tokens: n(traj.tokens),
        }
      : null,
  };
}

/** 轨迹面板视图的弱形态（只取本适配器需要的字段；结构等价 ipc.TrajectoryView）。 */
export interface TrajectoryViewLike {
  /** 阶段产物 glob 是否命中（无产物 glob 阶段恒 true） */
  exists?: boolean;
  /** 产物文件清单（已按 glob 扫描；缺省 → 空数组） */
  artifacts?: Array<{ path: string; kind?: string }>;
  /** 轨迹证据三态 + 计数（trajectoryStatus 同源；无 → null） */
  status?: {
    hasTurnEnd?: boolean;
    toolOk?: boolean;
    toolCalls?: number;
    toolResults?: number;
    tokens?: number;
  } | null;
}
