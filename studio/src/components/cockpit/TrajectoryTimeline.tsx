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
// commit 徽标 tooltip 给完整 hash + 提交说明；tag 徽标 emerald（指向同一 commit），
// 阶段收尾 tag（yxspec/<stage>/<seq>）展示短标签 `stage/seq` + 摘要（utils/gitTagName）。
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
import { hasStageTag, traceBaseAt } from '../../utils/gitTrace';
import { yxspecTagOf } from '../../utils/gitTagName';
import { filterTraceRows } from '../../utils/traceFilters';
import { modelDisplayName, shortModelName } from '../../utils/modelBadge';
import { STAGE_TABLE } from '../../data/stage-mapping';
import { useStageDispatch } from '../../hooks/useStageDispatch';
import { canRerun, rerunCommandOf, rerunLabel } from '../../utils/rerunTrajectory';
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
  // 收尾 tag 可读化：yxspec/<stage>/<seq> → 短标签 + 摘要（「SWE.2 swe_arch #7 · 阶段收尾 tag」）。
  // 仅该次执行真正打上收尾 tag（hasStageTag 判定）且能解析才展示摘要；用户自定义 tag
  // （v1.0）不解析 → 仍走裸展示（避免把非留痕 tag 误标成阶段收尾）。
  const yxTag = hasStageTag(rec) ? yxspecTagOf(rec) : null;
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
      {yxTag && (
        <span
          className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono text-[10px] border border-emerald-200/70"
          title={[
            yxTag.summary,
            yxTag.commit ? `指向 commit：${yxTag.commit}` : null,
            '（git-workspace 阶段收尾自动打的留痕 tag）',
          ].filter((l): l is string => Boolean(l)).join('\n')}
        >
          {yxTag.short}
        </span>
      )}
      {!yxTag && hasStageTag(rec) && (
        <span
          className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono text-[10px] border border-emerald-200/70"
          title={[
            `该次执行时刻的 commit 打上了 tag：${rec.tag}`,
            rec.tagCommit ? `tag 指向 commit：${rec.tagCommit}` : null,
          ].filter((l): l is string => Boolean(l)).join('\n')}
        >
          {rec.tag}
        </span>
      )}
      <GitDiffPreview base={diffBase} target={rec.commit || null} open={open} root={root} />
    </>
  );
};

/** 单行：一次阶段执行（阶段徽标 + 状态 + 耗时/token/工具 + 时间），点击展开该阶段详情。
 *  失败/打回/已回滚行 → 行尾「重跑」按钮：复用 useStageDispatch 派活该阶段命令
 *  （同驾驶舱一键派活通道），不需要切回驾驶舱就能重跑排障。 */
