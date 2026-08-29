// =============================================================================
// gitWorkspaceName — git 工作区 root 路径 → 可读展示名（纯函数，无 DOM 依赖）
// 数据源 = GitWorkspaceCard 已拉取的工作区注册表（GitWorkspace[]）+ 各操作行 root。
// 目标：操作留痕 / 头部 chip / 分支按钮展示「原始 root 路径」而非可读名——
//   `D:/Work/01_Projects/2026_xxx_客户_项目` 一长串，与工作区列表的 name 不对应，
//   多工作区下分不清操作发生在哪个仓库。本模块把 root 归一成稳定可读名：
//   · 匹配注册表已登记条目 → 用其 name（listWorkspaces 的 name = 仓库根末段目录名），
//     操作行与工作区列表同口径，一眼对应
//   · 注册表默认根（source:'auto' / id='default'）→ 恒显示「默认」（长绝对路径无意义，
//     与网关 workspaceNameFor 对齐）
//   · 未匹配注册表 → 取根末段目录名；末段不可辨识（空 / '.' / '..' / 盘符根）→
//     取末段前面一段；归一全失败 → 截断 path 压缩显示
// 纯前端派生、零新接口；展示增强，不影响 checkout/fetch/pull/push 的 root 语义。
// UI 基线：design-taste skill — 纯数据，色/文案由调用方组件负责。
// =============================================================================

import type { GitWorkspace } from './ipc';

/** 归一 root：反斜杠 → 正斜杠 + 剥尾部分隔符（`D:\Work\x\` → `D:/Work/x`）。
 *  与网关 isSafeTargetDir / stripTrailingSep 同口径，确保末段取的是真实目录名。 */
export function normalizeWorkspaceRoot(root: string | null | undefined): string {
  return String(root ?? '').replace(/\\/g, '/').replace(/[\\/]+$/, '');
}

/** 路径末段目录名（`D:/Work/repoA` → `repoA`；尾分隔符/空 → ''）。 */
export function basenameOf(root: string | null | undefined): string {
  const norm = normalizeWorkspaceRoot(root);
  const parts = norm.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** 末段目录名是否「可辨识」：空 / `.` / `..` / 盘符根（`D:` 等）→ 不可辨识，
 *  需要往上一段取才值得展示（纯函数判定，供 gitWorkspaceName 内部用）。 */
export function isDistinctiveName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name !== '.' && name !== '..' && !/^[A-Za-z]:$/.test(name);
}

/** 路径截断：超过 maxLen（含尾部省略号）时折叠中间（保留首尾段）——
 *  Windows 长盘符路径压缩成紧凑展示（非辨识末段的兜底，不截断语义）。 */
export function truncatePath(p: string, maxLen = 24): string {
  const s = String(p ?? '');
  if (s.length <= maxLen) return s;
  const headLen = Math.ceil(maxLen * 0.55);
  const tailLen = maxLen - headLen - 1;
  return `${s.slice(0, headLen)}…${s.slice(-tailLen)}`;
}

/**
 * root 路径 → 可读展示名。
 * @param root 仓库根目录（操作行/头部 chip 传入的原始路径）
 * @param workspaces 工作区注册表（优先匹配 name；可空）
 * @returns 展示名（恒非空：优先登记名 → 默认根名 → 可辨识末段 → 末段上级 → 截断 path）
 */
export function gitWorkspaceName(
  root: string | null | undefined,
  workspaces?: GitWorkspace[] | null | undefined,
): string {
  const norm = normalizeWorkspaceRoot(root);
  if (!norm) return '未指定仓库';

  // 1) 注册表已登记条目（按归一 root 精确匹配）：
  //    · 默认根（source:'auto' / id='default'）→ 恒「默认」——注册表 name 是 'default'，
  //      中文 UI 下「默认」更清晰，且与列表「自动」source 标签语义对齐
  //    · 手动登记 → 用其 name（listWorkspaces 的 name = 仓库根末段目录名），
  //      操作行与工作区列表同口径，一眼对应
  const reg = (workspaces ?? []).find((w) => normalizeWorkspaceRoot(w.root) === norm);
  if (reg) {
    if (reg.id === 'default' || reg.source === 'auto') return '默认';
    if (reg.name) return reg.name;
  }

  // 2) 根末段目录名可辨识 → 直接用（`D:/Work/repoA` → `repoA`）
  const base = basenameOf(norm);
  if (isDistinctiveName(base)) return base;

  // 3) 末段不可辨识（盘符根 / '.' / '..' / 尾分隔符）→ 取末段前面一段：
  //    `D:/Work/01_Projects` → `01_Projects`（比裸盘符根可读）
  const parent = basenameOf(norm.slice(0, -base.length));
  if (isDistinctiveName(parent)) return parent;

  // 4) 全失败 → 截断 path（Windows 长盘符路径压成紧凑显示）
  return truncatePath(norm);
}
