// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// M4 Pipeline State 全景 - 17 模块编码状态矩阵
// 适配真实 pipeline_state.json 格式：每模块直接是单一 status 字段
// 模块状态合法值（build-spec §3.2.3）：planned/coding/partial_done/done/failed/verified/verify_stuck/blocked/review_failed/review_cleared

import React from 'react';
import type { ModuleState, PipelineState } from '../../data/types';
import { pipelineStats, usePipelineStore } from '../../store/pipelineStore';
import { I } from '../ui/icons';
import { Button, EmptyState, Icon, Panel, StatusDot } from '../ui';

const STATUS_COLORS: Record<string, string> = {
  planned: 'bg-zinc-100 text-zinc-600 border-zinc-300',
  coding: 'bg-amber-50 text-amber-700 border-amber-300',
  partial_done: 'bg-amber-50 text-amber-700 border-amber-300',
  done: 'bg-sage-50 text-sage-700 border-sage-300',
  failed: 'bg-red-50 text-red-700 border-red-300',
  verified: 'bg-sage-100 text-sage-700 border-sage-400',
  verify_stuck: 'bg-orange-50 text-orange-700 border-orange-300',
  blocked: 'bg-red-100 text-red-700 border-red-400',
  review_failed: 'bg-purple-50 text-purple-700 border-purple-300',
  review_cleared: 'bg-sage-50 text-sage-700 border-sage-300',
};

// 状态圆点（plan/coding/done 类）：ok=完成、warn=进行中、idle=未开始
const STATUS_DOT: Record<string, 'ok' | 'warn' | 'err' | 'idle' | 'active'> = {
  planned: 'idle',
  coding: 'warn',
  partial_done: 'warn',
  done: 'ok',
};

// 状态图标（异常/结论类）：check/xCircle/warn/clock 替换为 Phosphor
const STATUS_ICON: Record<string, React.ElementType> = {
  failed: I.xCircle,
  verified: I.check,
  verify_stuck: I.clock,
  blocked: I.xCircle,
  review_failed: I.warn,
  review_cleared: I.check,
};

const STATUS_ICON_COLOR: Record<string, string> = {
  failed: 'text-red-600',
  verified: 'text-sage-600',
  verify_stuck: 'text-orange-600',
  blocked: 'text-red-600',
  review_failed: 'text-purple-600',
  review_cleared: 'text-sage-600',
};

// 进度条分段色
const STATUS_BAR_COLORS: Record<string, string> = {
  planned: 'bg-zinc-300',
  coding: 'bg-amber-500',
  partial_done: 'bg-amber-400',
  done: 'bg-sage-500',
  failed: 'bg-red-500',
  verified: 'bg-sage-600',
  verify_stuck: 'bg-orange-400',
  blocked: 'bg-red-600',
  review_failed: 'bg-purple-400',
  review_cleared: 'bg-sage-500',
};

interface ModuleRowProps {
  moduleId: string;
  module: ModuleState;
}

