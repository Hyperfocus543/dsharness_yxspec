// =============================================================================
// modelBadge — 模型徽标纯逻辑（轨迹行模型展示共享）
// 数据源 = 轨迹记录自带的 model 字段（TrajectoryRecord.model / TrajectoryGateStatus.model
// 同形态，网关 /api/trajectory* 已透传）。纯派生，零新接口。
// 用途：单阶段轨迹面板（TrajectoryPanel）与全局轨迹时间轴（TrajectoryTimeline）
// 共用同一套模型展示口径 —— 短显名 / 完整展示名 / 徽标样式，避免两处手写不一致。
// UI 基线：design-taste skill — 纯数据，色/文案由调用方组件负责。
// =============================================================================

/** 模型信息（TrajectoryRecord.model / TrajectoryGateStatus.model 同形态）。 */
export type ModelInfo = { provider: string; name: string; maxTokens?: number } | null | undefined;

/** 模型名短显：取 `/` 后最后一段（deepseek/deepseek-chat → deepseek-chat；无 → —） */
export function shortModelName(name: string | null | undefined): string {
  if (!name) return '—';
  const seg = name.split('/').filter((s) => s.length > 0);
  return seg.length > 0 ? seg[seg.length - 1] : name;
}

/** 模型展示名：name + 可选 provider 前缀（如 deepseek/xxx）；无 → — */
export function modelDisplayName(m: ModelInfo): string {
  if (!m?.name) return '—';
  if (m.provider && !m.name.includes(m.provider)) return `${m.provider}/${m.name}`;
  return m.name;
}
