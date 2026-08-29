// =============================================================================
// gitBranches — git branch -a 输出 → 按远端分组（分支切换下拉数据源纯逻辑）
// =============================================================================
// 数据源 = 网关 /api/git/operate action=branch 返回的 branches 字符串数组
//   （`git branch -a` 输出，网关已剥 `* ` 前缀、trim、过滤空行）。
// 目标：多远端仓库里分支下拉一眼可分本地/远端 —— 本地分支在前，远端按 remote
//   名分组（origin / upstream / …），展示名带 remote 前缀不混淆。
// 纯前端派生、零新接口；checkout 的 value 恒为原始分支名（不改变既有 checkout
//   语义 —— 远端分支仍按原样 checkout，行为与旧版完全一致）。
// 过滤噪声行：detached HEAD（`(HEAD detached …)` / `(no branch)`）与远端 HEAD
//   指针（`remotes/origin/HEAD -> origin/main`）——不能/不必 checkout，不参与分组。
// UI 基线：design-taste skill — 纯数据，色/文案由调用方组件负责。
// =============================================================================

/** 单个分支项（下拉 option 数据源）。 */
export interface GitBranchItem {
  /** 展示名：本地原样；远端 `remotes/<remote>/<rest>` → `<remote>/<rest>` */
  label: string;
  /** 原始分支名（checkout 用，与网关返回逐字一致） */
  value: string;
  /** 归属 remote（本地分支 → null） */
  remote: string | null;
  /** 是否当前分支（本地分支且与 status.branch 一致；远端恒不标） */
  current?: boolean;
}

/** 分支切换下拉的一个分组（本地分支 / 远端 <remote>）。 */
export interface GitBranchGroup {
  /** optgroup label（本地分支 / 远端 origin / 远端 upstream …） */
  label: string;
  branches: GitBranchItem[];
}

/**
 * git branch -a 输出 → 按远端分组（本地在前，远端按 remote 名字母序）。
 * @param branches 网关返回的原始分支名数组（已剥 `*` 前缀；缺省按空处理）
 * @param currentBranch 当前分支名（本地分支匹配 → 标 current；缺省不标注）
 * @returns 分组数组；空输入 → []（调用方保持「无分支」展示）
 */
export function groupGitBranches(
  branches: string[] | null | undefined,
  currentBranch?: string | null,
): GitBranchGroup[] {
  const items: GitBranchItem[] = [];
  for (const raw of branches ?? []) {
    if (!raw) continue;
    // 噪声行：detached HEAD（`(HEAD detached …)` / `(no branch)`）、
    // 远端 HEAD 指针（`remotes/origin/HEAD -> origin/main`）——不参与分组。
    if (raw.startsWith('(')) continue;
    if (/^remotes\/[^/]+\/HEAD(\s.*)?$/.test(raw)) continue;
    const m = raw.match(/^remotes\/([^/]+)\/(.+)$/);
    if (m) {
      items.push({ label: `${m[1]}/${m[2]}`, value: raw, remote: m[1] });
    } else {
      items.push({ label: raw, value: raw, remote: null });
    }
  }

  const groups: GitBranchGroup[] = [];
  // 本地分支在前（可辨识度最高；当前分支标注只给本地分支，
  // 远端分支恒不匹配 status.branch 的本地名）
  const local = items.filter((i) => i.remote === null);
  if (local.length > 0) {
    groups.push({
      label: '本地分支',
      branches: local.map((i) => ({
        ...i,
        current: currentBranch != null && i.value === currentBranch,
      })),
    });
  }
  // 远端按 remote 名分组（字母序，不依赖输入顺序）
  const byRemote = new Map<string, GitBranchItem[]>();
  for (const r of items) {
    if (!r.remote) continue;
    const list = byRemote.get(r.remote) ?? [];
    list.push(r);
    byRemote.set(r.remote, list);
  }
  for (const remote of [...byRemote.keys()].sort((a, b) => a.localeCompare(b))) {
    groups.push({ label: `远端 ${remote}`, branches: byRemote.get(remote) ?? [] });
  }
  return groups;
}
