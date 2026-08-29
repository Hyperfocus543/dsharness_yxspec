// @vitest-environment node
// =============================================================================
// traceFilters.ts 纯逻辑单测（全局轨迹时间轴过滤）
// 只测无 DOM 的导出函数 filterTraceRows / isFailureRow / isCheckpointRow /
// matchesTraceText。不渲染组件、不连网关。
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  filterTraceRows,
  isFailureRow,
  isCheckpointRow,
  matchesTraceText,
} from './traceFilters';
import type { TrajectoryAllEntry } from './ipc';

function row(partial: Partial<TrajectoryAllEntry> & { stage: string; seq: number; startedAt: number }): TrajectoryAllEntry {
  return {
    sessionId: 's',
    status: 'passed',
    finishedAt: null,
    stageLabel: partial.stage,
    aspice: '',
    command: '',
    group: '',
    ...partial,
  } as TrajectoryAllEntry;
}

const passedPlain = row({ stage: 'swe_coding', seq: 1, startedAt: 1000, status: 'passed' });
const passedTagged = row({ stage: 'swe_coding', seq: 2, startedAt: 2000, status: 'passed', tag: 'yxspec/swe_coding/2', commit: 'abc1234', commitFull: 'abc1234'.padEnd(40, '0') });
const failedPlain = row({ stage: 'swe_arch', seq: 3, startedAt: 3000, status: 'failed', commit: 'def5678' });
const blockedTagged = row({ stage: 'swe_arch', seq: 4, startedAt: 4000, status: 'blocked', tag: 'yxspec/swe_arch/4' });
const rolledBackTagged = row({ stage: 'swe_coding', seq: 5, startedAt: 5000, status: 'passed', tag: 'yxspec/swe_coding/5', rolled_back: true });

const ROWS = [rolledBackTagged, blockedTagged, failedPlain, passedTagged, passedPlain]; // 时间降序

describe('isFailureRow（失败/打回/已回滚）', () => {
  it('failed / blocked / rolled_back → 真', () => {
    expect(isFailureRow(failedPlain)).toBe(true);
    expect(isFailureRow(blockedTagged)).toBe(true);
    expect(isFailureRow(rolledBackTagged)).toBe(true);
  });
  it('正常通过 → 假', () => {
    expect(isFailureRow(passedPlain)).toBe(false);
    expect(isFailureRow(passedTagged)).toBe(false);
  });
});

describe('isCheckpointRow（打 tag 检查点）', () => {
  it('tag 非空 → 真', () => {
    expect(isCheckpointRow(passedTagged)).toBe(true);
    expect(isCheckpointRow(blockedTagged)).toBe(true);
  });
  it('无 tag / tag 为空串 / 缺字段 → 假', () => {
    expect(isCheckpointRow(passedPlain)).toBe(false);
    expect(isCheckpointRow(failedPlain)).toBe(false);
    expect(isCheckpointRow({ ...passedPlain, tag: '' })).toBe(false);
  });
});

describe('matchesTraceText（阶段/命令/状态/commit/tag 子串）', () => {
  it('空查询 → 全部保留', () => {
    expect(matchesTraceText(passedTagged, '')).toBe(true);
    expect(matchesTraceText(passedTagged, '   ')).toBe(true);
  });
  it('阶段 token / 状态 / commit 前缀 / tag 序号命中', () => {
    expect(matchesTraceText(passedTagged, 'swe_coding')).toBe(true);
    expect(matchesTraceText(blockedTagged, 'BLOCKED')).toBe(true); // 大小写不敏感
    expect(matchesTraceText(failedPlain, 'def567')).toBe(true);
    expect(matchesTraceText(passedTagged, 'yxspec/swe_coding/2')).toBe(true);
    expect(matchesTraceText(passedTagged, '/2')).toBe(true);
  });
  it('不命中 → 假', () => {
    expect(matchesTraceText(passedPlain, 'swe_arch')).toBe(false);
    expect(matchesTraceText(passedTagged, 'nothing')).toBe(false);
  });
});

describe('filterTraceRows（failed/tagged 二选一 + 文本叠加）', () => {
  it('仅失败：只留失败/打回/已回滚', () => {
    const r = filterTraceRows(ROWS, { onlyFailed: true });
    expect(r).toEqual([rolledBackTagged, blockedTagged, failedPlain]);
  });
  it('仅检查点：只留打 tag 行（含打回的 tag 检查点）', () => {
    const r = filterTraceRows(ROWS, { onlyTagged: true });
    expect(r).toEqual([rolledBackTagged, blockedTagged, passedTagged]);
  });
  it('仅检查点且仅失败互斥：tagged 优先', () => {
    const r = filterTraceRows(ROWS, { onlyFailed: true, onlyTagged: true });
    expect(r).toEqual([rolledBackTagged, blockedTagged, passedTagged]);
  });
  it('文本过滤叠加：tagged + 子串 / failed + 子串', () => {
    const taggedWithText = filterTraceRows(ROWS, { onlyTagged: true, text: 'swe_coding' });
    expect(taggedWithText).toEqual([rolledBackTagged, passedTagged]);
    const failedWithText = filterTraceRows(ROWS, { onlyFailed: true, text: 'arch' });
    expect(failedWithText).toEqual([blockedTagged, failedPlain]);
  });
  it('无匹配 → 空数组（不误报）', () => {
    expect(filterTraceRows(ROWS, { onlyTagged: true, text: 'zzz' })).toEqual([]);
    expect(filterTraceRows(ROWS, { text: 'zzz' })).toEqual([]);
  });
  it('空/缺省输入 → 原样返回（保持顺序）', () => {
    expect(filterTraceRows(ROWS, {})).toEqual(ROWS);
    expect(filterTraceRows(null, {})).toEqual([]);
    expect(filterTraceRows(undefined, { onlyFailed: true })).toEqual([]);
  });
});
