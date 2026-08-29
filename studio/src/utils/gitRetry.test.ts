// @vitest-environment node
// =============================================================================
// gitRetry.ts 纯逻辑单测（git 写操作留痕「原地重试」）
// 只测无 DOM 的导出函数。与 gitAuditFilter.test.ts 同款 test 文件约定。
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  canRetryAuditAction,
  retryAuditLabel,
  retryAuditArgs,
  retryAuditParams,
  retryAuditTitle,
} from './gitRetry';
import type { GitAuditEntry } from './ipc';

function entry(partial: Partial<GitAuditEntry>): GitAuditEntry {
  return {
    at: 1000,
    action: 'fetch',
    actionLabel: '拉取远端',
    ok: true,
    okLabel: '成功',
    root: 'D:/Work/x',
    args: {},
    stdout: null,
    error: null,
    ...partial,
  };
}

const fetchFailed = entry({ action: 'fetch', actionLabel: '拉取远端', ok: false, okLabel: '失败', error: 'git fetch 执行失败' });
const pullFailed = entry({ action: 'pull', actionLabel: '同步远端', ok: false, okLabel: '失败', error: 'git pull 执行失败' });
const pushFailed = entry({ action: 'push', actionLabel: '推送', ok: false, okLabel: '失败', error: 'git push 执行失败' });
const checkoutFailed = entry({ action: 'checkout', actionLabel: '切换分支', ok: false, okLabel: '失败', args: { branch: 'feature/x' }, error: 'git checkout 执行失败' });
const checkoutNoBranch = entry({ action: 'checkout', ok: false, okLabel: '失败', args: {} });
const initFailed = entry({ action: 'init', actionLabel: '新建仓库', ok: false, okLabel: '失败', args: { dir: 'D:/Work/new-repo' }, error: 'git init 执行失败' });
const initNoDir = entry({ action: 'init', ok: false, okLabel: '失败', args: {} });
const cloneFailed = entry({ action: 'clone', actionLabel: '克隆', ok: false, okLabel: '失败', args: { url: 'https://x', dir: 'D:/Work/x' }, error: 'git clone 执行失败' });
const branchEntry = entry({ action: 'branch', ok: false, okLabel: '失败' });
const unknownEntry = entry({ action: 'unknown', ok: false, okLabel: '失败' });

describe('canRetryAuditAction（可重试 action 白名单）', () => {
  it('fetch / pull / push / checkout / init → 可重试', () => {
    for (const a of ['fetch', 'pull', 'push', 'checkout', 'init']) {
      expect(canRetryAuditAction(a)).toBe(true);
    }
  });
  it('clone → 不可重试（目标目录已非空，原地重试必失败）', () => {
    expect(canRetryAuditAction('clone')).toBe(false);
  });
  it('branch（只读列表，网关不记审计）/ unknown → 不可重试', () => {
    expect(canRetryAuditAction('branch')).toBe(false);
    expect(canRetryAuditAction('unknown')).toBe(false);
  });
  it('null / undefined / 空串 → 不可重试', () => {
    expect(canRetryAuditAction(null)).toBe(false);
    expect(canRetryAuditAction(undefined)).toBe(false);
    expect(canRetryAuditAction('')).toBe(false);
  });
});

describe('retryAuditLabel（重试按钮文案）', () => {
  it('checkout → 重试切换 / init → 重试新建 / 其余 → 重试', () => {
    expect(retryAuditLabel('checkout')).toBe('重试切换');
    expect(retryAuditLabel('init')).toBe('重试新建');
    expect(retryAuditLabel('fetch')).toBe('重试');
    expect(retryAuditLabel('pull')).toBe('重试');
    expect(retryAuditLabel(null)).toBe('重试');
  });
});

describe('retryAuditArgs（按 action 还原入参）', () => {
  it('fetch / pull / push → 空对象（网关无入参）', () => {
    expect(retryAuditArgs(fetchFailed)).toEqual({});
    expect(retryAuditArgs(pullFailed)).toEqual({});
    expect(retryAuditArgs(pushFailed)).toEqual({});
  });
  it('checkout → { branch }；缺 branch → null', () => {
    expect(retryAuditArgs(checkoutFailed)).toEqual({ branch: 'feature/x' });
    expect(retryAuditArgs(checkoutNoBranch)).toBeNull();
  });
  it('init → { dir }；缺 dir → null', () => {
    expect(retryAuditArgs(initFailed)).toEqual({ dir: 'D:/Work/new-repo' });
    expect(retryAuditArgs(initNoDir)).toBeNull();
  });
});

describe('retryAuditParams（可执行的重试参数）', () => {
  it('fetch / pull / push → root + action + 空 args', () => {
    expect(retryAuditParams(fetchFailed)).toEqual({ root: 'D:/Work/x', action: 'fetch', args: {} });
    expect(retryAuditParams(pullFailed)).toEqual({ root: 'D:/Work/x', action: 'pull', args: {} });
    expect(retryAuditParams(pushFailed)).toEqual({ root: 'D:/Work/x', action: 'push', args: {} });
  });
  it('checkout / init → 带还原入参', () => {
    expect(retryAuditParams(checkoutFailed)).toEqual({ root: 'D:/Work/x', action: 'checkout', args: { branch: 'feature/x' } });
    expect(retryAuditParams(initFailed)).toEqual({ root: 'D:/Work/x', action: 'init', args: { dir: 'D:/Work/new-repo' } });
  });
  it('clone / branch / unknown → null（白名单外）', () => {
    expect(retryAuditParams(cloneFailed)).toBeNull();
    expect(retryAuditParams(branchEntry)).toBeNull();
    expect(retryAuditParams(unknownEntry)).toBeNull();
  });
  it('缺 root → null（即使 action 可重试）', () => {
    expect(retryAuditParams(entry({ root: null, action: 'fetch', ok: false, okLabel: '失败' }))).toBeNull();
  });
  it('缺关键参数（checkout 无 branch / init 无 dir）→ null', () => {
    expect(retryAuditParams(checkoutNoBranch)).toBeNull();
    expect(retryAuditParams(initNoDir)).toBeNull();
  });
});

describe('retryAuditTitle（重试 tooltip）', () => {
  it('缺 root → 说明无法重试', () => {
    expect(retryAuditTitle(entry({ root: null, action: 'fetch', ok: false, okLabel: '失败' }))).toContain('无仓库根记录');
  });
  it('clone → 说明原地重试必失败', () => {
    expect(retryAuditTitle(cloneFailed)).toContain('目标目录已非空');
  });
  it('checkout 缺 branch / init 缺 dir → 缺参说明', () => {
    expect(retryAuditTitle(checkoutNoBranch)).toContain('缺分支参数');
    expect(retryAuditTitle(initNoDir)).toContain('缺目标目录参数');
  });
  it('可重试 → 注明按原仓库重试哪个操作', () => {
    expect(retryAuditTitle(pullFailed)).toContain('D:/Work/x');
    expect(retryAuditTitle(pullFailed)).toContain('同步远端');
  });
});
