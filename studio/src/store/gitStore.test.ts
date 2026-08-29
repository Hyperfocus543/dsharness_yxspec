// @vitest-environment node
// =============================================================================
// gitStore.ts 纯逻辑单测（clone/init 完成后活动工作区选择）
// 只测无 DOM 的导出函数 pickWorkspaceToActivate。不渲染组件、不连网关。
// =============================================================================

import { describe, it, expect } from 'vitest';
import { pickWorkspaceToActivate } from './gitStore';
import type { GitWorkspace, GitWorkspaceList } from '../utils/ipc';

function list(workspaces: GitWorkspace[], activeId: string | null = null): GitWorkspaceList {
  return { version: 1, defaultRoot: null, activeId, workspaces };
}

const A: GitWorkspace = { id: 'ws-1', name: 'repoA', root: 'D:/Work/a', source: 'manual' };
const B: GitWorkspace = { id: 'ws-2', name: 'repoB', root: 'D:/Work/b', source: 'manual' };
const DEF: GitWorkspace = { id: 'default', name: 'default', root: 'D:/Work/default', source: 'auto' };

describe('pickWorkspaceToActivate（clone/init 后活动工作区选择）', () => {
  it('精确匹配新 root → 选中该工作区（克隆/新建后立即可见）', () => {
    expect(pickWorkspaceToActivate(list([A, B]), 'D:/Work/b')).toBe(B);
  });

  it('new root 匹配自动默认根（source=auto）→ 同样命中', () => {
    expect(pickWorkspaceToActivate(list([DEF, A]), 'D:/Work/default')).toBe(DEF);
  });

  it('root 无精确匹配 → 回退服务端 activeId 指向的工作区', () => {
    expect(pickWorkspaceToActivate(list([A, B], 'ws-2'), 'D:/Work/ghost')).toBe(B);
  });

  it('root 无匹配且 activeId 为空 → 回退列表首项（至少切离旧 root）', () => {
    expect(pickWorkspaceToActivate(list([A, B]), null)).toBe(A);
    expect(pickWorkspaceToActivate(list([B, A], 'nonexistent'), 'D:/Work/ghost')).toBe(B);
  });

  it('空工作区列表 → null', () => {
    expect(pickWorkspaceToActivate(list([]), 'D:/Work/a')).toBeNull();
    expect(pickWorkspaceToActivate(list([]), null)).toBeNull();
  });

  it('root 为 null（结果异常缺 dir）→ 回退 activeId / 首项', () => {
    expect(pickWorkspaceToActivate(list([A, B], 'ws-1'), null)).toBe(A);
    expect(pickWorkspaceToActivate(list([A, B]), null)).toBe(A);
  });
});
