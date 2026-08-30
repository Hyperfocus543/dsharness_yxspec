// @vitest-environment node
// =============================================================================
// gitBranches.ts 纯逻辑单测（git branch -a 输出 → 按远端分组）
// 只测无 DOM 的导出函数。与 utils/gitTrace.test.ts 同款 test 文件约定。
// =============================================================================

import { describe, it, expect } from 'vitest';
import { groupGitBranches, type GitBranchDivergence, type GitBranchGroup } from './gitBranches';

describe('groupGitBranches（分支列表按远端分组）', () => {
  it('空 / null / undefined → []（调用方保持「无分支」展示）', () => {
    expect(groupGitBranches(null)).toEqual([]);
    expect(groupGitBranches(undefined)).toEqual([]);
    expect(groupGitBranches([])).toEqual([]);
  });

  it('纯本地分支 → 单组「本地分支」，不带远端分组', () => {
    const groups = groupGitBranches(['main', 'dev']);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('本地分支');
    expect(groups[0].branches.map((b) => b.value)).toEqual(['main', 'dev']);
  });

  it('本地 + 远端混合 → 本地在前，远端按 remote 分组', () => {
    const groups = groupGitBranches([
      'main',
      'feature/abc',
      'remotes/origin/main',
      'remotes/origin/feature/abc',
      'remotes/upstream/main',
    ]);
    // 本地组 + origin 组 + upstream 组
    expect(groups.map((g) => g.label)).toEqual(['本地分支', '远端 origin', '远端 upstream']);
    // 本地组原样
    expect(groups[0].branches.map((b) => ({ label: b.label, value: b.value, remote: b.remote }))).toEqual([
      { label: 'main', value: 'main', remote: null },
      { label: 'feature/abc', value: 'feature/abc', remote: null },
    ]);
    // origin 组：展示名去 remotes/ 前缀、带 remote 名，value 保持原样（checkout 语义不变）
    const origin = groups[1];
    expect(origin.branches.map((b) => b.label)).toEqual(['origin/main', 'origin/feature/abc']);
    expect(origin.branches.map((b) => b.value)).toEqual(['remotes/origin/main', 'remotes/origin/feature/abc']);
    expect(origin.branches.every((b) => b.remote === 'origin')).toBe(true);
    // upstream 组
    expect(groups[2].branches.map((b) => b.label)).toEqual(['upstream/main']);
  });

  it('远端分组按 remote 名字母序（不依赖输入顺序）', () => {
    const groups = groupGitBranches([
      'remotes/zeta/one',
      'main',
      'remotes/alpha/two',
    ]);
    expect(groups.map((g) => g.label)).toEqual(['本地分支', '远端 alpha', '远端 zeta']);
  });

  it('远端分支 value 恒为原始分支名（checkout 语义不变）', () => {
    const groups = groupGitBranches(['remotes/origin/feature/x']);
    expect(groups[0].branches[0].value).toBe('remotes/origin/feature/x');
    expect(groups[0].branches[0].remote).toBe('origin');
  });

  it('噪声行过滤：detached HEAD / no branch / 远端 HEAD 指针', () => {
    const groups = groupGitBranches([
      '(HEAD detached at abc1234)',
      '(no branch)',
      'main',
      'remotes/origin/HEAD -> origin/main',
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].branches.map((b) => b.value)).toEqual(['main']);
  });

  it('纯远端（无本地分支）→ 无「本地分支」空组占位', () => {
    const groups = groupGitBranches(['remotes/origin/main', 'remotes/origin/dev']);
    expect(groups.map((g) => g.label)).toEqual(['远端 origin']);
    expect(groups[0].branches).toHaveLength(2);
  });

  it('当前分支标注只给本地分支（currentBranch 匹配本地名）', () => {
    const groups = groupGitBranches(['main', 'dev', 'remotes/origin/main'], 'main');
    const local = groups[0].branches;
    expect(local.find((b) => b.value === 'main')?.current).toBe(true);
    expect(local.find((b) => b.value === 'dev')?.current).toBe(false);
    // 远端分支恒不标 current
    expect(groups[1].branches.every((b) => !b.current)).toBe(true);
  });

  it('currentBranch 为 null → 本地分支不标 current', () => {
    const groups = groupGitBranches(['main'], null);
    expect(groups[0].branches[0].current).toBe(false);
  });

  it('分支名含斜杠的本地分支不误入远端分组（无 remotes/ 前缀）', () => {
    const groups = groupGitBranches(['feature/deep/nested', 'remotes/origin/x']);
    expect(groups[0].branches.map((b) => b.label)).toEqual(['feature/deep/nested']);
    expect(groups[0].branches[0].remote).toBe(null);
    expect(groups[1].branches[0].remote).toBe('origin');
  });

  it('远端口径含本地同名分支也保留（不同组，不互相覆盖）', () => {
    const groups = groupGitBranches(['main', 'remotes/origin/main'], 'main');
    expect(groups).toHaveLength(2);
    expect(groups[0].branches[0]).toMatchObject({ label: 'main', value: 'main', current: true });
    // 远端分支不携带 current 字段（恒未定义，绝不当成本地当前分支）
    expect(groups[1].branches[0]).toMatchObject({ label: 'origin/main', value: 'remotes/origin/main' });
    expect(groups[1].branches[0].current).toBeUndefined();
  });

  it('本地分支偏差（ahead/behind）透传：divergence 挂本地分支，远端恒不标', () => {
    const details = new Map<string, GitBranchDivergence>([
      ['main', { upstream: 'origin/main', ahead: 2, behind: 0 }],
      ['topic', { upstream: 'origin/topic', ahead: 1, behind: 1 }],
    ]);
    const groups = groupGitBranches(['main', 'topic', 'remotes/origin/main', 'remotes/origin/topic'], 'main', details);
    // 本地组
    expect(groups[0].branches[0].divergence).toEqual({ upstream: 'origin/main', ahead: 2, behind: 0 });
    expect(groups[0].branches[1].divergence).toEqual({ upstream: 'origin/topic', ahead: 1, behind: 1 });
    // 远端组不携带 divergence
    expect(groups[1].branches.every((b) => b.divergence === undefined)).toBe(true);
    // value / current 语义不变（偏差纯装饰）
    expect(groups[0].branches[0].value).toBe('main');
    expect(groups[0].branches[0].current).toBe(true);
  });

  it('无偏差 / 缺 details → 不挂 divergence（与旧版行为完全一致）', () => {
    // 无 details（老网关/缺省）→ 本地分支无 divergence
    const plain = groupGitBranches(['main', 'dev'], 'main');
    expect(plain[0].branches.every((b) => b.divergence === undefined)).toBe(true);
    // details 提供但该分支不在其中 / 偏差 0（无净偏差）→ 无 divergence 或 0/0 原样透传
    const det = new Map<string, GitBranchDivergence>([['main', { upstream: 'origin/main', ahead: 0, behind: 0 }]]);
    const with0 = groupGitBranches(['main', 'dev'], 'main', det);
    expect(with0[0].branches[0].divergence).toEqual({ upstream: 'origin/main', ahead: 0, behind: 0 });
    expect(with0[0].branches[1].divergence).toBeUndefined();
    // details 为 null / 空 Map → 无 divergence
    expect(groupGitBranches(['main'], null, null)[0].branches[0].divergence).toBeUndefined();
    expect(groupGitBranches(['main'], null, new Map())[0].branches[0].divergence).toBeUndefined();
  });
});
