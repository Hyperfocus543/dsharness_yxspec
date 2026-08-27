// =============================================================================
// TrajectoryPanel — 阶段执行轨迹面板（瀑布式）
// 数据源：网关 GET /api/trajectory?stage=<token>&limit=N
//   （@yxspec/aspice-trajectory 插件订阅 session/event 聚合落盘 JSONL）
// 展示：门控三态徽标（verified 绿 / unverified 黄 / blocked 红）+ 产物命中 +
//       执行记录瀑布（状态/耗时/token + turn/step 计数 + 工具调用序列）。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// Phase 1 只读展示；网关未起/无轨迹 → 空态，不阻塞驾驶舱。
// =============================================================================

import React from 'react';
import { EmptyState, Icon } from '../ui';
import { I } from '../ui/icons';
import { fetchTrajectory } from '../../utils/ipc';
import type { TrajectoryView, TrajectoryRecord, TrajectoryGateStatus } from '../../utils/ipc';

/** 毫秒 → 人类可读耗时（与项目时间约定一致：h m / m s / s） */
function fmtMs(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '—';
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** 执行耗时：finishedAt - startedAt（未终结 → —） */
function recDuration(r: TrajectoryRecord): string {
  if (!r.startedAt || !r.finishedAt) return '—';
  return fmtMs(r.finishedAt - r.startedAt);
}

/** 门控三态徽标样式（verified 绿 / unverified 黄 / blocked 红） */
const GATE_BADGE: Record<string, { cls: string; label: string; icon: React.ElementType }> = {
  verified: { cls: 'bg-sage-100 text-sage-700 border-sage-200', label: '已验证', icon: I.checkCircle },
  unverified: { cls: 'bg-amber-100 text-amber-700 border-amber-200', label: '未验证', icon: I.clock },
  blocked: { cls: 'bg-red-100 text-red-700 border-red-200', label: '已打回', icon: I.xCircle },
};

const REC_STATUS: Record<string, { cls: string; label: string }> = {
  passed: { cls: 'text-sage-700', label: '通过' },
  failed: { cls: 'text-red-700', label: '失败' },
  unverified: { cls: 'text-amber-700', label: '未验证' },
  blocked: { cls: 'text-red-700', label: '打回' },
};

export const TrajectoryPanel: React.FC<{ stage: string; limit?: number }> = ({ stage, limit = 50 }) => {
  const [view, setView] = React.useState<TrajectoryView | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTrajectory(stage, limit)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stage, limit]);

  // 空态：加载中 / 网关未起 / 从未执行过
  if (loading) {
    return (
      <div className="border border-zinc-200 rounded-lg bg-white p-3 space-y-2">
        <div className="h-4 bg-zinc-200 rounded animate-pulse w-1/3" />
        <div className="h-3 bg-zinc-100 rounded animate-pulse w-2/3" />
        <div className="h-3 bg-zinc-100 rounded animate-pulse w-1/2" />
      </div>
    );
  }
  if (!view) {
    return (
      <div className="border border-zinc-200 rounded-lg bg-white">
        <EmptyState
          icon={I.timer}
          title="无轨迹数据"
          hint="网关未启动、或该阶段尚无执行记录（@yxspec/aspice-trajectory 聚合中）"
        />
      </div>
    );
  }

  const gate = view.status;
  const badge = gate ? GATE_BADGE[gate.status] : null;
  const rows = (view.rows ?? []).slice(-10).reverse(); // 最近 10 条，新→旧

  return (
    <div className="space-y-3">
      {/* 标题行：阶段 + 门控三态徽标 + 产物命中 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-emerald-600">
            <Icon name={I.timer} size={15} weight="fill" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-800 truncate">
              {view.label || view.stage}
              {view.aspice && <span className="text-xs font-mono text-zinc-400 ml-1.5">{view.aspice}</span>}
            </div>
            <div className="text-[11px] text-zinc-400 font-mono truncate">{view.command}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {view.gate_policy === 'artifact+trajectory' && badge && (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border ${badge.cls}`} title={`门控：${view.gate_policy}`}>
              <Icon name={badge.icon} size={12} weight="fill" />
              {badge.label}
            </span>
          )}
          <span
            className={`px-1.5 py-0.5 rounded text-xs border ${
              view.exists
                ? 'bg-sage-50 text-sage-700 border-sage-200'
                : 'bg-zinc-50 text-zinc-500 border-zinc-200'
            }`}
            title={view.artifacts.length > 0 ? view.artifacts.map((a) => a.path).join('\n') : undefined}
          >
            产物 {view.artifacts.length} 项
          </span>
        </div>
      </div>

      {/* 摘要条：执行次数 / 最近状态 / token / 耗时 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryTile label="执行次数" value={String(view.totalRuns ?? 0)} />
        <SummaryTile label="最近状态" value={gate ? (REC_STATUS[gate.status]?.label ?? gate.status) : '—'} valueCls={gate ? REC_STATUS[gate.status]?.cls : undefined} />
        <SummaryTile label="最近 Token" value={gate ? String(gate.tokens ?? 0) : '—'} />
        <SummaryTile label="工具调用" value={gate ? String(gate.toolCalls ?? 0) : '—'} />
      </div>

      {/* 瀑布：执行记录（新→旧） */}
      <div>
        <div className="text-xs font-semibold text-zinc-600 mb-1.5 flex items-center gap-1">
          <Icon name={I.swap} size={13} />
          执行记录
          <span className="text-[11px] text-zinc-400 font-normal">（最近 {rows.length} 次）</span>
        </div>
        {rows.length === 0 ? (
          <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-zinc-200 rounded-lg">
            该阶段尚无轨迹记录
          </div>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => {
              const st = REC_STATUS[r.status] || REC_STATUS.unverified;
              const toolCalls = (r.tools ?? []).filter((t) => t.type === 'tool/call').length;
              const toolOks = (r.tools ?? []).filter((t) => t.type === 'tool/result' && t.ok).length;
              const durMs = (r.finishedAt ?? 0) - (r.startedAt ?? 0);
              return (
                <div key={`${r.seq}-${r.startedAt}`} className="border border-zinc-200 rounded-lg bg-white px-2.5 py-2">
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="font-mono text-zinc-500 shrink-0">#{r.seq}</span>
                    <span className={`font-medium ${st.cls}`}>{st.label}</span>
                    <span className="text-zinc-400 shrink-0">{fmtMs(durMs)}</span>
                    <span className="text-zinc-400 shrink-0 tabular-nums">{r.cost?.tokens ?? 0} tok</span>
                    <span className="text-zinc-400 shrink-0 tabular-nums">T{r.turnCount ?? 0}·S{r.stepCount ?? 0}</span>
                    <span className="text-zinc-400 shrink-0 tabular-nums" title={`工具调用 ${toolCalls} 次，成功 ${toolOks} 次`}>
                      ×{toolCalls}✓{toolOks}
                    </span>
                    {r.reason && (
                      <span className="text-[11px] text-zinc-400 font-mono truncate max-w-[140px]" title={r.reason}>
                        {r.reason}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-zinc-300 font-mono truncate max-w-[120px]" title={r.sessionId ?? ''}>
                      {r.sessionId ?? ''}
                    </span>
                  </div>
                  {/* 工具调用瀑布（行内缩进） */}
                  {(r.tools ?? []).length > 0 && (
                    <div className="mt-1.5 space-y-0.5 pl-3 border-l-2 border-zinc-100">
                      {(r.tools ?? []).slice(-12).map((t, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono">
                          <span className={t.type === 'tool/call' ? 'text-zinc-400' : t.ok ? 'text-sage-600' : 'text-red-500'}>
                            {t.type === 'tool/call' ? '→' : t.ok ? '✓' : '✗'}
                          </span>
                          <span className={`truncate ${t.type === 'tool/call' ? 'text-zinc-600' : 'text-zinc-500'}`}>
                            {t.name ?? (t.type === 'tool/result' ? 'result' : 'call')}
                          </span>
                          {t.error && <span className="text-red-400 truncate">({t.error})</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const SummaryTile: React.FC<{ label: string; value: string; valueCls?: string }> = ({ label, value, valueCls }) => (
  <div className="rounded-lg border border-zinc-200 bg-white px-2.5 py-2">
    <div className={`text-sm font-bold leading-none tabular-nums truncate ${valueCls ?? 'text-zinc-800'}`} title={value}>
      {value}
    </div>
    <div className="text-[11px] mt-1 text-zinc-400 truncate">{label}</div>
  </div>
);
