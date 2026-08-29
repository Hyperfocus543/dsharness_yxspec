// =============================================================================
// gitRetry — git 写操作留痕「原地重试」纯逻辑（GitWorkspaceCard 操作留痕区块）
// 数据源 = 已拉取的 audit 单条（GitAuditEntry，GET /api/git/audit 归一化展示行）。
// 目标：失败写操作（fetch/pull/push/checkout/init）在留痕行上即可重试——
//   按该条记录的原仓库 root 重跑该 action，不再依赖「顶部按钮只作用于活动工作区」。
//   多仓库下顶部 fetch/pull/push 只作用于 activeWorkspace，而失败留痕记录的
//   root 可能是任意已登记仓库（含非活动）；行内重试按原 root 跑，重试目标无歧义。
// 语义对齐网关 /api/git/operate 各 action 契约（git-workspaces.mjs）：
//   · fetch    → git fetch --all --prune（无入参）
//   · pull     → git pull --ff-only（无入参）
//   · push     → git push（无入参）
//   · checkout → git checkout <branch>（入参 args.branch）
//   · init     → git init（入参 args.dir；目标目录已存在，重试幂等安全）
// 不做重试的 action：
//   · clone    → 失败后目标目录已非空（git 部分落盘），重试同目录必被网关以
//                「目标目录已存在且非空」打回 —— 属于误导性死路，排除
//   · branch   → 只读列表操作，网关根本不记审计（不会出现在留痕里）
//   · unknown  → 老/损坏条目，无 action 语义，排除
// UI 基线：design-taste skill — 纯数据，色/文案由调用方组件负责。
// =============================================================================

import type { GitAuditEntry, GitOperateParams } from './ipc';

/** 可原地重试的 action 白名单（与网关 gitOperate KNOWN 子集对齐，排除 clone/branch）。 */
const RETRYABLE = new Set(['fetch', 'pull', 'push', 'checkout', 'init']);

/** action 是否可原地重试（clone/branch/unknown → false，行内不渲染重试按钮）。 */
export function canRetryAuditAction(action: string | null | undefined): boolean {
  return typeof action === 'string' && RETRYABLE.has(action);
}

/** 重试按钮文案：checkout → 重试切换 / init → 重试新建 / 其余 → 重试。 */
export function retryAuditLabel(action: string | null | undefined): string {
  if (action === 'checkout') return '重试切换';
  if (action === 'init') return '重试新建';
  return '重试';
}

/**
 * 重试入参：按 action 从留痕 args 还原 gitOperate 的 args。
 *  · fetch/pull/push → {}（网关无入参）
 *  · checkout → { branch }（缺 branch → null，标记缺参不可重试）
 *  · init → { dir }（缺 dir → null）
 * @param e 审计留痕
 * @returns 入参对象；缺关键参数 → null（调用方据 retryAuditTitle 给原因）
 */
export function retryAuditArgs(e: GitAuditEntry): Record<string, string> | null {
  const args = e?.args ?? {};
  if (e?.action === 'checkout') {
    const branch = typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : '';
    return branch ? { branch } : null;
  }
  if (e?.action === 'init') {
    const dir = typeof args.dir === 'string' && args.dir.trim() ? args.dir.trim() : '';
    return dir ? { dir } : null;
  }
  return {};
}

/**
 * 拼装重试的 gitOperate 参数（root = 该条留痕记录的原仓库根）。
 * @param e 审计留痕
 * @returns 可直接调 ipc.gitOperate 的参数；不可重试 / 缺 root / 缺关键参数 → null
 */
export function retryAuditParams(e: GitAuditEntry): GitOperateParams | null {
  if (!e?.root || !canRetryAuditAction(e.action)) return null;
  const args = retryAuditArgs(e);
  if (args === null) return null;
  return { root: e.root, action: e.action as GitOperateParams['action'], args };
}

/** 重试按钮 tooltip：分「不可重试原因 / 重试目标」两段，悬停即知按哪个仓库重试。 */
export function retryAuditTitle(e: GitAuditEntry): string {
  if (!e?.root) return '该留痕无仓库根记录，无法重试';
  if (!canRetryAuditAction(e.action)) {
    return e?.action === 'clone'
      ? 'clone 失败后目标目录已非空，原地重试必被「目录已存在且非空」打回；请更换目标目录重新克隆'
      : '该操作不支持原地重试';
  }
  if (retryAuditArgs(e) === null) {
    return e?.action === 'checkout' ? '该留痕缺分支参数，无法重试' : '该留痕缺目标目录参数，无法重试';
  }
  return `按原仓库 ${e.root} 重试${e?.actionLabel ? ` ${e.actionLabel}` : ` ${e.action}`}（成功与否都会刷新留痕）`;
}