const TimelineRow: React.FC<{
  rec: TrajectoryAllEntry;
  onOpen: (t: string) => void;
  gitAvailable?: boolean;
  /** 全量轨迹流（时间降序，diff 基线派生数据源） */
  rows: TrajectoryAllEntry[];
  /** 目标工作区根（多工作区下 diff 按活动 root 拉） */
  root?: string | null;
  /** 重跑回调：失败/打回/已回滚行才传（否则不渲染按钮）；进行中禁用 */
  onRerun?: (rec: TrajectoryAllEntry) => void;
  rerunning?: boolean;
}> = ({ rec, onOpen, gitAvailable, rows, root = null, onRerun, rerunning = false }) => {
  // 轨迹 × git diff 预览：hover commit 徽标展开（至多一个浮层，与轨迹瀑布同交互）
  const [gitOpen, setGitOpen] = React.useState(false);
  const st = rowStyle(rec.rolled_back ? 'blocked' : rec.status);
  const toolCalls = (rec.tools ?? []).filter((t) => t.type === 'tool/call').length;
  const toolOks = (rec.tools ?? []).filter((t) => t.type === 'tool/result' && t.ok).length;
  const durMs = (rec.finishedAt ?? 0) - (rec.startedAt ?? 0);
  const start = rec.startedAt ? new Date(rec.startedAt).toLocaleString('zh-CN', { hour12: false }) : '';
  // 失败/打回/已回滚 + STAGE_TABLE 有该阶段 → 行尾渲染「重跑」（命令权威取 STAGE_TABLE）
  const showRerun = canRerun(rec, STAGE_TABLE);
  const rerunCmd = rerunCommandOf(rec, STAGE_TABLE) ?? '';
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
      {/* 模型徽标：该次执行使用的模型名（与单阶段轨迹面板同款短显 + tooltip 全名）。
          数据源 = trajectory-all 每行透传的 model（网关 listTrajectories 记录自带），零额外请求；
          git 徽标同处一行，多模型/多阶段一眼可比。无 model → 不渲染（老网关/记录缺失静默降级）。 */}
      {rec.model?.name && (
        <span
          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-mono text-[10px]"
          title={`模型：${modelDisplayName(rec.model)}${rec.model.maxTokens ? ` · maxTokens ${rec.model.maxTokens}` : ''}`}
        >
          <Icon name={I.gear} size={10} className="text-zinc-400 shrink-0" />
          {shortModelName(rec.model.name)}
        </span>
      )}
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
      {/* 失败/打回/已回滚行「重跑」：复用 useStageDispatch 派活该阶段命令（同驾驶舱
          一键派活通道）。进行中整行禁用 + 秒表，防连点重复派活。 */}
      {showRerun && (
        <button
          type="button"
          onClick={() => onRerun?.(rec)}
          disabled={rerunning}
          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-200 bg-white text-[11px] text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          title={`重跑该阶段：${rerunCmd}（复用驾驶舱派活通道，生成产物需 3-5 分钟）`}
        >
          <Icon name={rerunning ? I.clock : I.play} size={10} className={rerunning ? 'animate-spin' : undefined} />
          {rerunning ? '重跑中…' : rerunLabel(rec)}
        </button>
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
  const [onlyTagged, setOnlyTagged] = React.useState(false);
  // 文本过滤（输入即过滤）：阶段/命令/状态/commit/tag 子串。与「仅失败」「仅检查点」
  // 开关同层叠加（作用轨迹行），阶段小计 chips 不受影响（计数恒为全量）。
  const [textQuery, setTextQuery] = React.useState('');
  // 展开的阶段详情（点击行内阶段徽标 → 打开单阶段面板）
  const [openStage, setOpenStage] = React.useState<string | null>(null);
  // 活动工作区 root：commit/tag 解析 + commit diff 按活动 root 拉（多工作区不串根）。
  // 轨迹 × git 增强已支持 ?root= —— 显式传活动根，否则恒解析网关默认根（与 status/
  // commits/diff 各拉各的，轨迹流的 commit/tag 会串到别的仓库）。
  const activeRoot = useGitStore((s) => s.activeWorkspace?.root ?? null);
  // 全局派活（重跑/驾驶舱一键派活同通道）：重跑中的行显示秒表并禁用其余重跑按钮，
  // 防连点重复派活同一阶段。
  const { dispatch, sending, dispatchingCmd, elapsedSec } = useStageDispatch();
  // 行内重跑：失败/打回/已回滚行点「重跑」→ 派活该阶段命令（STAGE_TABLE 权威）。
  // 成功后该阶段已有新轨迹留痕 → 重拉 timeline；失败/门控打回由 dispatch 内 toast 承接。
  const handleRerun = async (rec: TrajectoryAllEntry) => {
    if (sending) return;
    const cmd = rerunCommandOf(rec, STAGE_TABLE);
    if (!cmd) return;
    await dispatch(cmd);
    load();
  };

  const load = React.useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetchTrajectoryAll(200, activeRoot)
      .then((d) => {
        setData(d);
        if (!d) setLoadError('网关未响应或未启动');
      })
      .catch(() => setLoadError('加载失败'))
      .finally(() => setLoading(false));
  }, [activeRoot]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTrajectoryAll(200, activeRoot)
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
  }, [activeRoot]);

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

  // 过滤计数（零新接口，纯派生）：检查点 / 失败 总数供「仅检查点」「仅失败」开关
  // 的角标（勾选态显示当前过滤子集数，未勾选显示可过滤总数）。
  // 必须在条件 return 之前调用（hooks 顺序恒定）：data 为 null（加载/错误态）
  // 时按空数据算 → 0，不渲染进 UI；加载完成后才是真实计数。
  const checkpointTotal = React.useMemo(() => (data?.rows ?? []).filter((r) => r.tag).length, [data]);
  const failureTotal = React.useMemo(
    () => (data?.rows ?? []).filter((r) => r.status === 'failed' || r.status === 'blocked' || r.rolled_back).length,
    [data],
  );

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

  const rows = filterTraceRows(data.rows, {
    onlyFailed,
    onlyTagged,
    text: textQuery,
  });

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
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {/* 文本过滤：阶段/命令/状态/commit/tag 子串（输入即过滤）。选中任一开关时
              计数角标显示当前子集数（如 3/12），未选中显示可过滤总数。 */}
          <div className="relative inline-flex items-center">
            <Icon name={I.search} size={11} className="text-zinc-400 absolute left-1.5 pointer-events-none" />
            <input
              type="search"
              value={textQuery}
              onChange={(e) => setTextQuery(e.target.value)}
              placeholder="过滤阶段 / commit / tag…"
              aria-label="过滤轨迹：阶段 / 命令 / 状态 / commit / tag"
              className="text-xs border border-zinc-300 rounded-md pl-6 pr-1.5 py-1 bg-white text-zinc-600 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 w-40"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setOnlyTagged(!onlyTagged);
              setOnlyFailed(false); // 互斥：勾检查点时收起仅失败，避免双过滤叠加语义混乱
            }}
            aria-pressed={onlyTagged}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-all active:scale-[0.98] ${
              onlyTagged
                ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                : 'bg-white border-zinc-200 text-zinc-500 hover:border-emerald-300 hover:text-emerald-700'
            }`}
            title="只看打上 yxspec 阶段收尾 tag 的执行（git 里程碑检查点）；与「仅失败」互斥"
          >
            <Icon name={I.tag} size={11} />
            仅检查点
            <span className={`tabular-nums ${onlyTagged ? 'text-emerald-600' : 'text-zinc-400'}`}>
              {onlyTagged ? rows.length : checkpointTotal}/{data.total}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOnlyFailed(!onlyFailed);
              setOnlyTagged(false); // 互斥：勾仅失败时收起检查点
            }}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-all active:scale-[0.98] ${
              onlyFailed
                ? 'bg-red-50 border-red-300 text-red-700'
                : 'bg-white border-zinc-200 text-zinc-500 hover:border-red-300 hover:text-red-600'
            }`}
            title="只看失败/打回/已回滚（排障聚焦）；与「仅检查点」互斥"
            aria-pressed={onlyFailed}
          >
            <Icon name={I.warn} size={11} />
            仅失败
            <span className={`tabular-nums ${onlyFailed ? 'text-red-500' : 'text-zinc-400'}`}>
              {onlyFailed ? rows.length : failureTotal}/{data.total}
            </span>
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
          {textQuery.trim()
            ? '没有匹配该过滤条件的轨迹'
            : onlyTagged
              ? data.gitAvailable
                ? '没有打 tag 的检查点（阶段正常收尾才打 yxspec tag；git 可用时为空）'
                : 'git 不可用：无 commit/tag 关联，无法展示检查点'
              : onlyFailed
                ? '没有失败/打回的轨迹'
                : '还没有任何阶段执行记录'}
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
              onRerun={handleRerun}
              rerunning={sending && dispatchingCmd === rerunCommandOf(r, STAGE_TABLE)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
