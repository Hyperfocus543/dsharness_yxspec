// =============================================================================
// M5 产物图谱 - 图构建工具
// 输入：STAGE_TABLE（阶段关系）+ StageStatus（阶段状态/产物存在性）
// 输出：React Flow 的 nodes + edges，带分层布局（按 group 分列）
//
// 布局策略（避免引入 dagre，用固定列布局）：
//   - 列 = group（ACQ/SYS/HWE/SWE/SQT/COMP/REL）
//   - 行 = 组内阶段顺序（按 order）
//   - 同列内竖直排列，边从 source 到 target
// React Flow 节点为 { id, type, position, data }
// =============================================================================

import type { Node, Edge } from '@xyflow/react';
import { STAGE_TABLE, STAGE_ORDER } from '../data/stage-mapping';
import { ARTIFACT_NODE_META } from '../data/artifact-map';
import type { StageStatus, StageToken } from '../data/types';

// 每列宽度 + 每行高度（像素）
const COL_GAP = 240;
const ROW_GAP = 76;
const NODE_W = 200;
const NODE_H = 54;

// 节点数据（自定义，传给自绘节点组件）
// React Flow v12 要求 data 类型满足 Record<string, unknown> 约束
export interface ArtifactNodeData extends Record<string, unknown> {
  stage: StageToken;
  label: string;
  displayFile: string;
  status: StageStatus['status'];
  artifactCount: number;
  isCoding: boolean;
  missing: boolean;
}

const GROUP_ORDER = ['ACQ', 'SYS', 'HWE', 'SWE', 'SQT', 'COMP', 'REL'] as const;
type GroupKey = (typeof GROUP_ORDER)[number];

/** 依据阶段状态判定节点"是否缺失产物" */
function nodeMissing(st: StageStatus | undefined): boolean {
  if (!st) return true;
  // pending 且产物数为 0 → 缺失
  if (st.status === 'pending') return (st.artifacts?.length || 0) === 0;
  if (st.status === 'blocked' || st.status === 'stale') return true;
  return false;
}

/** 构建 React Flow nodes（含分层坐标）*/
export function buildArtifactNodes(stages: Record<StageToken, StageStatus>): Node<ArtifactNodeData>[] {
  const nodes: Node<ArtifactNodeData>[] = [];
  // 每个 group 一个列索引
  const colIndex: Record<string, number> = {};
  GROUP_ORDER.forEach((g, i) => (colIndex[g] = i));

  // 同组内每个 token 的行计数（按出现顺序）
  const rowClock: Record<string, number> = {};

  for (const token of STAGE_ORDER) {
    const m = STAGE_TABLE[token];
    const meta = ARTIFACT_NODE_META[token];
    const status = stages[token];
    const group = m.group as GroupKey;

    const row = rowClock[group] ?? 0;
    rowClock[group] = row + 1;

    const x = 40 + colIndex[group] * COL_GAP;
    const y = 40 + row * ROW_GAP;

    nodes.push({
      id: token,
      type: 'artifact',
      position: { x, y },
      data: {
        stage: token,
        label: meta?.label || m.command_name,
        displayFile: meta?.displayFile || m.spec_globs[0] || '',
        status: status?.status || 'pending',
        artifactCount: status?.artifacts?.length || 0,
        isCoding: meta?.isCoding || false,
        missing: nodeMissing(status),
      },
    });
  }
  return nodes;
}

/** 构建 React Flow edges（阶段间依赖）*/
export function buildArtifactEdges(): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const token of STAGE_ORDER) {
    const m = STAGE_TABLE[token];
    for (const up of m.upstream) {
      const key = `${up}->${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        id: key,
        source: up,
        target: token,
      });
    }
  }
  return edges;
}

/** 统计产物图谱概览（图例用）*/
export function artifactOverview(
  stages: Record<StageToken, StageStatus>,
): { total: number; existing: number; missing: number } {
  let existing = 0;
  let missing = 0;
  for (const token of STAGE_ORDER) {
    const st = stages[token];
    if (nodeMissing(st)) missing++;
    else existing++;
  }
  return { total: STAGE_ORDER.length, existing, missing };
}

export { GROUP_ORDER };
export type { GroupKey };
export const LAYOUT = { COL_GAP, ROW_GAP, NODE_W, NODE_H };