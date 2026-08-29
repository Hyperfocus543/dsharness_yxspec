// =============================================================================
// TrajectoryTimeline — 驾驶舱「轨迹」总览：全阶段轨迹时间轴
// 数据源：网关 GET /api/trajectory-all（聚合所有阶段的执行记录，时间降序）。
// 所有轨迹按时间倒序汇成一条流（不按阶段划分）：
//   · 每行 = 一次阶段执行（阶段徽标 + 状态色 + 耗时/token/工具 + 时间）
//   · 阶段徽标点击 → 展开该阶段详情（TrajectoryPanel 复用）
//   · 过滤：仅失败/打回/已回滚（排障聚焦）
// 单模块轨迹在各自单元卡内联展示（TrajectoryPanel），本页 = 全局排障入口。
//
// 轨迹 × git 联动：每行在「时间」前展示该次执行 startedAt 时刻的最新 commit
// （git log --all + for-each-ref，网关 trajectoryAll 已合并，零额外请求）。
// commit 徽标 tooltip 给完整 hash + 提交说明；tag 徽标 emerald（指向同一 commit）。
// hover commit 徽标 → 共享 GitDiffPreview：展示该 commit 相对相邻更早执行的改动
// （基线上文 = 时间相邻的上一次执行 commit，纯前端 traceBaseAt 派生，与阶段留痕
// "相邻执行 = 一个 diff 单元"同口径），补齐全局轨迹页最后的 git 触点盲区。
// git 不可用（非仓库/未装 git）→ 数据源 gitAvailable=false，整行不渲染 git 徽标。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { EmptyState, GitDiffPreview, Icon } from '../ui';
import { I } from '../ui/icons';
import { useGitStore } from '../../store/gitStore';
import { fetchTrajectoryAll, type TrajectoryAll, type TrajectoryAllEntry } from '../../utils/ipc';
import { traceBaseAt } from '../../utils/gitTrace';
import { TrajectoryPanel } from './TrajectoryPanel';

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

/** 记录状态 → 颜色/文案（行首色条 + 状态标签） */
const ROW_STATUS: Record<string, { bar: string; label: string; text: string }> = {
  passed: { bar: 'bg-sage-500', label: '通过', text: 'text-sage-700' },
  failed: { bar: 'bg-red-500', label: '失败', text: 'text-red-700' },
  blocked: { bar: 'bg-red-500', label: '打回', text: 'text-red-700' },
  unverified: { bar: 'bg-amber-400', label: '未验证', text: 'text-amber-700' },
};

function rowStyle(s: string): { bar: string; label: string; text: string } {
  if (s === 'passed') return ROW_STATUS.passed;
  if (s === 'failed' || s === 'blocked') return ROW_STATUS.failed;
  return ROW_STATUS.unverified;
}

/** 阶段小计 chips 条：每阶段一枚（执行次数 + 失败计数），点击打开该阶段详情。
 *  数据源 = 轨迹 tab 已拉取的 trajectory-all 全量（stageCounts + rows），零额外请求。
 *  有失败/回滚的阶段用红点强调（排障聚焦），全部通过则中性色。 */
