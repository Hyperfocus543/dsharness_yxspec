// =============================================================================
// rerunTrajectory — 全局轨迹行内「重跑」纯逻辑
// 数据源 = trajectory-all 每行透传的 stage/command（网关已按阶段合并），本模块只做
// 派生判定，无 DOM 依赖，可单测。
// 语义与 STAGE_TABLE 命令映射同口径：gate 命令 / 老网关无命令 → null（不渲染重跑按钮）。
// =============================================================================

import type { TrajectoryAllEntry } from './ipc';

/** 阶段 token → 重跑派活命令（STAGE_TABLE 原生 slash 命令；无 → null）。 */
export function rerunCommandOf(entry: TrajectoryAllEntry, table: Record<string, { command?: string }>): string | null {
  const cmd = table[entry.stage]?.command;
  return cmd && cmd.trim() ? cmd.trim() : null;
}

/** 该行是否值得渲染重跑按钮：
 *   · 有重跑命令（STAGE_TABLE 有该阶段）
 *   · 状态为失败/打回/已回滚（排障焦点：成功无需重跑）
 *  → 按钮只在「可重跑的失败行」出现，不喧宾夺主。
 *  command 走 STAGE_TABLE（权威），不信任轨迹行自身 command 字段（老网关可能为空）。 */
export function canRerun(entry: TrajectoryAllEntry, table: Record<string, { command?: string }>): boolean {
  if (!entry || !entry.stage) return false;
  const cmd = rerunCommandOf(entry, table);
  if (!cmd) return false;
  const st = entry.status;
  return st === 'failed' || st === 'blocked' || entry.rolled_back === true;
}

/** 重跑按钮文案：失败/打回 → 「重跑」；已回滚 → 「重跑」同（回滚后重跑 = 修复后重新执行）。 */
export function rerunLabel(entry: TrajectoryAllEntry): string {
  return '重跑';
}
