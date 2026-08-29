// =============================================================================
// gitAuditFilter — git 写操作留痕（GitWorkspaceCard「操作留痕」区块）过滤纯逻辑
// 数据源 = GitWorkspaceCard 已拉取的 audit（GitAuditEntry[]，时间倒序 新→旧，
//   GET /api/git/audit 归一化后的展示行）。
// 目标：写操作留痕混排 fetch/pull/push/checkout/clone/init 全部条目，失败操作
//   常被成功操作淹没（git 写操作 90% 是成功）；给「仅失败」聚焦 —— 与全局轨迹
//   时间轴 TrajectoryTimeline 的「仅失败」开关同模式、同口径：
//   · failure = e.ok === false（未确认 okLabel 视作「成败未知」，不算失败）
//   · 纯前端派生，零新接口；勾选态只过滤展示，不动审计数据源
// UI 基线：design-taste skill — 纯数据，色/文案由调用方组件负责。
// =============================================================================

import type { GitAuditEntry } from './ipc';

/** 失败判定：仅显式 ok===false（成功 ok===true、未确认 okLabel/ok 缺失 → 不算失败）。
 *  与 TrajectoryTimeline「仅失败」的判定口径对齐（那里 failed/blocked/rolled_back，
 *  这里失败 = 网关明确标记 ok:false）。 */
export function isAuditFailure(e: GitAuditEntry | null | undefined): boolean {
  return e?.ok === false;
}

/** 审计留痕中的失败条数（时间倒序数组直接统计；空/缺省 → 0）。 */
export function auditFailureCount(entries: GitAuditEntry[] | null | undefined): number {
  return (entries ?? []).filter(isAuditFailure).length;
}

/**
 * 操作留痕过滤：仅失败（可选）。
 * @param entries 审计留痕（时间倒序；缺省按空处理）
 * @param onlyFailed 只看失败操作（ok===false）
 * @returns 过滤后的留痕数组（保持 entries 相对顺序不变）
 */
export function filterAuditEntries(
  entries: GitAuditEntry[] | null | undefined,
  opts: { onlyFailed?: boolean } = {},
): GitAuditEntry[] {
  const list = entries ?? [];
  if (!opts.onlyFailed) return list;
  return list.filter(isAuditFailure);
}
