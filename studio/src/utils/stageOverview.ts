// =============================================================================
// buildStageOverview — 阶段概览 Markdown 生成（纯函数，可单测）
// 数据源约定（与 ReportExport 共用同一套 stageStore 语义）：
//   - stages[token].status         驾驶舱 7 态（'pending' 兜底未开始）
//   - stages[token].artifacts_count 产物数（dsh_state 合并后的 counts）
//   - STAGE_TABLE[token].aspice     ASPICE 编号（人读定位）
//   - STAGE_ORDER                   阶段序（概览顺序 = 流程顺序）
// 生成结果供驾驶舱「复制概览」一键粘贴（周报/群里），无 DOM 依赖。
// UI 基线：design-taste skill — 纯文本 Markdown，无 emoji，表格+列表。
// =============================================================================

import type { StageStatus, StageToken } from '../data/types';
import { STAGE_ORDER, STAGE_TABLE } from '../data/stage-mapping';

/** 状态中文标签（与驾驶舱 STATUS_LABEL 语义一致） */
export const OVERVIEW_STATUS_LABEL: Record<string, string> = {
  completed: '已完成',
  in_progress: '进行中',
  pending: '未开始',
  pending_review: '待审查',
  rejected: '已驳回',
  blocked: '阻塞',
  stale: '过时',
};

/** 单阶段概览行 */
export interface StageOverviewRow {
  token: StageToken;
  aspice: string;
  status: string;
  statusLabel: string;
  artifacts: number;
}

/** 概览汇总 */
export interface StageOverviewSummary {
  done: number;
  total: number;
  pct: number;
  inProgress: number;
  pendingReview: number;
  blocked: number;
  artifacts: number;
}

/** 汇总各阶段状态（stages 缺失的阶段按未开始计） */
export function summarizeStages(
  stages: Record<StageToken, StageStatus> | Record<string, StageStatus>,
): StageOverviewSummary {
  const total = STAGE_ORDER.length;
  let done = 0;
  let inProgress = 0;
  let pendingReview = 0;
  let blocked = 0;
  let artifacts = 0;
  for (const token of STAGE_ORDER) {
    const s = stages[token];
    const status = s?.status || 'pending';
    if (status === 'completed') done++;
    else if (status === 'in_progress') inProgress++;
    else if (status === 'pending_review') pendingReview++;
    else if (status === 'blocked') blocked++;
    artifacts += s?.artifacts_count ?? s?.artifacts?.length ?? 0;
  }
  return {
    done,
    total,
    pct: total > 0 ? Math.round((done / total) * 100) : 0,
    inProgress,
    pendingReview,
    blocked,
    artifacts,
  };
}

/** 组装概览行（全阶段，含 pending 占位 —— 概览要让人看到全貌） */
export function buildOverviewRows(
  stages: Record<StageToken, StageStatus> | Record<string, StageStatus>,
): StageOverviewRow[] {
  return STAGE_ORDER.map((token) => {
    const s = stages[token];
    const status = s?.status || 'pending';
    return {
      token,
      aspice: STAGE_TABLE[token]?.aspice || '—',
      status,
      statusLabel: OVERVIEW_STATUS_LABEL[status] || '未开始',
      artifacts: s?.artifacts_count ?? s?.artifacts?.length ?? 0,
    };
  });
}

/**
 * 生成阶段概览 Markdown（含整体进度 + 状态分布 + 阶段明细表）。
 * specId 为空时省略项目代号行。
 */
export function buildStageOverview(
  stages: Record<StageToken, StageStatus> | Record<string, StageStatus>,
  currentStage: string | null,
  opts?: { specId?: string },
): string {
  const summary = summarizeStages(stages);
  const rows = buildOverviewRows(stages);
  const lines: string[] = [];
  lines.push('# YXSpec 阶段概览');
  if (opts?.specId) lines.push(`- 项目代号：${opts.specId}`);
  if (currentStage) {
    const m = STAGE_TABLE[currentStage as StageToken];
    lines.push(`- 当前阶段：${currentStage}${m?.aspice ? `（${m.aspice}）` : ''}`);
  }
  lines.push(`- 整体进度：${summary.done}/${summary.total}（${summary.pct}%）`);
  lines.push(
    `- 状态分布：进行中 ${summary.inProgress} · 待审查 ${summary.pendingReview} · 阻塞 ${summary.blocked}`,
  );
  lines.push(`- 产物总数：${summary.artifacts}`);
  lines.push('');
  lines.push('## 阶段明细');
  lines.push('');
  lines.push('| 阶段 | ASPICE | 状态 | 产物 |');
  lines.push('|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.token} | ${r.aspice} | ${r.statusLabel} | ${r.artifacts} |`);
  }
  return lines.join('\n');
}
