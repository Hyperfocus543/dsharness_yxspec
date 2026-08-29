// =============================================================================
// TrajectoryPanel — 阶段执行轨迹面板（瀑布式）
// 数据源：网关 GET /api/trajectory?stage=<token>&limit=N
//   （@yxspec/aspice-trajectory 插件订阅 session/event 聚合落盘 JSONL）
// 展示：门控三态徽标（verified 绿 / unverified 黄 / blocked 红）+ 产物命中 +
//       执行记录瀑布（状态/耗时/token + turn/step 计数 + 工具调用序列）。
// 轨迹 × git：每行执行记录对齐该阶段留痕的最新 commit + tag（GET /api/git/commits，
//   与 Git 工作区管控卡同数据源），hover commit 徽标 → 共享 ui/GitDiffPreview 展示
//   该 commit 相对上一留痕 commit 的改动。git 不可用/无留痕 → 行内不渲染，不阻塞。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// Phase 1 只读展示；网关未起/无轨迹 → 空态，不阻塞驾驶舱。
// =============================================================================

import React from 'react';
import { EmptyState, GitDiffPreview, Icon } from '../ui';
import { I } from '../ui/icons';
import { useGitStore } from '../../store/gitStore';
import {
  fetchTrajectory,
  markTrajectoryRollback,
  fetchTrajectoryOtelExport,
  downloadJson,
  getGitCommits,
} from '../../utils/ipc';
import type {
  TrajectoryView,
  TrajectoryRecord,
  TrajectoryGateStatus,
  GitStageTrace,
} from '../../utils/ipc';
import { gitTraceBase, gitTraceBySeq } from '../../utils/gitTrace';

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

/** commit hash 缩写：保留前 8 位，其余折叠（无 → —） */
function shortHash(h: string | null | undefined): string {
  if (!h) return '—';
  return h.length > 12 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
}

/** 模型信息（TrajectoryRecord.model / TrajectoryGateStatus.model 同形态）。 */
type ModelInfo = { provider: string; name: string; maxTokens?: number } | null | undefined;

/** 模型名短显：取 `/` 后最后一段（deepseek/deepseek-chat → deepseek-chat；无 → —） */
function shortModelName(name: string | null | undefined): string {
  if (!name) return '—';
  const seg = name.split('/').filter((s) => s.length > 0);
  return seg.length > 0 ? seg[seg.length - 1] : name;
}

/** 模型展示名：name + 可选 provider 前缀（如 deepseek/xxx）；无 → — */
function modelDisplayName(m: ModelInfo): string {
  if (!m?.name) return '—';
  if (m.provider && !m.name.includes(m.provider)) return `${m.provider}/${m.name}`;
  return m.name;
}

/** 目标变更 operation → 展示字形（create=+, update=~, clear=x；其他=·） */
function goalOpGlyph(op: string | undefined): string {
  return op === 'create' ? '+' : op === 'update' ? '~' : op === 'clear' ? 'x' : '·';
}

/** 目标变更 operation → 字形颜色（create=绿 / update=琥珀 / clear=绯 / 其他=灰） */
function goalOpCls(op: string | undefined): string {
  return op === 'create' ? 'text-sage-600' : op === 'update' ? 'text-amber-600' : op === 'clear' ? 'text-red-500' : 'text-zinc-400';
}

/** 待办 status → 状态点颜色（completed=绿 / in_progress=琥珀 / 其他=灰） */
function todoDotCls(status: string | undefined): string {
  return status === 'completed' ? 'bg-sage-500' : status === 'in_progress' ? 'bg-amber-500' : 'bg-zinc-400';
}

