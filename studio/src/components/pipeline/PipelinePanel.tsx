// M4 Pipeline State 全景 - 17 模块编码状态矩阵
// 适配真实 pipeline_state.json 格式：每模块直接是单一 status 字段
// 模块状态合法值（build-spec §3.2.3）：planned/coding/partial_done/done/failed/verified/verify_stuck/blocked/review_failed/review_cleared

import React from 'react';
import type { ModuleState, PipelineState } from '../../data/types';
import { pipelineStats, usePipelineStore } from '../../store/pipelineStore';

const STATUS_COLORS: Record<string, string> = {
  planned: 'bg-gray-100 text-gray-700 border-gray-300',
  coding: 'bg-blue-100 text-blue-800 border-blue-300',
  partial_done: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  done: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  failed: 'bg-red-100 text-red-800 border-red-300',
  verified: 'bg-green-200 text-green-900 border-green-500',
  verify_stuck: 'bg-orange-100 text-orange-800 border-orange-300',
  blocked: 'bg-red-200 text-red-900 border-red-500',
  review_failed: 'bg-purple-100 text-purple-800 border-purple-300',
  review_cleared: 'bg-teal-100 text-teal-800 border-teal-300',
};

const STATUS_ICONS: Record<string, string> = {
  planned: '○',
  coding: '◐',
  partial_done: '◓',
  done: '●',
  failed: '✗',
  verified: '✓',
  verify_stuck: '⌛',
  blocked: '⊘',
  review_failed: '⚠',
  review_cleared: '✓',
};

interface ModuleRowProps {
  moduleId: string;
  module: ModuleState;
}

const ModuleRow: React.FC<ModuleRowProps> = ({ moduleId, module }) => {
  const [expanded, setExpanded] = React.useState(false);
  const color = STATUS_COLORS[module.status] || STATUS_COLORS.planned;
  const icon = STATUS_ICONS[module.status] || '○';

  return (
    <tr className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded(!expanded)}>
      <td className="px-3 py-2 font-mono text-xs">{moduleId}</td>
      <td className="px-3 py-2">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${color} text-xs font-semibold`}>
          {icon} {module.status}
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-gray-500 truncate" title={module.last_success_sha || '—'}>
        {module.last_success_sha ? module.last_success_sha.slice(0, 8) : '—'}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {module.last_success_at || '—'}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {module.verified_at || '—'}
      </td>
      <td className="px-3 py-2 text-xs">
        {module.warnings && module.warnings.length > 0 && (
          <span className="text-amber-600" title={module.warnings.join('; ')}>
            ⚠ {module.warnings.length}
          </span>
        )}
      </td>
    </tr>
  );
};

interface PipelinePanelProps {
  projectPath: string;
}

export const PipelinePanel: React.FC<PipelinePanelProps> = ({ projectPath }) => {
  const load = usePipelineStore((s) => s.load);
  const state = usePipelineStore((s) => s.state);
  const loading = usePipelineStore((s) => s.loading);

  React.useEffect(() => {
    load(projectPath);
  }, [projectPath]);

  const stats = React.useMemo(() => pipelineStats(state), [state]);
  const modules = state ? Object.entries(state.modules) : [];
  const total = modules.length;

  // 按状态排序：verified > done > partial_done > coding > planned > 其他
  const sorted = modules.sort(([, a], [, b]) => {
    const order = ['verified', 'done', 'partial_done', 'coding', 'planned', 'verify_stuck', 'blocked', 'failed', 'review_failed', 'review_cleared'];
    return order.indexOf(a.status) - order.indexOf(b.status);
  });

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-lg">Pipeline State 全景</h3>
          {state && (
            <div className="text-xs text-gray-500 mt-1">
              spec_id: <span className="font-mono">{state.project_id}</span> · 最近更新：{state.last_update}
            </div>
          )}
        </div>
        <button
          className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded"
          onClick={() => load(projectPath)}
        >
          🔄 刷新
        </button>
      </div>

      {!state ? (
        <div className="text-center text-gray-500 py-8">
          {loading ? '加载中…' : '⚠️ pipeline_state.json 不存在'}
        </div>
      ) : (
        <>
          {/* 状态分布 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
            <Stat label="verified" value={stats.verified || 0} total={total} color="green" />
            <Stat label="done" value={stats.done || 0} total={total} color="emerald" />
            <Stat label="coding" value={(stats.coding || 0) + (stats.partial_done || 0)} total={total} color="blue" />
            <Stat label="blocked/verify_stuck" value={(stats.blocked || 0) + (stats.verify_stuck || 0)} total={total} color="red" />
            <Stat label="planned/未开始" value={stats.planned || 0} total={total} color="gray" />
          </div>

          {/* 进度条 */}
          <div className="bg-gray-200 rounded-full h-3 overflow-hidden mb-4 flex">
            {Object.entries(stats).map(([status, count]) => {
              const color = STATUS_COLORS[status] || STATUS_COLORS.planned;
              // 取 bg- 后的颜色名
              const pct = total > 0 ? (count / total) * 100 : 0;
              return (
                <div
                  key={status}
                  className={`${color.split(' ')[0]} h-3 transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${status}: ${count} 模块`}
                />
              );
            })}
          </div>

          {/* 模块矩阵 */}
          <div className="overflow-x-auto bg-white rounded border">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">模块 ID</th>
                  <th className="px-3 py-2 text-left">状态</th>
                  <th className="px-3 py-2 text-left">SHA</th>
                  <th className="px-3 py-2 text-left">last_success_at</th>
                  <th className="px-3 py-2 text-left">verified_at</th>
                  <th className="px-3 py-2 text-left">告警</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(([id, m]) => (
                  <ModuleRow key={id} moduleId={id} module={m} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-gray-500">
            ℹ️ 模块状态主干推进 <code>planned → coding → done → verified</code>。
            verify_stuck = 台架环境阻塞（不计入 done 推进）。
          </div>
        </>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; total: number; color: string }> = ({
  label,
  value,
  total,
  color,
}) => {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const bg = {
    green: 'bg-green-100 text-green-900',
    emerald: 'bg-emerald-100 text-emerald-900',
    blue: 'bg-blue-100 text-blue-900',
    red: 'bg-red-100 text-red-900',
    gray: 'bg-gray-100 text-gray-900',
  }[color];
  return (
    <div className={`rounded p-3 ${bg}`}>
      <div className="text-xs">{label}</div>
      <div className="text-xl font-bold mt-1">
        {value}
        <span className="text-xs font-normal opacity-70">/{total}</span>
      </div>
      <div className="text-xs mt-1 opacity-70">{pct}%</div>
    </div>
  );
};