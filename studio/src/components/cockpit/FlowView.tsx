// =============================================================================
// FlowView — 驾驶舱「流向视图」（合并自原产物图谱卡）
// 把 25 阶段产物链画成 React Flow 图，节点颜色表达状态：
//   绿=齐全 / 黄=待审 / 红=缺失 / 灰=未开始 / 蓝=推进中
// 与网格视图共享同一数据源（stageStore.stages），点击节点 → 打开产物详情抽屉
// （不再自带右侧详情面板，避免与 ArtifactDrawer 重复）。
// =============================================================================

import React from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  buildArtifactNodes,
  buildArtifactEdges,
  artifactOverview,
  LAYOUT,
} from '../../utils/artifactGraph';
import { useStageStore } from '../../store/stageStore';
import type { ArtifactNodeData } from '../../utils/artifactGraph';

// 节点背景色（按阶段状态）— 浅色主题
const STATUS_FILL: Record<string, string> = {
  completed: '#DCFCE7', // 绿
  in_progress: '#DBEAFE', // 蓝
  pending_review: '#FEF9C3', // 黄
  rejected: '#FEE2E2', // 红
  stale: '#FFEDD5', // 橙
  blocked: '#FECACA', // 红
  pending: '#F3F4F6', // 灰
};
const STATUS_STROKE: Record<string, string> = {
  completed: '#16A34A',
  in_progress: '#2563EB',
  pending_review: '#D97706',
  rejected: '#DC2626',
  stale: '#EA580C',
  blocked: '#DC2626',
  pending: '#9CA3AF',
};

const MISSING = '#F87171'; // 缺失红高亮

type FlowNode = Node<ArtifactNodeData>;

/** 自定义节点卡片：data 已是 ArtifactNodeData */
const FlowNodeCard = ({ data }: { data: ArtifactNodeData }) => {
  const missing = !!data.missing;
  const fill = missing && data.status !== 'blocked' ? MISSING : STATUS_FILL[data.status] || '#F3F4F6';
  const stroke = missing && data.status !== 'blocked' ? '#B91C1C' : STATUS_STROKE[data.status] || '#9CA3AF';

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div
        className="rounded-lg px-3 py-2 border-2 shadow-sm text-xs cursor-pointer"
        style={{ background: fill, borderColor: stroke, width: LAYOUT.NODE_W - 12 }}
        title={data.displayFile}
      >
        <div className="font-semibold flex items-center justify-between gap-1">
          <span className="truncate">{data.label}</span>
          {missing ? (
            <span className="text-red-800 font-bold">✗</span>
          ) : data.artifactCount > 0 ? (
            <span className="text-green-900 font-bold">✓</span>
          ) : null}
        </div>
        <div className="text-[11px] text-gray-700 font-mono truncate mt-0.5 opacity-80">
          {data.displayFile}
        </div>
        <div className="text-[11px] text-gray-600 mt-0.5">
          {data.status}
          {data.artifactCount > 0 ? ` · ${data.artifactCount}项` : ''}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </>
  );
};

const nodeTypes = { artifact: FlowNodeCard } as unknown as Parameters<typeof ReactFlow>[0]['nodeTypes'];

interface FlowViewProps {
  onSelectStage?: (token: string) => void;
}

export const FlowView: React.FC<FlowViewProps> = ({ onSelectStage }) => {
  const stages = useStageStore((s) => s.stages);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(
    buildArtifactNodes(stages) as FlowNode[],
  );
  const [edges, setEdges] = useEdgesState(buildArtifactEdges());

  React.useEffect(() => {
    setNodes(buildArtifactNodes(stages) as FlowNode[]);
  }, [stages]);

  const overview = React.useMemo(() => artifactOverview(stages), [stages]);

  return (
    <div className="flex flex-col h-[calc(100vh-300px)] min-h-[460px] border rounded bg-gray-50 relative">
      {/* 图例 + 概览 */}
      <div className="absolute top-2 left-2 z-10 bg-white border rounded px-3 py-2 shadow-sm text-xs space-y-1.5">
        <div className="font-semibold">产物流向 · 全流程</div>
        <div className="flex items-center gap-2 flex-wrap">
          <Legend color="#DCFCE7" border="#16A34A" label="齐全" />
          <Legend color="#FEF9C3" border="#D97706" label="待审" />
          <Legend color="#F87171" border="#B91C1C" label="缺失" />
          <Legend color="#F3F4F6" border="#9CA3AF" label="未开始" />
          <Legend color="#DBEAFE" border="#2563EB" label="推进中" />
        </div>
        <div className="flex items-center gap-3 text-gray-500">
          <span>
            总数 <b className="text-gray-800">{overview.total}</b>
          </span>
          <span>
            齐全 <b className="text-green-600">{overview.existing}</b>
          </span>
          <span>
            缺失 <b className="text-red-600">{overview.missing}</b>
          </span>
          <span className="text-gray-400">点击节点查看产物详情</span>
        </div>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        onNodeClick={(_, node) => {
          const data = (node as unknown as FlowNode).data;
          if (data?.stage) onSelectStage?.(data.stage);
        }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: '#94A3B8', strokeWidth: 1.5 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#CBD5E1" gap={20} />
        <Controls />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const d = n.data as unknown as ArtifactNodeData;
            return d?.missing ? '#F87171' : STATUS_FILL[d?.status] || '#F3F4F6';
          }}
        />
      </ReactFlow>
    </div>
  );
};

const Legend: React.FC<{ color: string; border: string; label: string }> = ({ color, border, label }) => (
  <span className="inline-flex items-center gap-1">
    <span className="inline-block w-3 h-3 rounded border" style={{ background: color, borderColor: border }} />
    {label}
  </span>
);
