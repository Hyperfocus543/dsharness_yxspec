// @vitest-environment node
// =============================================================================
// rerunTrajectory.ts 纯逻辑单测（全局轨迹行内「重跑」判定）
// 只测无 DOM 的导出函数。与 utils/gitBranches.test.ts 同款 test 文件约定。
// =============================================================================

import { describe, it, expect } from 'vitest';
import { canRerun, rerunCommandOf, rerunLabel } from './rerunTrajectory';
import type { TrajectoryAllEntry } from './ipc';

/** 构造一条轨迹行（默认 passed；字段按 TrajectoryAllEntry 最小集）。 */
function entry(partial: Partial<TrajectoryAllEntry> & { stage: string }): TrajectoryAllEntry {
  return {
    seq: 1,
    sessionId: 's',
    status: 'passed',
    startedAt: 0,
    finishedAt: 0,
    ...partial,
  } as TrajectoryAllEntry;
}

/** 与 STAGE_TABLE 同形的命令表（测试只放需要判定的阶段）。 */
const TABLE: Record<string, { command?: string }> = {
  'swe-coding-do-v2': { command: '/yxspec:swe-coding-do-v2' },
  init: { command: '/yxspec:init' },
  'no-cmd': {},
};

describe('rerunCommandOf（阶段 → 重跑命令）', () => {
  it('表内有该阶段 → 返回 trim 后的 slash 命令', () => {
    expect(rerunCommandOf(entry({ stage: 'swe-coding-do-v2' }), TABLE)).toBe('/yxspec:swe-coding-do-v2');
  });

  it('表内无该阶段 / 无 command → null', () => {
    expect(rerunCommandOf(entry({ stage: 'unknown' }), TABLE)).toBeNull();
    expect(rerunCommandOf(entry({ stage: 'no-cmd' }), TABLE)).toBeNull();
  });

  it('command 为空白串 → null（防御旧数据空命令）', () => {
    const t = { 'x': { command: '   ' } };
    expect(rerunCommandOf(entry({ stage: 'x' }), t)).toBeNull();
  });
});

describe('canRerun（是否渲染重跑按钮）', () => {
  it('失败/打回/已回滚 且有命令 → true', () => {
    expect(canRerun(entry({ stage: 'swe-coding-do-v2', status: 'failed' }), TABLE)).toBe(true);
    expect(canRerun(entry({ stage: 'swe-coding-do-v2', status: 'blocked' }), TABLE)).toBe(true);
    expect(canRerun(entry({ stage: 'swe-coding-do-v2', status: 'unverified', rolled_back: true }), TABLE)).toBe(true);
  });

  it('成功/未验证 无回滚 → false（成功无需重跑）', () => {
    expect(canRerun(entry({ stage: 'swe-coding-do-v2', status: 'passed' }), TABLE)).toBe(false);
    expect(canRerun(entry({ stage: 'swe-coding-do-v2', status: 'unverified' }), TABLE)).toBe(false);
  });

  it('失败但表内无命令 → false（gate 命令 / 老网关空命令不渲染）', () => {
    expect(canRerun(entry({ stage: 'unknown', status: 'failed' }), TABLE)).toBe(false);
    expect(canRerun(entry({ stage: 'no-cmd', status: 'failed' }), TABLE)).toBe(false);
  });

  it('null/缺 stage → false', () => {
    expect(canRerun(null as unknown as TrajectoryAllEntry, TABLE)).toBe(false);
    expect(canRerun({} as TrajectoryAllEntry, TABLE)).toBe(false);
  });
});

describe('rerunLabel', () => {
  it('失败/打回/已回滚 统一「重跑」（修复后重新执行）', () => {
    expect(rerunLabel(entry({ stage: 'swe-coding-do-v2', status: 'failed' }))).toBe('重跑');
    expect(rerunLabel(entry({ stage: 'swe-coding-do-v2', status: 'blocked', rolled_back: true }))).toBe('重跑');
  });
});