const ModuleRow: React.FC<ModuleRowProps> = ({ moduleId, module }) => {
  const [expanded, setExpanded] = React.useState(false);
  const color = STATUS_COLORS[module.status] || STATUS_COLORS.planned;
  const dot = STATUS_DOT[module.status] || 'idle';
  const icon = STATUS_ICON[module.status];
  const iconColor = STATUS_ICON_COLOR[module.status] || 'text-zinc-500';

  return (
    <tr
      className="border-b border-zinc-200 transition-colors hover:bg-zinc-50 cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <td className="px-3 py-2 font-mono text-xs text-zinc-700">{moduleId}</td>
      <td className="px-3 py-2">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border ${color} text-xs font-medium`}>
          {icon ? (
            <Icon name={icon} size={14} className={iconColor} />
          ) : (
            <StatusDot tone={dot} />
          )}
          {module.status}
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-zinc-500 truncate" title={module.last_success_sha || '—'}>
        {module.last_success_sha ? module.last_success_sha.slice(0, 8) : '—'}
      </td>
      <td className="px-3 py-2 text-xs text-zinc-500 truncate">
        {module.last_success_at || '—'}
      </td>
      <td className="px-3 py-2 text-xs text-zinc-500 truncate">
        {module.verified_at || '—'}
      </td>
      <td className="px-3 py-2 text-xs">
        {module.warnings && module.warnings.length > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600" title={module.warnings.join('; ')}>
            <Icon name={I.warn} size={14} />
            {module.warnings.length}
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
          <h3 className="text-lg font-semibold text-zinc-800">Pipeline State 全景</h3>
          {state && (
            <div className="mt-1 text-xs text-zinc-500">
              spec_id: <span className="font-mono">{state.project_id}</span> · 最近更新：{state.last_update}
            </div>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={() => load(projectPath)}>
          <Icon name={I.refresh} size={14} />
          刷新
        </Button>
      </div>

      {!state ? (
        <div className="py-8 text-center">
          {loading ? (
            <div className="text-zinc-500">加载中…</div>
          ) : (
            <EmptyState
              icon={I.stack}
              title="该项目暂无 Pipeline 数据"
              hint={
                projectPath.includes('Aima') || projectPath.includes('aima')
                  ? 'Aima 项目的编码流水线状态不在此路径（project/tasks/pipeline_state.json）。'
                  : '未找到 project/tasks/pipeline_state.json — 编码流水线（SWE.4）尚未产生该文件，属正常。'
              }
            />
          )}
        </div>
      ) : (
        <>
          {/* 状态分布 */}
          <div className="grid grid-cols-2 gap-2 mb-4 md:grid-cols-5">
            <Stat label="verified" value={stats.verified || 0} total={total} color="emerald" />
            <Stat label="done" value={stats.done || 0} total={total} color="sage" />
            <Stat label="coding" value={(stats.coding || 0) + (stats.partial_done || 0)} total={total} color="amber" />
            <Stat label="blocked/verify_stuck" value={(stats.blocked || 0) + (stats.verify_stuck || 0)} total={total} color="red" />
            <Stat label="planned/未开始" value={stats.planned || 0} total={total} color="gray" />
          </div>

          {/* 进度条 */}
          <div className="bg-zinc-200 rounded-full h-3 overflow-hidden mb-4 flex">
            {Object.entries(stats).map(([status, count]) => {
              const pct = total > 0 ? (count / total) * 100 : 0;
              return (
                <div
                  key={status}
                  className={`${STATUS_BAR_COLORS[status] || 'bg-zinc-300'} h-3 transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${status}: ${count} 模块`}
                />
              );
            })}
          </div>

          {/* 模块矩阵 */}
          <Panel className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">模块 ID</th>
                  <th className="px-3 py-2 text-left font-medium">状态</th>
                  <th className="px-3 py-2 text-left font-medium">SHA</th>
                  <th className="px-3 py-2 text-left font-medium">last_success_at</th>
                  <th className="px-3 py-2 text-left font-medium">verified_at</th>
                  <th className="px-3 py-2 text-left font-medium">告警</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(([id, m]) => (
                  <ModuleRow key={id} moduleId={id} module={m} />
                ))}
              </tbody>
            </table>
          </Panel>

          <div className="mt-3 flex items-start gap-1 text-xs text-zinc-500">
            <Icon name={I.info} size={14} className="mt-0.5 shrink-0 text-zinc-400" />
            <span>
              模块状态主干推进 <code className="font-mono text-zinc-600">planned <Icon name={I.arrowRight} size={14} className="text-zinc-400" /> coding <Icon name={I.arrowRight} size={14} className="text-zinc-400" /> done <Icon name={I.arrowRight} size={14} className="text-zinc-400" /> verified</code>。verify_stuck = 台架环境阻塞（不计入 done 推进）。
            </span>
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
    sage: 'bg-sage-50 text-sage-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    gray: 'bg-zinc-100 text-zinc-600',
  }[color];
  return (
    <div className={`rounded-lg border border-zinc-200 p-3 ${bg}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">
        {value}
        <span className="text-xs font-normal opacity-70">/{total}</span>
      </div>
      <div className="mt-1 text-xs opacity-70">{pct}%</div>
    </div>
  );
};
