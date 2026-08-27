// =============================================================================
// FlowView — 驾驶舱「流向视图」（合并自原产物图谱卡）
// 把 25 阶段产物链画成 React Flow 图，节点颜色表达状态：
//   绿=齐全 / 黄=待审 / 红=缺失 / 灰=未开始 / 琥珀=推进中
// 与网格视图共享同一数据源（stageStore.stages），点击节点 → 打开产物详情抽屉
// （不再自带右侧详情面板，避免与 ArtifactDrawer 重复）。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
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
import { Icon } from '../ui';
import { I } from '../ui/icons';

// 节点背景色（按阶段状态）— Claude 暖系语义色（对齐 tailwind.config 的 cockpit.* token）
// completed= sage 暖绿（柔和，区别于阻塞绯红）；in_progress=琥珀；blocked/rejected=暖绯
const STATUS_FILL: Record<string, string> = {
  completed: '#f3f6ed', // sage 50 暖绿浅底（淡、不乍眼）
  in_progress: '#FEF3C7', // 琥珀 amber-100
  pending_review: '#FFEDD5', // 橙 orange-100
  rejected: '#F6D3D1', // 暖绯 red-100
  stale: '#F3E8FF', // 紫 purple-100
  blocked: '#f6d3d1', // 暖绯 red-100（浅，避免刺眼）
  pending: '#F5F4ED', // 羊皮纸 Parchment
};
const STATUS_STROKE: Record<string, string> = {
  completed: '#aebe8f', // sage 300 柔暖绿描边（淡）
  in_progress: '#D97706',
  pending_review: '#EA580C',
  rejected: '#B53333', // Crimson
  stale: '#9333EA',
  blocked: '#b53333', // Crimson 暖绯（与 sage 拉开）
  pending: '#DED9CC', // Ring Warm
};

const MISSING = '#E98468'; // 缺失 Coral 高亮

type FlowNode = Node<ArtifactNodeData>;

/** 自定义节点卡片：data 已是 ArtifactNodeData */
const FlowNodeCard = ({ data }: { data: ArtifactNodeData }) => {
  const missing = !!data.missing;
  const fill = missing && data.status !== 'blocked' ? MISSING : STATUS_FILL[data.status] || '#F5F4ED';
  const stroke = missing && data.status !== 'blocked' ? '#C96442' : STATUS_STROKE[data.status] || '#DED9CC';

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
            <span className="text-red-800">
              <Icon name={I.xCircle} size={14} weight="bold" />
            </span>
          ) : data.artifactCount > 0 ? (
            <span className="text-sage-700">
              <Icon name={I.checkCircle} size={14} weight="bold" />
            </span>
          ) : null}
        </div>
        <div className="text-xs text-zinc-700 font-mono truncate mt-0.5 opacity-80">
          {data.displayFile}
        </div>
        <div className="text-xs text-zinc-600 mt-0.5">
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
    <div className="flex flex-col h-[calc(100vh-300px)] min-h-[460px] border rounded bg-zinc-50 relative">
      {/* 图例 + 概览 */}
      <div className="absolute top-2 left-2 z-10 bg-white border border-zinc-200 rounded px-3 py-2 shadow-sm text-xs space-y-1.5">
        <div className="font-semibold text-zinc-700">产物流向 · 全流程</div>
        <div className="flex items-center gap-2 flex-wrap">
          <Legend color="#f3f6ed" border="#aebe8f" label="齐全" />
          <Legend color="#FFEDD5" border="#EA580C" label="待审" />
          <Legend color="#E98468" border="#C96442" label="缺失" />
          <Legend color="#F5F4ED" border="#DED9CC" label="未开始" />
          <Legend color="#FEF3C7" border="#D97706" label="推进中" />
        </div>
        <div className="flex items-center gap-3 text-zinc-500">
          <span>
            总数 <b className="text-zinc-800">{overview.total}</b>
          </span>
          <span>
            齐全 <b className="text-sage-700">{overview.existing}</b>
          </span>
          <span>
            缺失 <b className="text-red-600">{overview.missing}</b>
          </span>
          <span className="text-zinc-400">点击节点查看产物详情</span>
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
          style: { stroke: '#DED9CC', strokeWidth: 1.5 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#E8E6DC" gap={20} />
        <Controls />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const d = n.data as unknown as ArtifactNodeData;
            return d?.missing ? '#E98468' : STATUS_FILL[d?.status] || '#F5F4ED';
          }}
        />
      </ReactFlow>
    </div>
  );
};

const Legend: React.FC<{ color: string; border: string; label: string }> = ({ color, border, label }) => (
  <span className="inline-flex items-center gap-1 text-zinc-600">
    <span className="inline-block w-3 h-3 rounded border" style={{ background: color, borderColor: border }} />
    {label}
  </span>
);
