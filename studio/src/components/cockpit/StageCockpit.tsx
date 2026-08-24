// M1 流程驾驶舱 - 25 阶段全景 + 当前阶段 + 建议下一步
// 来自 build-spec §2.3 / §10.3 Step 8-10
// v2：网格/流向双视图（流向视图合并自原产物图谱卡）

import React from 'react';
import type { StageMapping, StageStatus } from '../../data/types';
import { STAGE_GROUPS, STAGE_ORDER, STAGE_TABLE } from '../../data/stage-mapping';
import { FlowView } from './FlowView';

const STATUS_COLOR: Record<string, string> = {
  completed: 'border-emerald-500 bg-emerald-50',
  in_progress: 'border-amber-500 bg-amber-50',
  pending: 'border-gray-300 bg-gray-50',
  pending_review: 'border-orange-400 bg-orange-50',
  rejected: 'border-red-500 bg-red-50',
  blocked: 'border-red-600 bg-red-100',
  stale: 'border-purple-500 bg-purple-50',
};

const STATUS_ICON: Record<string, string> = {
  completed: '✓',
  in_progress: '◐',
  pending: '○',
  pending_review: '⌛',
  rejected: '✗',
  blocked: '⊘',
  stale: '↻',
};

const GROUP_LABEL: Record<string, string> = {
  ACQ: 'ACQ.4',
  SYS: 'SYS.1-3',
  HWE: 'HWE.1',
  SWE: 'SWE.1-5',
  SQT: 'SYS.5/SUP.8',
  COMP: 'SUP.1-2',
  REL: 'SPL.2',
};

interface StageNodeProps {
  token: string;
  mapping: StageMapping;
  status: StageStatus;
  isCurrent: boolean;
}