/** 该条记录是否有「详情」内容（目标/待办/用户输入/reasoning 任一存在 → 渲染折叠钮）。 */
function recordHasDetails(r: TrajectoryRecord): boolean {
  if (Array.isArray(r.goals) && r.goals.length > 0) return true;
  if (Array.isArray(r.todos) && r.todos.length > 0) return true;
  if (Array.isArray(r.userInputs) && r.userInputs.length > 0) return true;
  if ((r.reasoningDeltaCount ?? 0) > 0) return true;
  if ((r.cost?.reasoningTokens ?? 0) > 0) return true;
  if (r.cost?.hasReasoning === true) return true;
  return false;
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
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'export' | 'rollback' | null>(null);
  const [rollbackMsg, setRollbackMsg] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [rollbackErr, setRollbackErr] = React.useState<string | null>(null);
  // git 留痕（阶段 ↔ commit/tag 对照）：轨迹×git 瀑布增强 —— 该阶段每次执行的最新
  // commit + tag。走 /api/git/commits（只读采集），与 Git 工作区管控卡同数据源；
  // git 不可用/无留痕 → null，瀑布行不渲染 git 徽标（不阻塞）。
  const [gitTraces, setGitTraces] = React.useState<GitStageTrace[] | null>(null);
  // hover 展开 commit diff 的行 key（至多一个浮层，与工作区管控卡同交互）
  const [hoverSeq, setHoverSeq] = React.useState<number | null>(null);
  // 详情可折叠区展开的行 seq（每行底部「详情 ▾/▴」；至多一行展开，默认收起）
  const [detailSeq, setDetailSeq] = React.useState<number | null>(null);
  // 活动工作区 root：阶段留痕 commit + commit diff 都按活动 root 拉（多工作区不串根）
  const activeRoot = useGitStore((s) => s.activeWorkspace?.root ?? null);

  const reload = React.useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetchTrajectory(stage, limit)
      .then((v) => setView(v))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [stage, limit]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchTrajectory(stage, limit)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setView(null);
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // 并行拉取该阶段 git 留痕（轨迹×git 增强；失败静默降级，不阻塞轨迹面板）
    getGitCommits(stage, activeRoot)
      .then((traces) => {
        if (!cancelled && traces) setGitTraces(traces);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [stage, limit, activeRoot]);

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

  // git 留痕 → seq 映射（该阶段留痕的 commit/tag）；瀑布行按 seq 对齐展示。
  // 放在 early-return 之前（rules-of-hooks）：loading/error/无数据分支先 return 时，
  // 本组件仍保持与主渲染一致的 hook 数量，否则从骨架切到数据渲染会
  // 「Rendered more hooks than during the previous render」崩溃（见 TrajectoryTimeline 同款注释）。
  const gitBySeq = React.useMemo(() => gitTraceBySeq(gitTraces), [gitTraces]);

  // 空态：加载中（骨架，带 aria-busy）/ 加载失败（错误态）/ 网关未起或从未执行
  if (loading) {
    return (
      <div
        className="border border-zinc-200 rounded-lg bg-white p-3 space-y-2"
        role="status"
        aria-busy="true"
        aria-label="正在加载轨迹数据"
      >
        <div className="h-4 bg-zinc-200 rounded animate-pulse w-1/3" />
        <div className="h-3 bg-zinc-100 rounded animate-pulse w-2/3" />
        <div className="h-3 bg-zinc-100 rounded animate-pulse w-1/2" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="border border-zinc-200 rounded-lg bg-white">
        <EmptyState
          icon={I.warn}
          title="轨迹数据加载失败"
          hint={loadError}
        />
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
          {/* Phase 3：标记该阶段最新轨迹回滚（确认后调 /rollback；网关只发指令留档不执行 git）。
              两段式确认带逃生门：先点「标记回滚」进入确认态（按钮变红 + 并排出现「取消」），
              再点「确认回滚」才真正发指令留档——避免误点后无路可退被迫执行。 */}
          {confirming ? (
            <>
              <button
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border border-red-400 bg-red-50 text-red-700 transition-all active:scale-[0.98] disabled:opacity-50"
                onClick={handleRollback}
                disabled={busy !== null || view.totalRuns === 0}
                title={view.totalRuns === 0 ? '该阶段尚无轨迹可回滚' : '确认标记该阶段最新轨迹回滚（发指令留档，不执行 git）'}
              >
                <Icon name={I.undo} size={12} weight="bold" />
                {busy === 'rollback' ? '标记中…' : '确认回滚'}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-600 transition-all active:scale-[0.98] disabled:opacity-50"
                onClick={() => setConfirming(false)}
                disabled={busy !== null}
                title="取消回滚"
              >
                取消
              </button>
            </>
          ) : (
            <button
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border border-zinc-200 bg-white text-zinc-600 hover:border-red-300 hover:text-red-600 transition-all active:scale-[0.98] disabled:opacity-50"
              onClick={handleRollback}
              disabled={busy !== null || view.totalRuns === 0}
              title={view.totalRuns === 0 ? '该阶段尚无轨迹可回滚' : '标记该阶段最新轨迹回滚（回滚协议：发指令留档）'}
            >
              <Icon name={I.undo} size={12} weight="bold" />
              标记回滚
            </button>
          )}
        </div>
      </div>

      {/* Phase 3：回滚结果 / 回滚指令（git 提示，对齐 guard.sh 块起始语义；网关不执行 git） */}
      {rollbackMsg && (
        <div className="border border-red-200 bg-red-50 rounded-lg px-2.5 py-2 text-xs text-red-700 space-y-1 animate-fade-in-up" role="status">
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

      {/* 摘要条：执行次数 / 最近状态 / token / 耗时 / 模型 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <SummaryTile label="执行次数" value={String(view.totalRuns ?? 0)} />
        <SummaryTile label="最近状态" value={gate ? (REC_STATUS[gate.status]?.label ?? gate.status) : '—'} valueCls={gate ? REC_STATUS[gate.status]?.cls : undefined} />
        <SummaryTile label="最近 Token" value={gate ? String(gate.tokens ?? 0) : '—'} />
        <SummaryTile label="工具调用" value={gate ? String(gate.toolCalls ?? 0) : '—'} />
        <SummaryTile label="模型" value={modelDisplayName(gate?.model)} />
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
              // 轨迹×git：该条执行的最新 commit/tag（git 留痕按 seq 对齐；无 → null）
              const g = gitBySeq.get(r.seq) ?? null;
              const gCommit = g?.commit || null;
              // diff 基线：该阶段留痕中比当前 seq 更早的最近一条 commit（纯函数聚合，可单测）
              const gBase = gitTraceBase(gitTraces, r.seq);
              const showGit = !!gCommit;
              // 详情折叠区：目标/待办/用户输入/reasoning 任一有内容才渲染（整段无字段 → 不出现）
              const hasDetails = recordHasDetails(r);
              const detailOpen = detailSeq === r.seq;
              return (
                <div
                  key={`${r.seq}-${r.startedAt}`}
                  className={`relative border rounded-lg bg-white px-2.5 py-2 ${r.rolled_back ? 'border-red-200' : 'border-zinc-200'}`}
                >
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
                    {/* 模型徽标：该次执行使用的模型名（短显 zinc mono；无 → 不渲染） */}
                    {r.model?.name && (
                      <span
                        className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-mono text-[10px]"
                        title={modelDisplayName(r.model)}
                      >
                        {shortModelName(r.model.name)}
                      </span>
                    )}
                    {/* reasoning 徽标：该次执行有 reasoning 输出（emerald「思考」；无 → 不渲染） */}
                    {r.cost?.hasReasoning === true && (
                      <span
                        className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono text-[10px] border border-emerald-200/70"
                        title={`reasoning ${r.cost?.reasoningTokens ?? 0} tok · ${r.reasoningDeltaCount ?? 0} 片`}
                      >
                        思考
                      </span>
                    )}
                    <span className="text-zinc-400 shrink-0 tabular-nums" title={`工具调用 ${toolCalls} 次，成功 ${toolOks} 次`}>
                      ×{toolCalls}✓{toolOks}
                    </span>
                    {/* 轨迹×git：该次执行的最新 commit + tag（hover 看相对上一留痕 commit 的改动） */}
                    {showGit && (
                      <>
                        <span
                          className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-mono text-[10px] hover:bg-emerald-50 hover:text-emerald-700 transition-all cursor-help"
                          title={`该次执行时刻最新 commit：${g?.commitFull ?? gCommit}${g?.subject ? `\n提交说明：${g.subject}` : ''}\n悬停查看相对上一留痕 commit 的改动`}
                          onMouseEnter={() => setHoverSeq(r.seq)}
                          onMouseLeave={() => setHoverSeq(null)}
                        >
                          {shortHash(gCommit)}
                        </span>
                        {g?.tag && (
                          <span
                            className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono text-[10px] border border-emerald-200/70"
                            title={`该次执行时刻的 commit 打上了 tag：${g.tag}`}
                          >
                            {g.tag}
                          </span>
                        )}
                      </>
                    )}
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
                  {/* 详情可折叠区（目标变更 / 待办快照 / 用户输入 / reasoning 摘要）：
                      有任一字段才渲染折叠钮，无字段整段不出现；展开默认收起 */}
                  {hasDetails && (
                    <div className="mt-1.5">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98]"
                        onClick={() => setDetailSeq(detailOpen ? null : r.seq)}
                        aria-expanded={detailOpen}
                      >
                        {detailOpen ? '详情 ▴' : '详情 ▾'}
                      </button>
                      {detailOpen && (
                        <div className="mt-1.5 pl-3 border-l-2 border-zinc-100 space-y-1">
                          {Array.isArray(r.goals) && r.goals.length > 0 && (
                            <div className="space-y-0.5">
                              <div className="text-[10px] text-zinc-400 font-medium">目标变更</div>
                              {r.goals.map((g, i) => (
                                <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono">
                                  <span className={`shrink-0 font-bold ${goalOpCls(g.operation)}`}>{goalOpGlyph(g.operation)}</span>
                                  <span className="truncate text-zinc-600" title={g.objective}>
                                    {g.objective}
                                  </span>
                                  {g.phase && <span className="shrink-0 text-zinc-400">（{g.phase}）</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {Array.isArray(r.todos) && r.todos.length > 0 && (
                            <div className="space-y-0.5">
                              <div className="text-[10px] text-zinc-400 font-medium">待办快照</div>
                              {r.todos.map((t, i) => (
                                <div key={i} className="flex items-center gap-1.5 text-[11px]">
                                  <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${todoDotCls(t.status)}`} />
                                  <span className="truncate text-zinc-600" title={t.content}>
                                    {t.content}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          {Array.isArray(r.userInputs) && r.userInputs.length > 0 && (
                            <div className="space-y-0.5">
                              <div className="text-[10px] text-zinc-400 font-medium">用户输入</div>
                              {r.userInputs.map((u, i) => (
                                <div key={i} className="text-[11px] text-zinc-500 font-mono truncate" title={u.preview}>
                                  {u.preview}
                                </div>
                              ))}
                            </div>
                          )}
                          {((r.reasoningDeltaCount ?? 0) > 0 || (r.cost?.reasoningTokens ?? 0) > 0) && (
                            <div className="flex items-center gap-1.5 text-[11px]">
                              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              <span className="font-mono text-emerald-700">
                                reasoning {r.reasoningDeltaCount ?? 0} 片 · {(r.cost?.reasoningTokens ?? 0).toLocaleString()} tok
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {/* 轨迹×git diff 预览：hover commit 徽标 → 该 commit 相对上一留痕 commit 的改动 */}
                  <GitDiffPreview base={gBase} target={gCommit} open={showGit && hoverSeq === r.seq} root={activeRoot} />
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
