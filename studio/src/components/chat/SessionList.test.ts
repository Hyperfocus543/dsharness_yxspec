// @vitest-environment node
// =============================================================================
// SessionList.recentSessions 纯逻辑单测
// 只测无 DOM 的导出函数：最近 N 个会话裁剪 + 当前会话置顶。
// 不渲染组件（vitest 默认 node 环境，无 jsdom）。
// =============================================================================

import { describe, it, expect } from 'vitest';
import { recentSessions } from './SessionList';
import type { ChatSession } from '../../store/chatStore';

function mk(id: string, updatedAt: string): ChatSession {
  return {
    id,
    title: `会话 ${id}`,
    createdAt: '2026-08-20T00:00:00Z',
    updatedAt,
    messages: [],
  };
}

const a = mk('a', '2026-08-27T10:00:00Z');
const b = mk('b', '2026-08-27T09:00:00Z');
const c = mk('c', '2026-08-27T08:00:00Z');
const d = mk('d', '2026-08-27T07:00:00Z');
const e = mk('e', '2026-08-27T06:00:00Z');
const f = mk('f', '2026-08-27T05:00:00Z');

describe('recentSessions（最近会话快切）', () => {
  it('按 updatedAt 倒序取最近 5 个', () => {
    const recents = recentSessions([a, b, c, d, e, f], null, 5);
    expect(recents.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('当前会话置顶，其余按时间紧随', () => {
    const recents = recentSessions([a, b, c, d, e, f], 'c', 5);
    expect(recents.map((s) => s.id)).toEqual(['c', 'a', 'b', 'd', 'e']);
  });

  it('无 currentId 时不重复置顶', () => {
    const recents = recentSessions([a, b, c], null, 5);
    expect(recents.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('不足 5 个时全部返回（不补位）', () => {
    const recents = recentSessions([a, b], 'b', 5);
    expect(recents.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('乱序输入也能排序（store 未维护顺序时防御）', () => {
    const recents = recentSessions([d, a, f, c, b, e], 'f', 3);
    expect(recents.map((s) => s.id)).toEqual(['f', 'a', 'b']);
  });
});
