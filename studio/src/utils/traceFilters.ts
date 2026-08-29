// =============================================================================
// traceFilters — 全局轨迹时间轴（TrajectoryTimeline）行过滤纯逻辑
// 数据源 = GET /api/trajectory-all 的 rows（TrajectoryAllEntry，时间降序）。
// 本模块只做无 DOM 的派生计算，可单测；UI 由 TrajectoryTimeline 承接。
// =============================================================================
// 三个过滤器均为纯前端派生、零新接口：
//   · onlyFailed   —— 只看失败/打回/已回滚（排障聚焦）
//   · onlyTagged   —— 「仅检查点」：只看该次执行时刻的最新 commit 打上了
//     yxspec/<stage>/<seq> 阶段收尾 tag 的行。语义与 Git 工作区管控卡
//     「仅 tag 检查点」一致：tag = 阶段正常收尾的里程碑节点（git-workspace
//     插件在 turn/end 收尾打 tag），一轮迭代里快速锁定"哪几次执行真正收尾"。
//   · freeText     —— 阶段/命令/状态/commit/tag 子串过滤（输入即过滤）
// 组合规则：failed 与 tagged 互斥（勾 tagged 时隐去 failed），freeText 叠加其上
//   （与「仅失败」开关同层；输入仅作用于轨迹行，不动阶段小计 chips）。
// 无 tag（git 不可用/非仓库/该阶段从未正常收尾）→ onlyTagged 结果为空数组，
//   UI 显示「无打 tag 的检查点」空态，不误报「还没有任何阶段执行记录」。
// =============================================================================

import type { TrajectoryAllEntry } from './ipc';

/** 失败/打回/已回滚判定（与 TrajectoryTimeline 原「仅失败」过滤器同口径）。 */
export function isFailureRow(r: TrajectoryAllEntry): boolean {
  return r.status === 'failed' || r.status === 'blocked' || r.rolled_back === true;
}

/** 检查点判定：该次执行时刻的最新 commit 打上了阶段收尾 tag（yxspec/<stage>/<seq>）。
 *  规则 = Git 工作区管控卡「仅 tag 检查点」过滤同口径：仅看 tag 字段非空。 */
export function isCheckpointRow(r: TrajectoryAllEntry): boolean {
  return typeof r.tag === 'string' && r.tag.length > 0;
}

/**
 * 文本过滤：阶段 token / ASPICE / 命令 / 状态 / commit / tag 子串匹配（大小写不敏感）。
 * 任一字段命中即保留；空查询 → 全部保留。多工作区下 commit 为 7 位短 hash，
 * tag 为 yxspec/<stage>/<seq> 全名 —— 都参与匹配（搜 commit 前缀 / tag 序号可定位）。
 */
export function matchesTraceText(r: TrajectoryAllEntry, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const hay = [
    r.stage ?? '',
    r.stageLabel ?? '',
    r.aspice ?? '',
    r.command ?? '',
    r.status ?? '',
    r.commit ?? '',
    r.tag ?? '',
  ].join(' ').toLowerCase();
  return hay.includes(t);
}

/**
 * 轨迹流过滤：failed/tagged 二选一 + 文本叠加。
 * @param rows  全量轨迹行（时间降序；缺省按空处理）
 * @param onlyFailed 只看失败/打回/已回滚
 * @param onlyTagged 只看打 tag 检查点（与 onlyFailed 互斥，优先）
 * @param text  子串过滤（空 → 不过滤）
 * @returns 过滤后的行数组（保持 rows 相对顺序不变）
 */
export function filterTraceRows(
  rows: TrajectoryAllEntry[] | null | undefined,
  opts: { onlyFailed?: boolean; onlyTagged?: boolean; text?: string } = {},
): TrajectoryAllEntry[] {
  const list = rows ?? [];
  const text = (opts.text ?? '').trim();
  return list.filter((r) => {
    if (opts.onlyTagged) {
      if (!isCheckpointRow(r)) return false;
    } else if (opts.onlyFailed) {
      if (!isFailureRow(r)) return false;
    }
    if (text && !matchesTraceText(r, text)) return false;
    return true;
  });
}