const SubtotalChips: React.FC<{
  items: StageSubtotal[];
  openStage: string | null;
  onOpen: (t: string) => void;
}> = ({ items, openStage, onOpen }) => {
  if (items.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {items.map((s) => {
        const active = openStage === s.token;
        const hasFail = s.failed > 0;
        return (
          <button
            key={s.token}
            type="button"
            onClick={() => onOpen(s.token)}
            aria-pressed={active}
            title={`${s.token}：${s.runs} 次执行${hasFail ? `，${s.failed} 次失败/打回/已回滚` : '，全部通过'}`}
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border transition-all active:scale-[0.98] ${
              active
                ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                : hasFail
                  ? 'bg-white border-red-200 text-zinc-600 hover:border-red-300 hover:bg-red-50'
                  : 'bg-white border-zinc-200 text-zinc-500 hover:border-emerald-300 hover:text-emerald-700'
            }`}
          >
            {hasFail && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" aria-hidden />}
            <span className="truncate max-w-[110px]">{s.token}</span>
            <span className={`tabular-nums shrink-0 ${active ? 'text-emerald-600' : hasFail ? 'text-red-500' : 'text-zinc-400'}`}>
              {s.runs}
            </span>
          </button>
        );
      })}
    </div>
  );
};

/** 阶段小计 chips 数据源：由 rows 聚合（rows = data.rows 全量未过滤）。 */
interface StageSubtotal {
  token: string;
  /** 该阶段执行总次数（trajectory-all 的 stageCounts 优先，rows 聚合作兜底） */
  runs: number;
  /** 该阶段失败/打回/已回滚次数（rows 聚合） */
  failed: number;
}

/** 轨迹 × git：该行对应的 commit + tag 徽标组（git 不可用/无 commit → null，不渲染）。
 *  hover commit 徽标 → 共享 GitDiffPreview：展示该 commit 相对相邻更早执行的改动，
 *  与轨迹瀑布 / 留痕行同交互（至多一个浮层）。diff 基线纯前端派生（traceBaseAt），
 *  零新接口；首条/无增量 → GitDiffPreview 自带降级提示，不阻塞行交互。 */
const GitBadge: React.FC<{
  rec: TrajectoryAllEntry;
  gitAvailable?: boolean;
  /** 全量轨迹流（时间降序，diff 基线派生数据源） */
  rows: TrajectoryAllEntry[];
  open: boolean;
  onHover: (open: boolean) => void;
  /** 目标工作区根（多工作区下 diff 按活动 root 拉） */
  root?: string | null;
}> = ({ rec, gitAvailable, rows, open, onHover, root = null }) => {
  // 数据源 gitAvailable=false（非仓库/未装 git）或该条无 commit → 整组不渲染
  if (!gitAvailable || !rec.commit) return null;
  // diff 基线：相邻更早执行时刻的最新 commit（纯函数派生；无 → GitDiffPreview 首条降级提示）
  const diffBase = traceBaseAt(rows, rec);
  return (
    <>
      <span
        className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-mono text-[10px] hover:bg-emerald-50 hover:text-emerald-700 transition-all cursor-help"
        title={[
          rec.commitFull || rec.commit,
          rec.subject ? `提交说明：${rec.subject}` : '（无提交说明）',
          diffBase ? '悬停查看相对相邻更早执行的改动' : '该次执行无更早 commit 可对比，无增量 diff',
        ].join('\n')}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
      >
        {rec.commit}
      </span>
      {rec.tag && (
        <span
          className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono text-[10px] border border-emerald-200/70"
          title={`该次执行时刻的 commit 打上了 tag：${rec.tag}`}
        >
          {rec.tag}
        </span>
      )}
      <GitDiffPreview base={diffBase} target={rec.commit || null} open={open} root={root} />
    </>
  );
};

/** 单行：一次阶段执行（阶段徽标 + 状态 + 耗时/token/工具 + 时间），点击展开该阶段详情 */
const TimelineRow: React.FC<{
  rec: TrajectoryAllEntry;
  onOpen: (t: string) => void;
  gitAvailable?: boolean;
  /** 全量轨迹流（时间降序，diff 基线派生数据源） */
  rows: TrajectoryAllEntry[];
  /** 目标工作区根（多工作区下 diff 按活动 root 拉） */
  root?: string | null;
}> = ({ rec, onOpen, gitAvailable, rows, root = null }) => {
  // 轨迹 × git diff 预览：hover commit 徽标展开（至多一个浮层，与轨迹瀑布同交互）
  const [gitOpen, setGitOpen] = React.useState(false);
  const st = rowStyle(rec.rolled_back ? 'blocked' : rec.status);
  const toolCalls = (rec.tools ?? []).filter((t) => t.type === 'tool/call').length;
  const toolOks = (rec.tools ?? []).filter((t) => t.type === 'tool/result' && t.ok).length;
  const durMs = (rec.finishedAt ?? 0) - (rec.startedAt ?? 0);
  const start = rec.startedAt ? new Date(rec.startedAt).toLocaleString('zh-CN', { hour12: false }) : '';
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs hover:border-emerald-300 transition-all group">
      <span className={`shrink-0 w-1 self-stretch rounded-full ${st.bar}`} aria-hidden />
      <button
        type="button"
        onClick={() => onOpen(rec.stage)}
        className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-mono hover:bg-emerald-50 hover:text-emerald-700 transition-all active:scale-[0.98]"
        title={`打开 ${rec.stage} 轨迹详情`}
      >
        {rec.stage}
      </button>
      <span className="shrink-0 text-[10px] text-zinc-400 font-mono">{rec.aspice}</span>
      <span className={`shrink-0 font-medium ${st.text}`}>{st.label}</span>
      {rec.rolled_back && (
        <span className="shrink-0 px-1 py-0.5 rounded bg-red-100 text-red-700 border border-red-200 text-[10px] font-mono">已回滚</span>
      )}
      <span className="shrink-0 text-zinc-400 tabular-nums">{fmtMs(durMs)}</span>
      <span className="shrink-0 text-zinc-400 tabular-nums">{rec.cost?.tokens ?? 0} tok</span>
      <span className="shrink-0 text-zinc-400 tabular-nums" title={`工具调用 ${toolCalls} 次，成功 ${toolOks} 次`}>
        ×{toolCalls}✓{toolOks}
      </span>
      {/* 轨迹 × git：该次执行时刻的最新 commit + tag（hover 查看相对相邻更早执行的改动） */}
      <GitBadge rec={rec} gitAvailable={gitAvailable} rows={rows} open={gitOpen} onHover={setGitOpen} root={root} />
      {rec.reason && (
        <span className="text-[11px] text-zinc-400 font-mono truncate max-w-[160px]" title={rec.reason}>
          {rec.reason}
        </span>
      )}
      <span className="ml-auto text-[10px] text-zinc-300 shrink-0 tabular-nums" title={rec.sessionId ?? ''}>
        {start}
      </span>
    </div>
  );
};

export const TrajectoryTimeline: React.FC<{ onOpenStage?: (t: string) => void }> = ({ onOpenStage }) => {
  const [data, setData] = React.useState<TrajectoryAll | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [onlyFailed, setOnlyFailed] = React.useState(false);
  // 展开的阶段详情（点击行内阶段徽标 → 打开单阶段面板）
  const [openStage, setOpenStage] = React.useState<string | null>(null);
  // 活动工作区 root：commit diff 按活动 root 拉（多工作区不串根）
  const activeRoot = useGitStore((s) => s.activeWorkspace?.root ?? null);

  const load = React.useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetchTrajectoryAll(200)
      .then((d) => {
        setData(d);
        if (!d) setLoadError('网关未响应或未启动');
      })
      .catch(() => setLoadError('加载失败'))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTrajectoryAll(200)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          if (!d) setLoadError('网关未响应或未启动');
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 阶段小计：从全量 rows 聚合（失败/打回/已回滚计数做强调），runs 以网关 stageCounts 为准
  // （rows 可能被 200 上限截断，stageCounts 是全量计数）。放在加载态 early-return 之前，
  // 保证每次渲染的 hook 数量一致（rules-of-hooks）。
  const subtotals = React.useMemo<StageSubtotal[]>(() => {
    const counts: Record<string, StageSubtotal> = {};
    for (const r of data?.rows ?? []) {
      const s = (counts[r.stage] ??= { token: r.stage, runs: 0, failed: 0 });
      s.runs++;
      if (r.status === 'failed' || r.status === 'blocked' || r.rolled_back) s.failed++;
    }
    const stageCounts = data?.stageCounts ?? {}; // 网关全量计数（rows 可能被 200 上限截断）
    for (const token of Object.keys(stageCounts)) {
      const s = (counts[token] ??= { token, runs: 0, failed: 0 });
      s.runs = stageCounts[token]; // 权威全量计数
    }
    // 失败多 → 执行多 → token 字母序（排障重点前置）
    return Object.values(counts).sort(
      (a, b) => b.failed - a.failed || b.runs - a.runs || a.token.localeCompare(b.token),
    );
  }, [data]);

  if (loading) {
    return (
      <div className="border border-zinc-200 rounded-lg bg-white p-3 space-y-2" role="status" aria-busy="true" aria-label="正在加载全部轨迹">
        <div className="h-4 bg-zinc-200 rounded animate-pulse w-1/3" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 bg-zinc-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }
  if (loadError || !data) {
    return (
      <div className="space-y-3">
        <div className="border border-zinc-200 rounded-lg bg-white">
          <EmptyState icon={I.warn} title="轨迹加载失败" hint={loadError ?? '无数据'} />
        </div>
        {/* 错误态给重试入口（与 Git 工作区卡同款）：网关未起/抖动时可原地重拉，
            不必切走视图再回来触发重新挂载 */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98]"
          >
            <Icon name={I.refresh} size={11} />
            重试
          </button>
        </div>
      </div>
    );
  }

  const rows = onlyFailed
    ? data.rows.filter((r) => r.status === 'failed' || r.status === 'blocked' || r.rolled_back)
    : data.rows;

  return (
    <div className="space-y-3">
      {/* 标题行：全部轨迹 · 总数 + 失败计数 + 过滤开关 + 刷新 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-emerald-600">
            <Icon name={I.timer} size={15} weight="fill" />
          </span>
          <span className="text-sm font-bold text-zinc-800">全部轨迹</span>
          <span className="text-xs text-zinc-400">（{data.total} 次执行）</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setOnlyFailed(!onlyFailed)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-all active:scale-[0.98] ${
              onlyFailed
                ? 'bg-red-50 border-red-300 text-red-700'
                : 'bg-white border-zinc-200 text-zinc-500 hover:border-red-300 hover:text-red-600'
            }`}
            title="只看失败/打回/已回滚（排障聚焦）"
            aria-pressed={onlyFailed}
          >
            <Icon name={I.warn} size={11} />
            仅失败
          </button>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98]"
            title="刷新全部轨迹"
          >
            <Icon name={I.refresh} size={11} />
            刷新
          </button>
        </div>
      </div>

      {/* 阶段小计：每阶段一枚（执行次数 + 失败强调），点击打开该阶段详情。
          数据源 = 本页已拉取的 trajectory-all，零额外请求。 */}
      <SubtotalChips items={subtotals} openStage={openStage} onOpen={setOpenStage} />

      {/* 单阶段详情（点击行内阶段徽标展开，复用 TrajectoryPanel） */}
      {openStage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-2 space-y-2 animate-fade-in-up">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-700 font-mono">{openStage}</span>
            <button
              type="button"
              onClick={() => setOpenStage(null)}
              className="text-xs px-1.5 py-0.5 rounded border border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 transition-all"
            >
              收起
            </button>
          </div>
          <TrajectoryPanel stage={openStage} limit={30} />
        </div>
      )}

      {/* 时间轴：所有轨迹按时间倒序一条流 */}
      {rows.length === 0 ? (
        <div className="text-xs text-zinc-400 py-6 text-center border border-dashed border-zinc-200 rounded-lg">
          {onlyFailed ? '没有失败/打回的轨迹' : '还没有任何阶段执行记录'}
        </div>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <TimelineRow
              key={`${r.stage}-${r.seq}-${r.startedAt}`}
              rec={r}
              rows={data.rows}
              gitAvailable={data?.gitAvailable}
              root={activeRoot}
              onOpen={(t) => {
                setOpenStage(openStage === t ? null : t);
                onOpenStage?.(t);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
