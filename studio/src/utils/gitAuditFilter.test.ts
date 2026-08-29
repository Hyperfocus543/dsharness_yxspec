// @vitest-environment node
// =============================================================================
// gitAuditFilter.ts 纯逻辑单测（git 写操作留痕「仅失败」过滤）
// 只测无 DOM 的导出函数。与 traceFilters.test.ts / gitTrace.test.ts 同款 test 文件约定。
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  isAuditFailure,
  auditFailureCount,
  filterAuditEntries,
} from './gitAuditFilter';
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

const okEntry = entry({ at: 1000, action: 'fetch', ok: true, okLabel: '成功' });
const failedEntry = entry({ at: 2000, action: 'pull', ok: false, okLabel: '失败', error: 'git pull 执行失败' });
const unknownEntry = entry({ at: 3000, action: 'checkout', okLabel: '未确认' }); // ok 缺失
const cloneFailed = entry({ at: 4000, action: 'clone', ok: false, okLabel: '失败', error: 'git clone 执行失败' });

const ENTRIES = [cloneFailed, unknownEntry, failedEntry, okEntry]; // 时间倒序

describe('isAuditFailure（失败判定：仅显式 ok===false）', () => {
  it('ok === false → 失败', () => {
    expect(isAuditFailure(failedEntry)).toBe(true);
    expect(isAuditFailure(cloneFailed)).toBe(true);
  });
  it('ok === true → 不算失败', () => {
    expect(isAuditFailure(okEntry)).toBe(false);
  });
  it('ok 缺失（未确认）→ 不算失败（成败未知不误报）', () => {
    expect(isAuditFailure(unknownEntry)).toBe(false);
  });
  it('null / undefined / 缺字段 → 不算失败', () => {
    expect(isAuditFailure(null)).toBe(false);
    expect(isAuditFailure(undefined)).toBe(false);
  });
});

describe('auditFailureCount（失败条数）', () => {
  it('统计 ok===false 的条数', () => {
    expect(auditFailureCount(ENTRIES)).toBe(2); // cloneFailed + failedEntry
  });
  it('空 / null / undefined → 0', () => {
    expect(auditFailureCount([])).toBe(0);
    expect(auditFailureCount(null)).toBe(0);
    expect(auditFailureCount(undefined)).toBe(0);
  });
});

describe('filterAuditEntries（仅失败过滤）', () => {
  it('onlyFailed=true → 只留 ok===false，保持时间倒序', () => {
    expect(filterAuditEntries(ENTRIES, { onlyFailed: true })).toEqual([cloneFailed, failedEntry]);
  });
  it('onlyFailed=false / 缺省 → 原样返回', () => {
    expect(filterAuditEntries(ENTRIES, {})).toEqual(ENTRIES);
    expect(filterAuditEntries(ENTRIES, { onlyFailed: false })).toEqual(ENTRIES);
    expect(filterAuditEntries(ENTRIES)).toEqual(ENTRIES);
  });
  it('无失败 → 过滤后空数组（不误报成「暂无留痕」以外的状态）', () => {
    expect(filterAuditEntries([okEntry, unknownEntry], { onlyFailed: true })).toEqual([]);
  });
  it('空 / 缺省输入 → 空数组', () => {
    expect(filterAuditEntries(null, { onlyFailed: true })).toEqual([]);
    expect(filterAuditEntries(undefined, {})).toEqual([]);
  });
});