export const StageNode: React.FC<StageNodeProps> = ({ token, mapping, status, isCurrent }) => {
  const color = STATUS_COLOR[status.status] || STATUS_COLOR.pending;
  const icon = STATUS_ICON[status.status] || STATUS_ICON.pending;

  return (
    <div
      className={`relative rounded-lg border-2 p-3 transition-all hover:shadow-md ${color} ${
        isCurrent ? 'ring-2 ring-blue-500 shadow-lg' : ''
      }`}
      title={`${mapping.aspice} - ${mapping.command}\n${status.message || ''}${
        status.gate_message ? `\n门控：${status.gate_message}` : ''
      }`}
    >
      {isCurrent && (
        <span className="absolute -top-2 -right-2 text-base" title="当前阶段">
          📍
        </span>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-gray-500">{mapping.aspice}</span>
        <span className="text-base">{icon}</span>
      </div>
      <div className="text-sm font-semibold mt-1 truncate" title={token}>
        {token}
      </div>
      <div className="text-xs text-gray-600 mt-1 truncate" title={mapping.command}>
        {mapping.command}
      </div>
      <div className="flex items-center justify-between mt-2 text-xs">
        <span className="text-gray-500">
          {status.artifacts_count !== undefined
            ? `${status.artifacts_count} 产物`
            : status.artifacts?.length
              ? `${status.artifacts.length} 产物`
              : '暂无产物'}
        </span>
        {status.review && (
          <span
            className={`px-1 rounded text-white text-[10px] ${
              status.review.verdict === 'approved'
                ? 'bg-emerald-500'
                : status.review.verdict === 'conditional'
                  ? 'bg-amber-500'
                  : 'bg-red-500'
            }`}
          >
            {status.review.verdict}
          </span>
        )}
      </div>
      {status.gate_message && (
        <div className="mt-2 text-[10px] leading-tight text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-1" title={status.gate_message}>
          🚧 {status.gate_message}
        </div>
      )}
    </div>
  );
};

interface CockpitProps {
  stages: Record<string, StageStatus>;
  currentStage: string | null;
  onSelectStage?: (token: string) => void;
}

export const StageCockpit: React.FC<CockpitProps> = ({ stages, currentStage, onSelectStage }) => {
  const [view, setView] = React.useState<'grid' | 'flow'>('grid');

  return (
    <div className="space-y-4">
      {/* 顶端：整体进度 + 当前阶段（两种视图常驻） */}
      <CockpitSummary stages={stages} />
      <CurrentStageBar stage={currentStage} stages={stages} />

      {/* 视图切换：网格 / 流向 */}
      <div className="flex items-center gap-1 bg-gray-100 border rounded p-0.5 w-fit">
        <button
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            view === 'grid' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:bg-white/50'
          }`}
          onClick={() => setView('grid')}
        >
          ▦ 网格视图
        </button>
        <button
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            view === 'flow' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:bg-white/50'
          }`}
          onClick={() => setView('flow')}
        >
          ⇄ 流向视图
        </button>
      </div>

      {view === 'flow' ? (
        <FlowView onSelectStage={onSelectStage} />
      ) : (
        <div className="space-y-6">
          {Object.entries(STAGE_GROUPS).map(([group, tokens]) => {
            if (tokens.length === 0) return null;
            return (
              <div key={group}>
                <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-gray-200 rounded text-xs">{GROUP_LABEL[group]}</span>
                  {group}（{tokens.length} 阶段）
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                  {tokens.map((token) => {
                    const mapping = STAGE_TABLE[token];
                    const status = stages[token] || {
                      token,
                      status: 'pending',
                      artifacts: [],
                      review: null,
                      last_update: '',
                      message: '',
                      artifacts_count: 0,
                    };
                    return (
                      <div
                        key={token}
                        className="cursor-pointer"
                        onClick={() => onSelectStage?.(token)}
                      >
                        <StageNode
                          token={token}
                          mapping={mapping}
                          status={status}
                          isCurrent={currentStage === token}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* 进度汇总（已移到驾驶舱顶端，见 CockpitSummary 导出） */}
        </div>
      )}
    </div>
  );
};

/** 整体进度汇总卡（导出供驾驶舱顶部使用）*/
export const CockpitSummary: React.FC<{ stages: Record<string, StageStatus> }> = ({ stages }) => {
  const counts: Record<string, number> = {};
  for (const t of STAGE_ORDER) {
    const s = stages[t]?.status || 'pending';
    counts[s] = (counts[s] || 0) + 1;
  }
  const total = STAGE_ORDER.length;
  const done = counts.completed || 0;
  const pct = Math.round((done / total) * 100);

  return (
    <div className="bg-white rounded-lg p-4 border">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-gray-700">整体进度</h4>
        <span className="text-sm font-mono text-gray-600">
          {done}/{total}（{pct}%）
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
        <div
          className="bg-emerald-500 h-3 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex gap-3 mt-3 text-xs flex-wrap">
        <Legend color="emerald" label="已完成" count={counts.completed || 0} />
        <Legend color="amber" label="进行中" count={counts.in_progress || 0} />
        <Legend color="orange" label="待审查" count={counts.pending_review || 0} />
        <Legend color="red" label="被拒/阻塞" count={(counts.rejected || 0) + (counts.blocked || 0)} />
        <Legend color="gray" label="未开始" count={counts.pending || 0} />
      </div>
    </div>
  );
};

const Legend: React.FC<{ color: string; label: string; count: number }> = ({
  color,
  label,
  count,
}) => {
  const bg = {
    emerald: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    orange: 'bg-orange-100 text-orange-800',
    red: 'bg-red-100 text-red-800',
    gray: 'bg-gray-100 text-gray-800',
  }[color];
  return (
    <span className={`px-2 py-0.5 rounded ${bg}`}>
      {label} {count}
    </span>
  );
};

/** 当前阶段浓缩条（驾驶舱顶端）*/
export const CurrentStageBar: React.FC<{
  stage: string | null;
  stages: Record<string, StageStatus>;
}> = ({ stage, stages }) => {
  if (!stage) {
    return (
      <div className="bg-white rounded-lg p-3 border text-sm text-gray-500">
        当前阶段：<span className="text-gray-400">—</span>
        <span className="text-xs text-gray-400 ml-2">（暂无进行中的阶段）</span>
      </div>
    );
  }
  const mapping = STAGE_TABLE[stage as keyof typeof STAGE_TABLE];
  const status = stages[stage];
  return (
    <div className="bg-white rounded-lg p-3 border flex items-center gap-3 flex-wrap">
      <span className="text-sm text-gray-700 shrink-0">📍 当前阶段</span>
      <span className="text-sm font-bold text-blue-700 font-mono">{stage}</span>
      {mapping && <span className="text-xs text-gray-500">({mapping.aspice})</span>}
      {status && (
        <span className="px-2 py-0.5 rounded text-xs text-white bg-gray-500">
          {status.status}
        </span>
      )}
      {status?.gate_message && (
        <span className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 truncate max-w-[280px]">
          🚧 {status.gate_message}
        </span>
      )}
    </div>
  );
};