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
import {
  fetchTrajectory,
  markTrajectoryRollback,
  fetchTrajectoryOtelExport,
  downloadJson,
} from '../../utils/ipc';
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
  rolled_back: { cls: 'text-red-600', label: '已回滚' },
};

/** 回滚原因 → 展示文案（未知原因为空时用通用文案）。 */
const ROLLBACK_REASON_TEXT: Record<string, string> = {
  'trajectory-blocked': '门控打回：轨迹证据 blocked',
  'trajectory-unverified': '门控警告：轨迹证据不完整',
  'review-rejected': '审查拒绝',
  'manual-rollback': '人工标记回滚',
};

export const TrajectoryPanel: React.FC<{ stage: string; limit?: number }> = ({ stage, limit = 50 }) => {
  const [view, setView] = React.useState<TrajectoryView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<'export' | 'rollback' | null>(null);
  const [rollbackMsg, setRollbackMsg] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [rollbackErr, setRollbackErr] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    setLoading(true);
    fetchTrajectory(stage, limit)
      .then((v) => setView(v))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [stage, limit]);

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

  // Phase 3：导出 OTel GenAI spans → 下载 JSON（Langfuse/LangSmith 可消费）
  const handleExportOtel = React.useCallback(async () => {
    setBusy('export');
    try {
      const out = await fetchTrajectoryOtelExport(stage);
      if (!out) {
        setRollbackErr('导出失败：该阶段尚无轨迹记录');
        return;
      }
      downloadJson(`trajectory-${stage}-otel.json`, out);
    } catch (e: any) {
      setRollbackErr(`导出失败：${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  }, [stage]);

  // Phase 3：标记该阶段最新轨迹回滚（确认后调 /rollback，网关只发指令留档）
  const handleRollback = React.useCallback(async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy('rollback');
    setRollbackErr(null);
    try {
      const r = await markTrajectoryRollback(stage, 'manual-rollback');
      const lines = [
        r.already ? `已标记回滚（幂等命中）：${r.rollbackId}` : `已标记回滚：${r.rollbackId}`,
        ...(r.instructions ?? []),
      ];
      setRollbackMsg(lines.join('\n'));
      setConfirming(false);
      reload(); // 刷新瀑布：最新记录显示已回滚徽标
    } catch (e: any) {
      setRollbackErr(`标记回滚失败：${e?.message || e}`);
      setConfirming(false);
    } finally {
      setBusy(null);
    }
  }, [stage, confirming, reload]);

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
          {/* Phase 3：导出 OTel GenAI spans（下载 JSON，Langfuse/LangSmith 可消费） */}
          <button
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-50"
            onClick={handleExportOtel}
            disabled={busy !== null || view.totalRuns === 0}
            title={view.totalRuns === 0 ? '该阶段尚无轨迹可导出' : '导出 OTel GenAI spans（JSON）'}
          >
            <Icon name={I.download} size={12} weight="bold" />
            {busy === 'export' ? '导出中…' : '导出 OTel'}
          </button>
          {/* Phase 3：标记该阶段最新轨迹回滚（确认后调 /rollback；网关只发指令留档不执行 git） */}
          <button
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border transition-all active:scale-[0.98] disabled:opacity-50 ${
              confirming
                ? 'border-red-400 bg-red-50 text-red-700'
                : 'border-zinc-200 bg-white text-zinc-600 hover:border-red-300 hover:text-red-600'
            }`}
            onClick={handleRollback}
            disabled={busy !== null || view.totalRuns === 0}
            title={view.totalRuns === 0 ? '该阶段尚无轨迹可回滚' : '标记该阶段最新轨迹回滚（回滚协议：发指令留档）'}
          >
            <Icon name={I.undo} size={12} weight="bold" />
            {busy === 'rollback' ? '标记中…' : confirming ? '确认回滚？' : '标记回滚'}
          </button>
        </div>
      </div>

      {/* Phase 3：回滚结果 / 回滚指令（git 提示，对齐 guard.sh 块起始语义；网关不执行 git） */}
      {rollbackMsg && (
        <div className="border border-red-200 bg-red-50 rounded-lg px-2.5 py-2 text-xs text-red-700 space-y-1">
          {rollbackMsg.split('\n').map((l, i) => (
            <div key={i} className={l.startsWith('git ') ? 'font-mono bg-white/60 rounded px-1.5 py-0.5 border border-red-100' : 'font-medium'}>
              {l}
            </div>
          ))}
          <div className="text-[11px] text-red-500">回滚已留档（append-only 审计）。指令仅供执行参考，网关不直接执行 git 操作。</div>
        </div>
      )}
      {rollbackErr && (
        <div className="border border-zinc-200 bg-amber-50 rounded-lg px-2.5 py-1.5 text-xs text-amber-700">{rollbackErr}</div>
      )}

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
              const st = r.rolled_back ? REC_STATUS.rolled_back : REC_STATUS[r.status] || REC_STATUS.unverified;
              const toolCalls = (r.tools ?? []).filter((t) => t.type === 'tool/call').length;
              const toolOks = (r.tools ?? []).filter((t) => t.type === 'tool/result' && t.ok).length;
              const durMs = (r.finishedAt ?? 0) - (r.startedAt ?? 0);
              return (
                <div key={`${r.seq}-${r.startedAt}`} className={`border rounded-lg bg-white px-2.5 py-2 ${r.rolled_back ? 'border-red-200' : 'border-zinc-200'}`}>
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="font-mono text-zinc-500 shrink-0">#{r.seq}</span>
                    <span className={`font-medium ${st.cls}`}>{st.label}</span>
                    {r.rolled_back && r.rollbackId && (
                      <span
                        className="px-1 py-0.5 rounded bg-red-100 text-red-700 border border-red-200 text-[10px] font-mono"
                        title={`回滚 id：${r.rollbackId}${r.rollbackReason ? `\n原因：${ROLLBACK_REASON_TEXT[r.rollbackReason] || r.rollbackReason}` : ''}${r.rollbackAt ? `\n时间：${new Date(r.rollbackAt).toLocaleString()}` : ''}`}
                      >
                        ↺ {r.rollbackId}
                      </span>
                    )}
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
