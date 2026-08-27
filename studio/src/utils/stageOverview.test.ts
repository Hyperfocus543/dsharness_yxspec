// @vitest-environment node
// =============================================================================
// stageOverview.ts 纯逻辑单测（阶段概览导出）
// 只测无 DOM 的导出函数：状态汇总 + 概览 Markdown 组装。
// 不渲染组件（vitest 默认 node 环境，无 jsdom）。
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  summarizeStages,
  buildOverviewRows,
  buildStageOverview,
  OVERVIEW_STATUS_LABEL,
} from './stageOverview';
import type { StageStatus } from '../data/types';

function mkStage(token: string, status: string, artifactsCount?: number): StageStatus {
  return {
    token: token as any,
    status: status as any,
    artifacts: [],
    review: null,
    last_update: '',
    message: '',
    // 缺省时不写 artifacts_count（保持 undefined，让回退逻辑生效）
    ...(artifactsCount !== undefined ? { artifacts_count: artifactsCount } : {}),
  };
}

describe('summarizeStages（概览汇总）', () => {
  it('空 stages 全部按未开始计（不误报进度）', () => {
    const s = summarizeStages({});
    expect(s.done).toBe(0);
    expect(s.total).toBeGreaterThan(20);
    expect(s.pct).toBe(0);
    expect(s.blocked).toBe(0);
  });

  it('完成/进行中/待审查/阻塞分别计数', () => {
    const stages = {
      init: mkStage('init', 'completed', 3),
      sys_elicitation: mkStage('sys_elicitation', 'in_progress', 2),
      sys_analysis: mkStage('sys_analysis', 'pending_review', 1),
      sys_arch: mkStage('sys_arch', 'blocked', 0),
      hwe_analysis: mkStage('hwe_analysis', 'completed', 4),
    };
    const s = summarizeStages(stages);
    expect(s.done).toBe(2);
    expect(s.inProgress).toBe(1);
    expect(s.pendingReview).toBe(1);
    expect(s.blocked).toBe(1);
    expect(s.artifacts).toBe(10);
    expect(s.total).toBeGreaterThan(20); // 其余阶段按 pending 计
  });

  it('pct 四舍五入到整数', () => {
    const stages: Record<string, StageStatus> = {};
    // 构造 1/4 完成（STAGE_ORDER 25+ 阶段 → 约 4%）
    stages.sys_elicitation = mkStage('sys_elicitation', 'completed');
    const s = summarizeStages(stages);
    expect(s.done).toBe(1);
    expect(s.pct).toBe(Math.round((1 / s.total) * 100));
  });
});

describe('buildOverviewRows（概览明细行）', () => {
  it('按 STAGE_ORDER 序输出全阶段，缺失阶段按未开始', () => {
    const rows = buildOverviewRows({});
    expect(rows.length).toBeGreaterThan(20);
    expect(rows[0].token).toBe('init');
    expect(rows[0].statusLabel).toBe(OVERVIEW_STATUS_LABEL.pending);
    expect(rows[0].artifacts).toBe(0);
  });

  it('产物数优先 artifacts_count，回退 artifacts.length', () => {
    const stages = {
      init: { ...mkStage('init', 'completed', 5), artifacts: ['a.md', 'b.md'] },
      // artifacts_count 缺省（undefined）→ 回退数组长度
      sys_elicitation: { ...mkStage('sys_elicitation', 'pending'), artifacts: ['a.md', 'b.md', 'c.md'] },
    };
    const rows = buildOverviewRows(stages);
    const init = rows.find((r) => r.token === 'init');
    const sys = rows.find((r) => r.token === 'sys_elicitation');
    expect(init?.artifacts).toBe(5); // 有 counts 用 counts
    expect(sys?.artifacts).toBe(3); // 无 counts 用数组长度
  });
});

describe('buildStageOverview（概览 Markdown）', () => {
  const stages: Record<string, StageStatus> = {
    init: mkStage('init', 'completed', 3),
    sys_elicitation: mkStage('sys_elicitation', 'in_progress', 2),
  };

  it('头部含项目代号/当前阶段/整体进度/状态分布/产物总数', () => {
    const md = buildStageOverview(stages, 'sys_elicitation', { specId: 'TEST-01' });
    expect(md).toContain('# YXSpec 阶段概览');
    expect(md).toContain('项目代号：TEST-01');
    expect(md).toContain('当前阶段：sys_elicitation（SYS.1）');
    expect(md).toContain('整体进度：1/');
    expect(md).toContain('状态分布：进行中 1 · 待审查 0 · 阻塞 0');
    expect(md).toContain('产物总数：5');
  });

  it('明细表含表头与全部阶段行', () => {
    const md = buildStageOverview(stages, null);
    expect(md).toContain('| 阶段 | ASPICE | 状态 | 产物 |');
    expect(md).toContain('| init | ACQ.4 | 已完成 | 3 |');
    expect(md).toContain('| sys_elicitation | SYS.1 | 进行中 | 2 |');
  });

  it('无 specId 时不输出项目代号行', () => {
    const md = buildStageOverview(stages, null);
    expect(md).not.toContain('项目代号');
  });

  it('无当前阶段时省略当前阶段行', () => {
    const md = buildStageOverview(stages, null);
    expect(md).not.toContain('当前阶段');
  });
});
