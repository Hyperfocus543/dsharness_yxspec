// @vitest-environment node
// =============================================================================
// gitWorkspaceName.ts 纯逻辑单测（root 路径 → 可读展示名）
// 只测无 DOM 的导出函数：归一 / 末段提取 / 可辨识判定 / 截断 / 主入口。
// 数据源 = GitWorkspaceCard 已拉取的工作区注册表（GitWorkspace[]）+ 各操作行 root。
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  gitWorkspaceName,
  normalizeWorkspaceRoot,
  basenameOf,
  isDistinctiveName,
  truncatePath,
} from './gitWorkspaceName';
import type { GitWorkspace } from './ipc';

function ws(partial: Partial<GitWorkspace>): GitWorkspace {
  return { id: 'ws-1', name: 'repoA', root: 'D:/Work/a', source: 'manual', ...partial };
}

const REG: GitWorkspace[] = [
  ws({ id: 'ws-1', name: 'repoA', root: 'D:/Work/repoA' }),
  ws({ id: 'ws-2', name: 'repoB', root: 'D:/Work/repoB' }),
  ws({ id: 'default', name: 'default', root: 'D:/Work/proj', source: 'auto' }),
];

describe('normalizeWorkspaceRoot（路径归一）', () => {
  it('反斜杠 → 正斜杠', () => {
    expect(normalizeWorkspaceRoot('D:\\Work\\repoA')).toBe('D:/Work/repoA');
  });
  it('剥尾部分隔符（正/反斜杠）', () => {
    expect(normalizeWorkspaceRoot('D:/Work/repoA/')).toBe('D:/Work/repoA');
    expect(normalizeWorkspaceRoot('D:/Work/repoA\\')).toBe('D:/Work/repoA');
  });
  it('null / undefined / 空 → 空串（不抛）', () => {
    expect(normalizeWorkspaceRoot(null)).toBe('');
    expect(normalizeWorkspaceRoot(undefined)).toBe('');
    expect(normalizeWorkspaceRoot('')).toBe('');
  });
  it('盘符根剥尾后保留盘符（D:/  → D:）', () => {
    expect(normalizeWorkspaceRoot('D:/')).toBe('D:');
    expect(normalizeWorkspaceRoot('D:\\')).toBe('D:');
  });
});

describe('basenameOf（末段目录名提取）', () => {
  it('普通路径 → 末段', () => {
    expect(basenameOf('D:/Work/repoA')).toBe('repoA');
    expect(basenameOf('D:\\Work\\repoA')).toBe('repoA');
  });
  it('盘符根 → D:（不可辨识，由 isDistinctiveName 兜底）', () => {
    expect(basenameOf('D:/')).toBe('D:');
    expect(basenameOf('D:')).toBe('D:');
  });
  it('空 → 空串', () => {
    expect(basenameOf(null)).toBe('');
    expect(basenameOf('')).toBe('');
  });
});

describe('isDistinctiveName（末段是否可辨识）', () => {
  it('普通目录名 → true', () => {
    expect(isDistinctiveName('repoA')).toBe(true);
    expect(isDistinctiveName('01_Projects')).toBe(true);
  });
  it('空 / . / .. / 盘符根 → false', () => {
    expect(isDistinctiveName('')).toBe(false);
    expect(isDistinctiveName(null)).toBe(false);
    expect(isDistinctiveName('.')).toBe(false);
    expect(isDistinctiveName('..')).toBe(false);
    expect(isDistinctiveName('D:')).toBe(false);
  });
});

describe('truncatePath（长路径压缩）', () => {
  it('未超长 → 原样', () => {
    expect(truncatePath('D:/Work/repoA')).toBe('D:/Work/repoA');
  });
  it('超长 → 保留首尾折叠中间', () => {
    const long = 'D:/Work/01_Projects/2026_001_customer_product_very_long_name';
    const out = truncatePath(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out.startsWith('D:/Work/01_Pro')).toBe(true); // headLen = ceil(24*0.55) = 14
    expect(out.includes('…')).toBe(true);
  });
  it('默认 24 字符上限含省略号', () => {
    const long = 'D:/Work/01_Projects/2026_001_customer_product_very_long_name';
    expect(truncatePath(long).length).toBe(24);
  });
});

describe('gitWorkspaceName（root → 可读名）', () => {
  it('匹配注册表 name（操作行与列表同口径）', () => {
    expect(gitWorkspaceName('D:/Work/repoA', REG)).toBe('repoA');
    expect(gitWorkspaceName('D:/Work/repoB', REG)).toBe('repoB');
  });
  it('归一后匹配（反斜杠 / 尾分隔符与登记 root 同根）', () => {
    expect(gitWorkspaceName('D:\\Work\\repoA\\', REG)).toBe('repoA');
  });
  it('注册表默认根（id=default）→ 恒「默认」', () => {
    expect(gitWorkspaceName('D:/Work/proj', REG)).toBe('默认');
  });
  it('未匹配注册表 → 取根末段目录名', () => {
    expect(gitWorkspaceName('D:/Work/standalone', REG)).toBe('standalone');
  });
  it('末段不可辨识（盘符根）→ 截断 path 兜底（盘符根无上级目录可取）', () => {
    expect(gitWorkspaceName('D:/', REG)).toBe('D:');
    expect(gitWorkspaceName('D:/Work', REG)).toBe('Work');
  });
  it('空 root / null → 占位文案', () => {
    expect(gitWorkspaceName(null, REG)).toBe('未指定仓库');
    expect(gitWorkspaceName('', REG)).toBe('未指定仓库');
    expect(gitWorkspaceName(undefined, REG)).toBe('未指定仓库');
  });
  it('无注册表（null/undefined/空）→ 仍能给出可读名', () => {
    expect(gitWorkspaceName('D:/Work/repoA', null)).toBe('repoA');
    expect(gitWorkspaceName('D:/Work/repoA', undefined)).toBe('repoA');
    expect(gitWorkspaceName('D:/Work/repoA', [])).toBe('repoA');
  });
});
