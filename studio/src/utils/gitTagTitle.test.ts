// @vitest-environment node
// =============================================================================
// gitTagTitle.ts 纯逻辑单测（tag 徽标 tooltip 派生 + 兼容归一）
// 只测无 DOM 的导出函数 toGitTagInfo / gitTagTitle。不渲染组件、不连网关。
// =============================================================================

import { describe, it, expect } from 'vitest';
import { toGitTagInfo, gitTagTitle } from './gitTagTitle';
import type { GitTagInfo } from './ipc';

const TAG: GitTagInfo = {
  name: 'v1.0',
  commit: 'c3ef981c13968500843d78982364f5544765245f',
  commitShort: 'c3ef981',
  subject: 'second commit',
  commitAt: '2026-08-30T08:16:12+08:00',
};

describe('toGitTagInfo（兼容归一：字符串 / 对象 → GitTagInfo）', () => {
  it('对象 → 原样返回', () => {
    expect(toGitTagInfo(TAG)).toBe(TAG);
  });

  it('字符串（旧网关形态）→ name 兜底对象，commit/时间缺省', () => {
    expect(toGitTagInfo('v1.0')).toEqual({
      name: 'v1.0',
      commit: null,
      commitShort: null,
      subject: null,
      commitAt: null,
    });
  });

  it('字符串去空白 → 空 → null', () => {
    expect(toGitTagInfo('  ')).toBeNull();
  });

  it('null / undefined → null', () => {
    expect(toGitTagInfo(null)).toBeNull();
    expect(toGitTagInfo(undefined)).toBeNull();
  });

  it('非法对象（name 非字符串/空）→ null', () => {
    expect(toGitTagInfo({ name: '' } as unknown as GitTagInfo)).toBeNull();
    expect(toGitTagInfo({} as unknown as GitTagInfo)).toBeNull();
  });
});

describe('gitTagTitle（tag 徽标 tooltip）', () => {
  it('富格式 tag → 三行：commit + 提交说明 + 提交时间（含相对时间）', () => {
    const title = gitTagTitle(TAG);
    expect(title).toContain(`commit：${TAG.commit}`);
    expect(title).toContain(`提交说明：${TAG.subject}`);
    expect(title).toContain('提交时间：');
    expect(title).toContain('（');
  });

  it('字符串形态（旧网关）→ 降级提示', () => {
    expect(gitTagTitle('v1.0')).toBe('轻量 tag（旧网关：无 commit/时间信息）');
  });

  it('对象无 commit/时间 → 中性降级提示', () => {
    expect(gitTagTitle({ name: 't', commit: null, commitShort: null, subject: null, commitAt: null })).toBe(
      '轻量 tag（无 commit/时间信息）',
    );
  });

  it('有 commit 无 subject/时间 → 只列 commit', () => {
    const title = gitTagTitle({ name: 't', commit: 'abc123', commitShort: 'abc123', subject: null, commitAt: null });
    expect(title).toBe('commit：abc123');
  });

  it('null → null（调用方保持中性 tooltip）', () => {
    expect(gitTagTitle(null)).toBeNull();
  });
});
