// =============================================================================
// GitWorkspaceCard — 「Git 工作区管控」功能卡
// 数据源：网关 /api/git*（只读采集 + 留痕，前端不执行 git）。
// 能力：
//   · 顶部：分支 + HEAD commit（mono）+ 连接状态徽标（gitAvailable 才亮）
//   · 脏文件列表：路径 + 状态色标（新增/修改/删除/未暂存），空则「工作区干净」
//   · commit 历史：最近 5 条（message + hash + 相对时间）
//   · 阶段留痕：输入/选择 stage → 列出该阶段 commit/tag 对照（复用 getGitCommits）
//   · 回滚按钮：选中一条留痕 → 底部唯一确认面板（填原因）→ recordGitRollback（只留档）→ toast 提示不自动执行
//   · 留痕 hover diff：每行该条 commit 相对上一留痕 commit 的改动（共享 ui/GitDiffPreview）
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { useGitStore } from '../../store/gitStore';
import { useToastStore } from '../../store/toastStore';
import { EmptyState, GitDiffPreview, Icon, SectionLabel } from '../ui';
import { I } from '../ui/icons';
import { STAGE_TABLE } from '../../data/stage-mapping';
import type { StageToken } from '../../data/types';
import { getGitDiff, fetchCloneProgress, type CloneProgressRecord, type GitAuditEntry, type GitDiffResult, type GitDirtyFile, type GitStageTrace, type GitWorkspace } from '../../utils/ipc';
import { gitTraceBase, recentCommitDiffs } from '../../utils/gitTrace';
import { groupGitBranches, type GitBranchGroup } from '../../utils/gitBranches';
import { auditFailureCount, filterAuditEntries } from '../../utils/gitAuditFilter';
import { retryAuditLabel, retryAuditParams, retryAuditTitle } from '../../utils/gitRetry';
import { gitWorkspaceName } from '../../utils/gitWorkspaceName';
import { toGitTagInfo, gitTagTitle } from '../../utils/gitTagTitle';

/** commit hash 缩写：保留前 8 位，其余折叠 */
function shortHash(h: string | null | undefined): string {
  if (!h) return '—';
  return h.length > 12 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
}

/** ISO/相对时间 → 相对时间文案（刚刚 / N 分钟前 / N 小时前 / N 天前） */
function relTimeOf(ts: string | null | undefined): string {
  if (!ts) return '—';
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return '—';
  const diffMin = Math.floor((Date.now() - t) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} 小时前`;
  return `${Math.floor(diffH / 24)} 天前`;
}

/** 毫秒时间戳 → 相对时间文案（审计留痕 at 是 epoch ms；缺失/非法 → '—'） */
function relTimeOfMs(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return '—';
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} 小时前`;
  return `${Math.floor(diffH / 24)} 天前`;
}

/** 审计留痕入参 → 紧凑展示文本（checkout 的 branch / clone 的 url+dir；空 → null） */
function auditArgsText(a: Record<string, string> | undefined): string | null {
  if (!a || Object.keys(a).length === 0) return null;
  const parts = Object.entries(a).map(([k, v]) => `${k}=${v}`);
  return parts.join(' ');
}

/** 脏文件状态 → 中文 + 色标（新增 emerald / 修改 amber / 删除 red / 冲突红/未暂存 zinc） */
const DIRTY_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
  added: { label: '新增', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  modified: { label: '修改', cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  deleted: { label: '删除', cls: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  renamed: { label: '重命名', cls: 'bg-zinc-100 text-zinc-600', dot: 'bg-zinc-400' },
  untracked: { label: '未跟踪', cls: 'bg-zinc-100 text-zinc-600', dot: 'bg-zinc-400' },
  conflict: { label: '冲突', cls: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
};

function dirtyStyle(s: string): { label: string; cls: string; dot: string } {
  return DIRTY_STYLE[s] ?? { label: s || '未知', cls: 'bg-zinc-100 text-zinc-600', dot: 'bg-zinc-400' };
}

/** 阶段留痕记录状态 → 文案（语义对齐轨迹面板：passed→通过 / failed→失败 / rolled_back→已回滚） */
const TRACE_STATUS_LABEL: Record<string, string> = {
  passed: '通过',
  failed: '失败',
  blocked: '打回',
  unverified: '未验证',
  rolled_back: '已回滚',
};

/** 单条 commit 行：hash（mono）+ message + 相对时间；hover/点击看该提交相对上一提交的改动。
 *  与留痕行/轨迹行同交互（hover 浮层预览，至多一个），复用共享 ui/GitDiffPreview。 */
const CommitRow: React.FC<{
  hash: string;
  message: string;
  at: string | null;
  /** 该提交相对上一条提交的 diff 基线（首条 → null，降级提示） */
  base?: string | null;
  /** 目标工作区根（diff 按活动 root 拉；缺省走网关默认根） */
  root?: string | null;
}> = ({ hash, message, at, base = null, root = null }) => {
  const [diffOpen, setDiffOpen] = React.useState(false);
  return (
    <div
      className="relative flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs hover:border-emerald-300 transition-all group"
      onMouseEnter={() => setDiffOpen(true)}
      onMouseLeave={() => setDiffOpen(false)}
      title={base ? '悬停查看该提交相对上一提交的改动 diff' : '最新提交无更早提交可对比，无 diff'}
    >
      <span className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-mono" title={hash}>
        {shortHash(hash)}
      </span>
      <span className="shrink-0 text-emerald-600">
        <Icon name={I.clock} size={12} />
      </span>
      <span className="text-zinc-600 truncate min-w-0" title={message}>
        {message || '（无提交说明）'}
      </span>
      <span className="ml-auto shrink-0 text-[10px] text-zinc-400 tabular-nums">{relTimeOf(at)}</span>
      <GitDiffPreview base={base} target={hash} open={diffOpen} root={root} />
    </div>
  );
};

/** 阶段留痕行：seq + commit + tag + 状态 + 时间 + 回滚按钮 + hover diff 预览 */
const TraceRow: React.FC<{
  rec: GitStageTrace;
  stage: string;
  confirming: boolean;
  onRollback: () => void;
  /** 上一条留痕的 commit（diff 基线；无 → null） */
  prevCommit?: string | null;
  /** git 是否可用（决定回滚按钮禁用与提示语：git 不可用时 commit 恒 null） */
  gitOk?: boolean;
  /** 目标工作区根（diff 按活动 root 拉；缺省走网关默认根） */
  root?: string | null;
}> = ({ rec, stage, confirming, onRollback, prevCommit, gitOk, root = null }) => {
  // 已回滚（后端置 rolled_back，不回改 status）：优先显示「已回滚」红标，并禁用回滚按钮
  const rolledBack = rec.rolled_back === true;
  const statusLabel = rolledBack ? '已回滚' : TRACE_STATUS_LABEL[rec.status] || rec.status || '—';
  // commit 缺失（git 不可用时后端照常返回记录、但 commit 恒 null）→ 回滚留档必 400，
  // 直接在行内禁用并给原因，避免点出确认面板后提交必失败。回滚语义：reset 到"该条 commit"，
  // 无 commit 就没有可回滚的落点。
  const noCommit = !rec.commit;
  const rollbackTitle = rolledBack
    ? '该条留痕已回滚，无需再次记录'
    : noCommit
      ? gitOk
        ? '该条留痕无 commit 关联，无法记录回滚'
        : 'git 不可用：留痕无 commit 关联，无法记录回滚'
      : '记录回滚指令（只留档，不执行 git）';
  // 留痕 diff 预览：hover 显示该条 commit 相对上一条留痕 commit 的改动（两条相邻留痕 = 一个 diff 单元）。
  // 纯 hover 浮层，与脏文件 diff 预览同款交互；回滚确认态下收起，避免两浮层叠加。
  const [diffOpen, setDiffOpen] = React.useState(false);
  return (
    <div
      className={`relative flex items-center gap-2 rounded-lg border bg-white px-2.5 py-1.5 text-xs transition-all group ${
        rolledBack ? 'border-red-200' : 'border-zinc-200 hover:border-emerald-300'
      }`}
      onMouseEnter={() => setDiffOpen(true)}
      onMouseLeave={() => setDiffOpen(false)}
      title="悬停查看该条留痕相对上一条的改动 diff"
    >
      <span className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 font-mono" title={`第 ${rec.seq} 次执行`}>
        #{rec.seq}
      </span>
      <span className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-mono" title={rec.commit}>
        {shortHash(rec.commit)}
      </span>
      {rec.tag && (
        <span className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono border border-emerald-200" title={rec.tag}>
          {rec.tag}
        </span>
      )}
      {rolledBack ? (
        <span
          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200"
          title={rec.rollbackId ? `回滚留档：${rec.rollbackId}` : undefined}
        >
          <Icon name={I.undo} size={11} />
          {statusLabel}
        </span>
      ) : (
        <span className="shrink-0 text-zinc-400">{statusLabel}</span>
      )}
      <span className="ml-auto shrink-0 text-[10px] text-zinc-400 tabular-nums">
        {rec.finishedAt ? relTimeOf(rec.finishedAt) : rec.startedAt ? `启动 ${relTimeOf(rec.startedAt)}` : '—'}
      </span>
      {confirming ? (
        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700 text-[11px]">
          待确认
        </span>
      ) : (
        <button
          type="button"
          onClick={onRollback}
          disabled={rolledBack || noCommit}
          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-zinc-200 text-zinc-500 hover:border-red-300 hover:text-red-600 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          title={rollbackTitle}
        >
          <Icon name={I.undo} size={11} />
          回滚
        </button>
      )}
      <GitDiffPreview base={prevCommit ?? null} target={rec.commit || null} open={diffOpen && !confirming} root={root} />
    </div>
  );
};

/** 脏文件行内 diff 预览浮层（hover 时拉取 /api/git/diff 展示）。
 *  只读展示（含 +N/-M 统计）；untracked/无基线/网关不可用 → 降级提示，不阻塞行交互。 */
const DirtyDiffPreview: React.FC<{ file: GitDirtyFile; open: boolean; root?: string | null }> = ({ file, open, root }) => {
  const [data, setData] = React.useState<GitDiffResult | null>(null);
  const [loading, setLoading] = React.useState(false);

  // open 变 true 才拉取（避免为每个脏文件都发请求）；同一文件重复 hover 命中缓存
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    // staged 行预览暂存区改动（--cached），其余预览工作区改动；
    // root = 活动工作区（多工作区下 diff 必须按活动 root 拉，否则恒 diff 默认根）
    getGitDiff(file.path, file.staged, { root })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, file.path, file.staged, root]);

  if (!open) return null;

  const diff = data?.diff;
  return (
    <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-zinc-200 bg-white shadow-lg p-2.5 space-y-1.5 animate-fade-in-up">
      <div className="flex items-center gap-2 text-[11px] text-zinc-400">
        <span className="font-mono text-zinc-600 truncate min-w-0" title={file.path}>
          {file.path}
        </span>
        {data?.stats && (
          <span className="ml-auto shrink-0 tabular-nums">
            <span className="text-emerald-600">+{data.stats.added}</span>
            <span className="text-red-600"> -{data.stats.removed}</span>
          </span>
        )}
      </div>
      {loading ? (
        <div className="text-[11px] text-zinc-400 py-1">正在加载 diff…</div>
      ) : diff ? (
        <pre className="max-h-56 overflow-auto text-[10px] leading-relaxed font-mono whitespace-pre bg-zinc-50 rounded-md p-2">
          {diff.split('\n').map((line, i) => {
            const cls = line.startsWith('+')
              ? 'text-emerald-700 bg-emerald-50/60'
              : line.startsWith('-')
                ? 'text-red-600 bg-red-50/60'
                : line.startsWith('@@')
                  ? 'text-zinc-500'
                  : '';
            return (
              <span key={i} className={`block w-full ${cls}`}>
                {line || ' '}
              </span>
            );
          })}
        </pre>
      ) : data?.status === 'untracked' || data?.note ? (
        <div className="text-[11px] text-zinc-400 py-1">
          {data.note || '未跟踪文件：无索引/HEAD 基线，暂无 diff 可预览'}
        </div>
      ) : data ? (
        <div className="text-[11px] text-zinc-400 py-1">该文件暂无可见改动</div>
      ) : (
        <div className="text-[11px] text-zinc-400 py-1">diff 预览不可用（网关未响应或文件不可读）</div>
      )}
    </div>
  );
};

/** 留痕 diff 预览浮层已迁移至共享组件 ui/GitDiffPreview.tsx（见 import）。 */

/** 单条 git 写操作留痕行：结果徽标 + 动作徽标 + 入参/错误 + 相对时间。
 *  成败色标与状态徽标同语义：成功 sage / 失败 red / 未确认 zinc。
 *  root 是操作时记录的仓库根（多工作区下仍展示当时操作的仓库，不随活动切换漂移）；
 *  展示用可读名（gitWorkspaceName：优先注册表 name，其次根末段目录名），
 *  完整 root 路径放 tooltip —— 操作行与工作区列表同口径，多仓库下一眼对应。
 *  结果摘要 chip（新网关审计行附带）：pull 的文件改动统计 +N/-M、fetch 的落后
 *  提交摘要（拉到 N 个新提交）—— 让「那次操作到底拉回了什么」在留痕里可回看，
 *  不再只有瞬时 toast；老审计行无此字段 → 不渲染（静默降级，不占行宽）。
 *  失败行「重试」按钮：按该条留痕记录的原 root 重跑该 action（fetch/pull/push/
 *  checkout/init；clone 失败目标目录已非空 → 白名单外不渲染）。多仓库下顶部
 *  fetch/pull/push 只作用于活动工作区，而失败留痕的 root 可能是任意已登记仓库
 *  （含非活动）——行内重试按原 root 跑，重试目标无歧义；成功后联动刷新留痕。 */
const AuditRow: React.FC<{
  e: GitAuditEntry;
  workspaces?: GitWorkspace[] | null;
  /** 单条重试进行中（按 root 互斥，防连点重复执行同仓库） */
  retrying?: boolean;
  onRetry?: (e: GitAuditEntry) => void;
}> = ({ e, workspaces = null, retrying = false, onRetry }) => {
  const argsText = auditArgsText(e.args);
  // pull 文件改动统计（老行/无净改动 → null，不渲染 chip）
  const stats = e.stats ?? null;
  // fetch 落后提交摘要（老行/无上游 → null，不渲染 chip）
  const behind = e.behind ?? null;
  // root 可读名（优先注册表 name → 根末段目录名）；完整 root 放 tooltip
  const rootName = gitWorkspaceName(e.root, workspaces);
  const title = [
    e.root ? `仓库：${e.root}（${rootName}）` : null,
    argsText ? `入参：${argsText}` : null,
    stats ? `改动统计：${stats.files} 文件 +${stats.added}/-${stats.removed}` : null,
    behind
      ? behind.delta > 0
        ? `落后提交：${behind.before} → ${behind.after}（拉到 ${behind.delta} 个新提交）`
        : behind.before > 0
          ? `落后提交：${behind.before} → ${behind.after}（无新提交）`
          : '落后提交：已是最新（远端无新提交）'
      : null,
    e.stdout ? `输出：${e.stdout}` : null,
    e.error ? `错误：${e.error}` : null,
  ]
    .filter((l): l is string => Boolean(l))
    .join('\n');
  // 失败行可原地重试（fetch/pull/push/checkout/init 且 root/关键入参齐全）
  const retryable = e.ok === false && retryAuditParams(e) !== null;
  const resultCls = e.ok
    ? 'bg-sage-100 text-sage-700 border-sage-200'
    : e.okLabel === '未确认'
      ? 'bg-zinc-100 text-zinc-600 border-zinc-200'
      : 'bg-red-100 text-red-700 border-red-200';
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs hover:border-emerald-300 transition-all group"
      title={title || undefined}
    >
      <span className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${resultCls}`}>{e.okLabel}</span>
      <span className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-mono" title={e.action}>
        {e.actionLabel}
      </span>
      {/* 操作目标仓库：可读名（优先注册表 name → 根末段目录名），完整 root 在 tooltip。
          操作行与工作区列表同口径，多仓库下一眼对应「那次操作发生在哪个仓库」。 */}
      {e.root && (
        <span
          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-100/60 text-zinc-600 border border-zinc-200 text-[10px] font-mono truncate max-w-[140px]"
          title={e.root}
        >
          <Icon name={I.branch} size={10} className="shrink-0" />
          {rootName}
        </span>
      )}
      {/* pull 文件改动统计（+N/-M，与 toast 同口径；老审计行无字段 → 不渲染） */}
      {stats && (
        <span
          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-zinc-200 text-[10px] font-mono tabular-nums"
          title={`${stats.files} 个文件改动：+${stats.added} / -${stats.removed}`}
        >
          <span className="text-zinc-400">{stats.files} 文件</span>
          <span className="text-emerald-700">+{stats.added}</span>
          <span className="text-red-600">-{stats.removed}</span>
        </span>
      )}
      {/* fetch 落后提交摘要（拉到 N 个新提交 / 无新提交 / 已是最新；老审计行无字段 → 不渲染）。
          文案与 doGitOperate 成功 toast 同口径：delta>0 = 拉到新提交；delta=0 且 before>0 =
          仍落后但本次无更新；before=0 = 已是最新。 */}
      {behind && (
        <span
          className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono tabular-nums ${
            behind.delta > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200/70' : 'bg-zinc-50 text-zinc-500 border-zinc-200'
          }`}
          title={
            behind.delta > 0
              ? `落后提交 ${behind.before} → ${behind.after}（拉到 ${behind.delta} 个新提交）`
              : behind.before > 0
                ? `落后提交 ${behind.before} → ${behind.after}（无新提交）`
                : '远端无新提交（已是最新）'
          }
        >
          {behind.delta > 0
            ? `拉到 ${behind.delta} 个新提交`
            : behind.before > 0
              ? `落后 ${behind.before} → ${behind.after}`
              : '已是最新'}
        </span>
      )}
      {argsText && (
        <span className="min-w-0 truncate text-[10px] text-zinc-400 font-mono" title={argsText}>
          {argsText}
        </span>
      )}
      {e.error && (
        <span className="min-w-0 truncate text-[10px] text-red-500" title={e.error}>
          {e.error}
        </span>
      )}
      {/* 失败行「原地重试」：按该条留痕记录的原仓库 root 重跑该 action。
          多仓库下顶部 fetch/pull/push 只作用于活动工作区，而失败留痕的 root 可能是
          任意已登记仓库（含非活动）——行内重试按原 root 跑，重试目标无歧义。
          clone/branch/缺参 → 不渲染（白名单外）；进行中该行显示秒表。 */}
      {retryable && (
        <button
          type="button"
          onClick={() => onRetry?.(e)}
          disabled={retrying}
          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-200 bg-white text-[11px] text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          title={retryAuditTitle(e)}
        >
          <Icon
            name={retrying ? I.clock : I.refresh}
            size={10}
            className={retrying ? 'animate-spin' : undefined}
          />
          {retrying ? '重试中…' : retryAuditLabel(e.action)}
        </button>
      )}
      <span className="ml-auto shrink-0 text-[10px] text-zinc-400 tabular-nums">{relTimeOfMs(e.at)}</span>
    </div>
  );
};

/** clone 进度条（区块 B「远程仓库」克隆中渲染）。
 *  数据源 = 网关 /api/git/clone-progress（spawn 版 clone 逐行解析 stderr 写入的内存注册表）。
 *  能力：
 *    · running → 实时百分比条（Receiving objects / Resolving deltas 阶段文案），
 *      pct 为 null（starting / 服务器无统计）→ 不定长流动条 + 「连接远程…」
 *    · done / failed → 终态（克隆完成的瞬时置绿，随后按钮态即切换）
 *    · 老网关无此端点 / 网关未起 / 无注册表（entries 空）→ 返回 null，
 *      克隆表单退回纯「执行中…（已执行 Ns）」秒表，不阻塞既有流程 */
const CloneProgressBar: React.FC<{ dir: string }> = ({ dir }) => {
  const [prog, setProg] = React.useState<CloneProgressRecord | null>(null);
  const [unavailable, setUnavailable] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    // 轮询统一按网关 key 口径：trim + 反斜杠→正斜杠（与 gitOperate 的 args.dir 归一一致，
    // 否则用户输入 `D:\Work\x` 时精确匹配恒落空）。dir 匹配到才开始展示（避免误显示
    // 上一次克隆的陈旧「已完成」）。老网关无端点 → unavailable，静默降级为纯秒表。
    const timer = setInterval(async () => {
      const r = await fetchCloneProgress(dir);
      if (cancelled) return;
      if (r?.entries?.length) {
        setProg(r.entries[0]);
        setUnavailable(false);
      } else if (!r) {
        setUnavailable(true);
      }
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [dir]);

  // 网关无端点/未起（unavailable）或始终无进度数据 → 静默降级，不占表单空间
  if (unavailable || !prog) return null;
  const done = prog.status === 'done';
  const failed = prog.status === 'failed';
  const pct = prog.pct;
  // 阶段文案：receiving=收到对象 / deltas=解析增量 / starting=连接远程（不定长流动）
  const stageText =
    prog.stage === 'receiving' ? '接收对象' : prog.stage === 'deltas' ? '解析增量' : '连接远程…';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-zinc-500 inline-flex items-center gap-1">
          {failed ? (
            <span className="text-red-600 inline-flex items-center gap-1">
              <Icon name={I.warn} size={11} weight="fill" />
              克隆失败
            </span>
          ) : (
            <>
              <span className="text-zinc-400">{stageText}</span>
              <span className="text-zinc-300">·</span>
              <span className="text-zinc-600 font-mono tabular-nums">{pct != null ? `${pct}%` : '—'}</span>
            </>
          )}
        </span>
        {done && (
          <span className="text-sage-700 inline-flex items-center gap-1 font-medium">
            <Icon name={I.check} size={11} weight="fill" />
            克隆完成
          </span>
        )}
      </div>
      {/* 百分比确定时实心进度条；无 pct（starting/无统计）→ 不定长流动条 */}
      <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden" role="progressbar" aria-label="克隆进度" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        {pct != null ? (
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              failed ? 'bg-red-400' : done ? 'bg-sage-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
          />
        ) : (
          <div className={`h-full w-1/3 rounded-full animate-slide ${failed ? 'bg-red-300' : 'bg-emerald-300'}`} />
        )}
      </div>
      {failed && prog.error && (
        <div className="text-[11px] text-red-600 truncate" title={prog.error}>
          {prog.error}
        </div>
      )}
    </div>
  );
};

export const GitWorkspaceCard: React.FC = () => {
  const status = useGitStore((s) => s.status);
  const loading = useGitStore((s) => s.loading);
  const loadError = useGitStore((s) => s.loadError);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const commits = useGitStore((s) => s.commits);
  const commitsLoading = useGitStore((s) => s.commitsLoading);
  const commitsError = useGitStore((s) => s.commitsError);
  const loadCommits = useGitStore((s) => s.loadCommits);
  const rollback = useGitStore((s) => s.rollback);
  const pushToast = useToastStore((s) => s.push);
  // 写操作审计留痕（操作留痕区块数据源）：写操作完成后联动刷新，失败可回看
  const audit = useGitStore((s) => s.audit);
  const auditLoading = useGitStore((s) => s.auditLoading);
  const auditError = useGitStore((s) => s.auditError);
  const loadAudit = useGitStore((s) => s.loadAudit);

  // 多工作区管理：注册表 / 活动工作区 / 写操作态（gitOperate、workspaces 增删共用）
  const workspaces = useGitStore((s) => s.workspaces);
  const activeWorkspace = useGitStore((s) => s.activeWorkspace);
  const workspaceLoading = useGitStore((s) => s.workspaceLoading);
  const workspaceError = useGitStore((s) => s.workspaceError);
  const operating = useGitStore((s) => s.operating);
  const refreshWorkspaces = useGitStore((s) => s.refreshWorkspaces);
  // 活动工作区 root：脏文件/留痕 diff、阶段留痕 commit 都按它拉（多工作区不串根）
  const activeRoot = activeWorkspace?.root ?? null;

  // 阶段留痕：当前选中 stage（默认第一个有命令的阶段）+ 确认中的回滚目标
  const stageTokens = Object.keys(STAGE_TABLE) as StageToken[];
  const [traceStage, setTraceStage] = React.useState<string>(stageTokens[0] ?? '');
  // 阶段留痕「仅 tag 检查点」过滤：只显示打上 tag 的留痕（里程碑节点），
  // 过滤是纯前端展示态（不重拉接口），tag 缺失的留痕不参与勾选
  const [traceTagOnly, setTraceTagOnly] = React.useState(false);
  const [confirmTarget, setConfirmTarget] = React.useState<GitStageTrace | null>(null);
  const [rollbackReason, setRollbackReason] = React.useState('');
  // 回滚留档提交中：禁用确认按钮 + 显示进度，防重复提交
  const [rolling, setRolling] = React.useState(false);
  // 确认面板 DOM 引用 + 上一次确认目标：确认面板常驻挂载（切目标不重挂），
  // 若在别的留痕行点了「回滚」，面板内容原地变但不在视区内、autoFocus 也不重触发，
  // 用户看不到"现在确认的是哪条"——因此切目标时把面板滚进视区（面板头注明
  // 留痕 #seq，配合目标行自身的「待确认」徽标，确认对象无歧义）。
  const confirmRef = React.useRef<HTMLFormElement | null>(null);
  const confirmingRef = React.useRef<GitStageTrace | null>(null);
  React.useEffect(() => {
    // 关闭确认态 → 重置上一次目标（下次打开由 autoFocus 负责首次滚入视区）
    if (!confirmTarget) {
      confirmingRef.current = null;
      return;
    }
    // 目标已切到另一条留痕（same-trace 刷新/恢复确认态不重滚）：滚进视区
    const changed =
      confirmingRef.current !== null &&
      (confirmingRef.current.seq !== confirmTarget.seq ||
        confirmingRef.current.commit !== confirmTarget.commit);
    confirmingRef.current = confirmTarget;
    if (changed) confirmRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [confirmTarget]);

  // 挂载：先取工作区注册表确立 activeWorkspace，再按该 root 拉 status ——
  // 不能并行拉：status 在 activeWorkspace 还是 null 时会按默认根拉取，
  // 与高亮的活动工作区错位（多仓库下展示的是别的仓库的分支/HEAD/脏文件，
  // 而 fetch/pull/push 却作用在活动工作区上）。
  // 工作区区块仍先就绪先渲染（不阻塞添加/切换），status 紧随其后。
  React.useEffect(() => {
    refreshWorkspaces().finally(() => refreshStatus().catch(() => {}));
    loadAudit().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshWorkspaces, refreshStatus, loadAudit]);

  React.useEffect(() => {
    loadCommits(traceStage).catch(() => {});
    // 活动工作区切换 → 按新 root 重拉留痕（阶段↔commit/tag 是 per-root 的）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceStage, loadCommits, activeRoot]);

  const dirtyCount = status?.dirtyFiles?.length ?? 0;
  // 工作区脏文件改动汇总（git diff HEAD --numstat 聚合：+N/-M 行数 + 文件数）。
  // 与头部「N 处改动」同源；老网关/无 HEAD/无净改动 → null，section 头部 chip 不渲染。
  const dirtyStats = status?.dirtyStats ?? null;
  // 悬停预览 diff 的文件路径（仅一个；state 驱动渲染，与 CommitRow/TraceRow 的
  // hover 预览同交互——ref 不触发重渲染，悬停永远不出现预览，是已修的死角）。
  // 固定展开 diff 的文件路径（点击 diff 按钮或空格/回车切换；最多一个浮层）。
  // 任一非空时另一路径的 hover 预览即被抑制（open 表达式里 `openFile === null` 保证
  // 任意时刻至多一个浮层）——否则钉住 A 再悬停 B 会叠出第二块 diff。
  const [hoverFile, setHoverFile] = React.useState<string | null>(null);
  const [openFile, setOpenFile] = React.useState<string | null>(null);
  // 最近 5 条 commit（取带 message 的，倒序排列）；后端字段 recentCommits，旧字段 recent 兜底
  const recent = [...(status?.recentCommits ?? status?.recent ?? [])].slice(0, 5);
  // 相邻提交 diff 基线（hash → 相对上一提交的 commit）：留痕/轨迹行同口径（相邻 = 一个 diff 单元），
  // 首条（最新）无更早提交 → 无 base，由 GitDiffPreview 首条降级提示承接。
  const commitBaseByHash = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const d of recentCommitDiffs(recent)) {
      if (d.base) m.set(d.hash, d.base);
    }
    return m;
  }, [recent]);
  const tags = status?.tags ?? [];
  // 指向当前 HEAD 的 tag（后端 /api/git/status 已解析；老网关无此字段 → 空数组，
  // tag 列表退化为全中性色展示，HEAD 高亮静默缺失不报错）
  const headTags = status?.headTags ?? [];
  // git 连接态：status 存在时 loadError 必为 false（loadError 会在上方 early-return 成
  // EmptyState，见 403-425 行），因此本分支实际只有两态 —— git 可用（sage 绿）或
  // git 不可用（amber 警告：网关在线但工作区非 git 仓库 / 未装 git）。
  // 旧实现把 !gitOk 渲染成「未连接」灰标，与下方红色 error 条语义冲突（网关明明连着）。
  const gitOk = status?.gitAvailable === true;
  // 游离 HEAD（git checkout <commit>/<tag> 后 detached；网关 status.detached 已解析）：
  // 分支框收起态给「游离 HEAD」占位（不再是裸「—」），分支区块警示徽标 amber 强调。
  const detached = status?.detached === true;

  // ---- 工作区管理 UI 状态 ----
  // 添加表单（区块 B）：默认收起，点「+ 添加」展开；form 内 tab 决定本地/远程
  const [wsFormOpen, setWsFormOpen] = React.useState(false);
  const [wsMode, setWsMode] = React.useState<'local' | 'remote' | 'init'>('local');
  const [wsPath, setWsPath] = React.useState('');
  const [wsUrl, setWsUrl] = React.useState('');
  const [wsDir, setWsDir] = React.useState('');
  const [wsInitDir, setWsInitDir] = React.useState('');
  const [wsFormError, setWsFormError] = React.useState<string | null>(null);
  // 分支切换（区块 C）：首次展开时拉 branches，选中后 checkout。
  // 分组派生纯前端（utils/gitBranches.groupGitBranches）：本地分支在前、
  // 远端按 remote 分组（多远端仓库一眼可分），checkout 的 value 恒为原始分支名
  // （不改变既有 checkout 语义 —— 远端分支仍按原样 checkout）。
  const [branchPanelOpen, setBranchPanelOpen] = React.useState(false);
  const [branches, setBranches] = React.useState<string[]>([]);
  const branchGroups = React.useMemo<GitBranchGroup[]>(
    () => groupGitBranches(branches, status?.branch ?? null),
    [branches, status?.branch],
  );
  const branchTotal = React.useMemo(
    () => branchGroups.reduce((n, g) => n + g.branches.length, 0),
    [branchGroups],
  );
  const [branchLoading, setBranchLoading] = React.useState(false);
  const [branchValue, setBranchValue] = React.useState('');
  const [branchError, setBranchError] = React.useState<string | null>(null);
  // push 二次确认（区块 C）：点 push 展开红边确认框
  const [pushConfirmOpen, setPushConfirmOpen] = React.useState(false);
  // 正在执行的 git 操作（fetch/pull/push）：operating 是全局互斥锁，
  // 单靠它区分不了三个按钮哪个在跑；busyAction 记下本次动作，
  // 只有它自己显示「执行中…」，其余按钮保持原 label 但同样禁用。
  const [busyAction, setBusyAction] = React.useState<'fetch' | 'pull' | 'push' | null>(null);
  // git 写操作执行时长反馈：clone/init/fetch/pull/push 这类长操作（大仓库克隆/拉取
  // 常 30s~2min）期间递增秒数，替代静态「执行中…」——用户能区分「还在跑」和「卡死」。
  // 复用 operating 全局互斥锁（clone/init 也走 store.gitOperate → operating=true，
  // 无需 busyAction 覆盖）；与自迭代派活「已执行 Ns」同款交互。
  const [opElapsed, setOpElapsed] = React.useState(0);
  React.useEffect(() => {
    if (!operating) return;
    setOpElapsed(0); // 新操作开始 → 秒数归零重计
    const t = setInterval(() => setOpElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [operating]);
  // 秒数 > 0 才拼接（亚秒操作不显示），格式与自迭代派活一致：`（已执行 Ns）`
  const opSuffix = operating && opElapsed > 0 ? `（已执行 ${opElapsed}s）` : '';
  // 移除工作区的行内二次确认：移除是登记表变更（若删的是活动工作区会翻转 active、
  // 触发 status 按新 root 重拉），点「移除」只进入确认态，点「确认」才真正移除
  // —— 与 push / 回滚留档的确认范式一致，防误点。
  const [confirmRemoveId, setConfirmRemoveId] = React.useState<string | null>(null);
  // 操作留痕「仅失败」聚焦：只显示失败的写操作（fetch/pull/push/checkout/clone/init
  // 里 ok===false 的条目），成功操作常把失败淹没 —— 与全局轨迹时间轴「仅失败」开关
  // 同模式：纯前端过滤态，不重拉接口；计数徽标显示当前失败子集 / 可过滤总数。
  const [onlyAuditFailed, setOnlyAuditFailed] = React.useState(false);
  // 操作留痕「行内重试」进行中的仓库 root：按 root 互斥（同一仓库的失败行只允许
  // 一条在重试），进行中行显示秒表 + 其余行禁用重试 —— 防连点重复执行同一操作。
  const [retryingRoot, setRetryingRoot] = React.useState<string | null>(null);
  // 操作留痕过滤派生（与 TrajectoryTimeline 的 failureTotal/rows 同口径）：
  // 计数恒按全量算，过滤只作用展示行 —— 数据源不重拉，接口零新增。
  const auditFailTotal = React.useMemo(() => auditFailureCount(audit), [audit]);
  const visibleAudit = React.useMemo(
    () => filterAuditEntries(audit, { onlyFailed: onlyAuditFailed }),
    [audit, onlyAuditFailed],
  );

  // 活动工作区切换 → 分支缓存属于旧 root：清空并收起分支面板，
  // 否则在 A 展开过的分支列表会在切到 B 后原样展示，选中 checkout 会串根执行到 B。
  // push 二次确认面板同理：在 A 打开过会原地重渲染成 B 的 root，回车确认会静默
  // 推送到 B——切 root 即一并收起，新仓库重新走确认流程。
  // 回滚确认面板同理：留痕列表随 activeRoot 重拉后 commit 已是新 root 的对应值，
  // 若面板仍锚着旧 root 的 #seq/commit，切走后回车会把一条「当前列表无锚点」的
  // 回滚写进审计（无行标「待确认」、commit 与现留痕不匹配）——切 root 一并收起。
  React.useEffect(() => {
    setBranches([]);
    setBranchPanelOpen(false);
    setBranchValue('');
    setBranchError(null);
    setPushConfirmOpen(false);
    setConfirmTarget(null);
    setRollbackReason('');
  }, [activeWorkspace?.id]);

  // 工作区校验（前端只做空串拦截，路径存在性由网关校验）
  const validateWsPath = (p: string): string | null =>
    !p || !p.trim() ? '请输入本地仓库路径' : null;

  // 添加本地工作区：登记后刷新注册表 + 状态（status 按新 active 的 root 重拉）
  const doAddLocal = async () => {
    const err = validateWsPath(wsPath);
    if (err) {
      setWsFormError(err);
      return;
    }
    setWsFormError(null);
    try {
      await useGitStore.getState().addWorkspace(wsPath.trim());
      pushToast('success', '已添加工作区');
      setWsPath('');
      setWsFormOpen(false);
      await refreshWorkspaces().catch(() => {});
      await refreshStatus().catch(() => {});
    } catch (e: any) {
      setWsFormError(e?.message || '添加失败');
      pushToast('error', `添加工作区失败：${e?.message || e}`);
    }
  };

  // 克隆远程仓库：gitOperate clone → 网关自动登记 → 成功后激活新仓库（切 active +
  // 重拉 status；克隆完立刻能看到新仓库的脏文件/分支/HEAD，多仓库下不再停留在旧 root）。
  // 目标目录必填：网关 clone 的 dir 是「仓库落盘目录」（git clone <url> <dir>），不是父
  // 目录——旧实现留空时回落活动工作区根，而工作区根是非空 git 仓库，克隆必被网关以
  // 「目标目录已存在且非空」打回，表单却宣称「默认当前工作区根」，是必失败的死角。
  // 改必填 + 前端先校验，给明确内联错误，不再把失败留给网关。
  const doCloneRemote = async () => {
    const err = !wsUrl || !wsUrl.trim()
      ? '请输入远程仓库地址'
      : !wsDir || !wsDir.trim()
        ? '请输入克隆目标目录（仓库将创建在该目录下）'
        : null;
    if (err) {
      setWsFormError(err);
      return;
    }
    setWsFormError(null);
    try {
      const res = await useGitStore.getState().gitOperate({
        root: wsDir.trim(),
        action: 'clone',
        args: { url: wsUrl.trim(), dir: wsDir.trim() },
      });
      await useGitStore.getState().activateAfterAdd(res);
      pushToast('success', '克隆完成，已登记并切换工作区');
      setWsUrl('');
      setWsDir('');
      setWsFormOpen(false);
      await refreshWorkspaces().catch(() => {});
    } catch (e: any) {
      setWsFormError(e?.message || '克隆失败');
      pushToast('error', `克隆失败：${e?.message || e}`);
    }
  };

  // 新建本地仓库：gitOperate init → 网关 mkdir + git init + 自动登记 → 成功后激活新仓库
  const doInitLocal = async () => {
    const target = wsInitDir.trim();
    const err = !target
      ? '请输入新建仓库目录'
      : !/^[A-Za-z]:[\\/]/.test(target)
        ? '需为 Windows 绝对路径（如 D:/Work/04_Temp/新仓库目录）'
        : null;
    if (err) {
      setWsFormError(err);
      return;
    }
    setWsFormError(null);
    try {
      const res = await useGitStore.getState().gitOperate({
        // root 语义同 clone：只是「目标父目录」锚点（网关 init 只取 args.dir，不要求已登记）。
        // 必须传合法绝对路径（target 已过前端绝对路径校验）：传 activeWorkspace?.root || ''
        // 在「全新安装/零工作区」时 root 为空串 → 网关锚点校验恒 bad-request，
        // init 必失败；传 target 与 clone 的 root=wsDir 同口径。
        root: target,
        action: 'init',
        args: { dir: target },
      });
      await useGitStore.getState().activateAfterAdd(res);
      pushToast('success', '已创建并登记新仓库');
      setWsInitDir('');
      setWsFormOpen(false);
      await refreshWorkspaces().catch(() => {});
    } catch (e: any) {
      setWsFormError(e?.message || '新建仓库失败');
      pushToast('error', `新建仓库失败：${e?.message || e}`);
    }
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (operating) return;
    void (wsMode === 'local' ? doAddLocal() : wsMode === 'init' ? doInitLocal() : doCloneRemote());
  };

  const doSetActive = async (id: string) => {
    try {
      await useGitStore.getState().setActive(id);
      pushToast('success', '已切换当前工作区');
    } catch (e: any) {
      pushToast('error', `切换工作区失败：${e?.message || e}`);
    }
  };

  const doRemove = async (id: string) => {
    try {
      await useGitStore.getState().removeWorkspace(id);
      pushToast('success', '已移除工作区');
      setConfirmRemoveId(null);
    } catch (e: any) {
      pushToast('error', `移除工作区失败：${e?.message || e}`);
    }
  };

  // 分支列表：首次打开面板才拉（gitOperate branch 只读列分支，不做切换）。
  // force=true：写操作成功后强制重拉（绕过「有缓存就跳过」的守卫），
  // 让 fetch 拉到的新远端分支 / checkout 新建的本地分支立即可见；
  // 缺省 false 保持「面板打开才拉一次」的既有语义。
  const loadBranches = async (force = false) => {
    if ((!force && branches.length > 0) || !activeWorkspace) return;
    setBranchLoading(true);
    setBranchError(null);
    try {
      const res = await useGitStore.getState().gitOperate({
        root: activeWorkspace.root,
        action: 'branch',
      });
      setBranches(res?.branches ?? []);
    } catch (e: any) {
      setBranchError(e?.message || '分支列表加载失败');
    } finally {
      setBranchLoading(false);
    }
  };

  // 写操作成功后分支缓存失效：面板展开 → 原地强制重拉（新分支立即可见，带
  // 「加载分支中…」刷新态）；面板收起 → 仅清空缓存（下次打开重拉，避免陈旧
  // 列表，也不闪「加载分支中…」）。checkout 成功后面板已收起，走清空分支。
  const invalidateBranches = (panelClosing = false) => {
    if (!panelClosing && branchPanelOpen) void loadBranches(true);
    else setBranches([]);
  };

  const doCheckout = async (branch: string) => {
    if (!activeWorkspace || !branch) return;
    setBranchError(null);
    try {
      await useGitStore.getState().gitOperate({
        root: activeWorkspace.root,
        action: 'checkout',
        args: { branch },
      });
      pushToast('success', `已切换到分支 ${branch}`);
      setBranchValue('');
      setBranchPanelOpen(false);
      await refreshStatus().catch(() => {});
      // checkout 也是写操作 → 联动刷新操作留痕
      loadAudit().catch(() => {});
      // checkout 会新建本地跟踪分支 / 改变当前分支 → 清空分支缓存（下次打开重拉），
      // 且不再回滚上一次（invalidateBranches 后 status.branch 已更新）。
      // panelClosing=true：面板即将收起，跳过「展开强制重拉」，只清空缓存。
      invalidateBranches(true);
    } catch (e: any) {
      setBranchError(e?.message || `切换分支失败：${branch}`);
      // 失败回退分支选择：checkout 失败后 branchValue 仍指向该分支，下拉框会把
      // 它显示成「已选中」，与头部实际分支相悖（所见≠实际）；且该 option 已
      // 命中选中态，再点同一条分支 onChange 不触发 → 无法原地重试。
      // 清空回「选择分支…」占位，面板保持展开可立即重选（值已复位，重选同一条
      // 分支也会重新触发 onChange）。
      setBranchValue('');
    }
  };

  // git 写操作（fetch/pull/push）：成功后刷新状态，失败推 error toast
  const doGitOperate = async (action: 'fetch' | 'pull' | 'push') => {
    if (!activeWorkspace) return;
    const label = action === 'fetch' ? '拉取远端' : action === 'pull' ? '同步远端' : '推送本地提交';
    setBusyAction(action);
    try {
      const res = await useGitStore.getState().gitOperate({ root: activeWorkspace.root, action });
      // fetch 成功后若网关返回了落后提交摘要（before/after/delta），拼进成功 toast：
      // 「已拉取远端更新（落后 3 → 0，拉到 3 个新提交）」——无上游/无更新时维持原文案。
      const behind = res?.behind;
      const stats = res?.stats;
      pushToast(
        'success',
        action === 'fetch'
          ? behind
            ? behind.delta > 0
              ? `已拉取远端更新（落后 ${behind.before} → ${behind.after}，拉到 ${behind.delta} 个新提交）`
              : behind.before > 0
                ? `已拉取远端更新（落后 ${behind.before} → ${behind.after}，无新提交）`
                : '已拉取远端更新（已是最新）'
            : '已拉取远端更新'
          : action === 'pull'
            ? stats
              ? `已同步远端更新（${stats.files} 文件 +${stats.added}/-${stats.removed}）`
              : '已同步远端更新'
            : '已推送到远端',
      );
      if (action === 'push') setPushConfirmOpen(false);
      await refreshStatus().catch(() => {});
      // 写操作成功 → 联动刷新操作留痕（本次操作的审计行立即出现，不用手动点刷新）
      loadAudit().catch(() => {});
      // fetch 会拉入新的远端分支 / pull 会新建本地跟踪分支 / push 可能改变上游状态
      // → 分支缓存失效（面板展开强制重拉，收起清空留待下次打开），下拉不再显示陈旧分支
      invalidateBranches();
    } catch (e: any) {
      pushToast('error', `${label}失败：${e?.message || e}`);
    } finally {
      setBusyAction(null);
    }
  };

  // 操作留痕「行内重试」：按该条留痕记录的原 root 重跑该 action（fetch/pull/push/
  // checkout/init）。多仓库下顶部按钮只作用于活动工作区，而失败留痕的 root 可能是
  // 任意已登记仓库（含非活动）——行内重试按原 root 跑，重试目标无歧义。
  // 复用 operating 全局互斥锁（gitOperate 内置）；retryingRoot 记录本次 root，
  // 重试进行中该行显示「重试中…」秒表、其余失败行重试按钮禁用（按 root 互斥）。
  // 成功/失败都联动刷新留痕（本次重试的审计行立即出现；失败原因可回看再试）。
  const doRetryAudit = async (e: GitAuditEntry) => {
    const params = retryAuditParams(e);
    if (!params || operating) return;
    setRetryingRoot(e.root);
    const label = e.actionLabel || e.action;
    try {
      await useGitStore.getState().gitOperate(params);
      pushToast('success', `重试${label}成功（${e.root}）`);
    } catch (err: any) {
      pushToast('error', `重试${label}失败：${err?.message || err}`);
    } finally {
      setRetryingRoot(null);
      await refreshStatus().catch(() => {});
      loadAudit().catch(() => {});
      // 重试的写操作也可能改变分支（fetch 拉新远端分支 / checkout 切分支）→ 同样失效分支缓存
      invalidateBranches();
    }
  };

  const doRollback = async () => {
    if (!confirmTarget || rolling) return;
    // 目标已被标记回滚（如刷新时新拉的数据）→ 关闭确认态，防重复留档
    if (confirmTarget.rolled_back === true) {
      setConfirmTarget(null);
      setRollbackReason('');
      return;
    }
    setRolling(true);
    try {
      const ok = await rollback({
        stage: traceStage,
        seq: confirmTarget.seq,
        commit: confirmTarget.commit,
        reason: rollbackReason.trim() || '前端工作区管控（未填原因）',
      });
      if (ok === false) return; // 后端返回 ok:false：保持确认态让用户可重试
      setConfirmTarget(null);
      setRollbackReason('');
      // 留档成功后续拉一次该阶段留痕，让「已回滚」状态可见
      loadCommits(traceStage).catch(() => {});
    } catch {
      // 失败 toast 已在 store 内 push；保持确认态让用户可改原因重试
    } finally {
      setRolling(false);
    }
  };

  // 回滚确认提交：确认面板包在 <form> 里，回车（Enter）即可直接提交留档，
  // 不必离开键盘去点「确认回滚留档」按钮。disabled 与确认按钮同步
  // （原因为空 / 提交中不响应），避免空原因误提交。
  const handleRollbackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rollbackReason.trim() || rolling) return;
    void doRollback();
  };

  // status 未就绪的骨架/错误态不再整体 early-return：工作区管理（区块 A）不依赖
  // status，登记/切换/添加在 status 失败或未加载时仍可用——「+ 添加」入口不因
  // 网关状态端点失败而消失。错误态/骨架只作用于区块 C 及以下的状态展示区。
  return (
    <div className="p-4 space-y-4">
      {/* 标题行 + 刷新 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-emerald-600">
            <Icon name={I.branch} size={15} weight="fill" />
          </span>
          <span className="text-sm font-bold text-zinc-800">Git 工作区管控</span>
          <span className="text-xs text-zinc-400">
            {gitOk ? `（${dirtyCount} 处改动）` : !status ? (loading ? '（状态加载中…）' : '（状态不可用）') : '（git 不可用，状态未知）'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => refreshStatus().catch(() => {})}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
          title="刷新工作区状态"
        >
          <Icon name={I.refresh} size={11} />
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      {/* 区块 A：工作区列表（多仓库）——顶部连接卡之前。
          展示网关注册表（auto 自动透传默认根 / manual 手动登记），可切换当前活动工作区、
          移除手动登记；git 不可用但已有工作区时仍渲染本区块（登记表不依赖 git 可用）。 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <SectionLabel>工作区</SectionLabel>
          <button
            type="button"
            onClick={() => setWsFormOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98]"
            aria-expanded={wsFormOpen}
            title={wsFormOpen ? '收起添加表单' : '添加本地仓库、克隆远程仓库，或新建本地仓库'}
          >
            <Icon name={I.plus} size={11} />
            添加
          </button>
        </div>

        {workspaceLoading && workspaces.length === 0 ? (
          // 骨架只给「真无数据」的首拉：列表为空时没东西可展示，骨架承接加载中。
          // 写操作成功后的联动刷新不闪骨架——store 已在写操作响应里同步过新列表
          // （addWorkspace/removeWorkspace/activateAfterAdd 都 set workspaces），
          // 此时列表有内容，refreshWorkspaces 只应在后台静默对齐，而非把刚刷新的
          // 列表闪成 3 根灰条再跳回（数据其实已在手里）。
          <div className="space-y-1" role="status" aria-busy="true" aria-label="正在加载工作区列表">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-9 bg-zinc-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : workspaceError ? (
          <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-red-200 rounded-lg space-y-1.5">
            <div>工作区列表加载失败（{workspaceError}）</div>
            <button
              type="button"
              onClick={() => refreshWorkspaces().catch(() => {})}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98]"
            >
              <Icon name={I.refresh} size={11} />
              重试
            </button>
          </div>
        ) : workspaces.length === 0 ? (
          // 零工作区 = 首次登记路径：给直接入口（CTA 按钮打开下方添加表单，input 自动聚焦），
          // 不再只指向上方小字「+ 添加」——首次打开该功能卡的用户找不到登记入口的体验死角。
          <div className="text-xs text-zinc-400 py-4 px-3 text-center border border-dashed border-zinc-200 rounded-lg space-y-2">
            <div>暂无工作区：登记本地仓库、克隆远程仓库，或新建本地仓库（git init）</div>
            <button
              type="button"
              onClick={() => setWsFormOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98]"
              title="打开添加表单：本地路径 / 远程仓库 / 新建仓库"
            >
              <Icon name={I.plus} size={11} />
              添加工作区
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {workspaces.map((w: GitWorkspace) => {
              const isActive = activeWorkspace?.id === w.id;
              const isAuto = w.source === 'auto';
              return (
                <div
                  key={w.id}
                  className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-all ${
                    isActive ? 'border-emerald-400 bg-emerald-50/40' : 'border-zinc-200 bg-white hover:border-zinc-300'
                  }`}
                >
                  <span
                    className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium ${
                      isAuto ? 'bg-sage-100 text-sage-700' : 'bg-zinc-100 text-zinc-600'
                    }`}
                    title={isAuto ? '自动透传默认根目录' : '手动登记的工作区'}
                  >
                    {isAuto ? '自动' : '手动'}
                  </span>
                  <span className="shrink-0 text-zinc-600">
                    <Icon name={I.branch} size={11} />
                  </span>
                  <span className="font-mono text-zinc-700 truncate min-w-0" title={w.root}>
                    {w.name}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-zinc-400 truncate max-w-48" title={w.root}>
                    {w.root}
                  </span>
                  {/* hover 操作：非当前行「设为当前」；手动行「移除」；自动当前行标「默认」 */}
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => doSetActive(w.id)}
                      disabled={operating}
                      className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-200 bg-white text-[11px] text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      title="切换为当前工作区"
                    >
                      设为当前
                    </button>
                  )}
                  {!isAuto && (
                    confirmRemoveId === w.id ? (
                      <span
                        className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700 text-[11px]"
                        title="再次点击「确认移除」才真正移除该工作区"
                      >
                        <Icon name={I.warn} size={11} />
                        确认移除？
                        <button
                          type="button"
                          onClick={() => doRemove(w.id)}
                          disabled={operating}
                          className="px-1.5 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                          title="确认移除该工作区（不做删除，仅取消登记）"
                        >
                          确认
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          disabled={operating}
                          className="px-1.5 py-0.5 rounded bg-white border border-red-200 text-red-700 hover:bg-red-50 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                          title="取消移除"
                        >
                          取消
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(w.id)}
                        disabled={operating}
                        className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-200 bg-white text-[11px] text-zinc-500 hover:border-red-300 hover:text-red-600 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                        title="移除该工作区（不做删除，仅取消登记）"
                      >
                        <Icon name={I.trash} size={11} />
                        移除
                      </button>
                    )
                  )}
                  {isActive && (
                    <span
                      className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[11px] font-medium border border-emerald-200/70"
                      title={isAuto ? '当前工作区（自动透传默认根，不可移除）' : '当前工作区（点击「设为当前」切换）'}
                    >
                      当前
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 区块 B：添加工作区表单（默认收起；复用回滚确认面板的 form 范式，zinc 中性边） */}
        {wsFormOpen && (
          <form
            onSubmit={handleAddSubmit}
            className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-2.5 space-y-2 animate-fade-in-up"
          >
            {/* 模式 tabs：本地路径 / 远程仓库 / 新建仓库 */}
            <div className="flex gap-1">
              {(
                [
                  ['local', '本地路径'],
                  ['remote', '远程仓库'],
                  ['init', '新建仓库'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setWsMode(mode);
                    setWsFormError(null);
                  }}
                  disabled={operating}
                  className={`px-2 py-0.5 rounded text-xs border transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed ${
                    wsMode === mode
                      ? 'bg-emerald-600 text-white border-emerald-700'
                      : 'bg-white border-zinc-200 text-zinc-500 hover:border-emerald-300 hover:text-emerald-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {wsMode === 'local' ? (
              <input
                autoFocus
                disabled={operating}
                className="w-full text-xs border border-zinc-300 rounded-md px-2 py-1 bg-white disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-zinc-50"
                value={wsPath}
                onChange={(e) => setWsPath(e.target.value)}
                placeholder="D:/Work/01_Projects/..."
                title="本地 git 仓库根目录"
              />
            ) : wsMode === 'init' ? (
              <div className="space-y-1.5">
                <input
                  autoFocus
                  disabled={operating}
                  className="w-full text-xs border border-zinc-300 rounded-md px-2 py-1 bg-white disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-zinc-50"
                  value={wsInitDir}
                  onChange={(e) => setWsInitDir(e.target.value)}
                  placeholder="D:/Work/04_Temp/新仓库目录"
                  title="新建仓库目录（git init；目录不存在会自动创建）"
                />
                <div className="text-[11px] text-zinc-400">
                  在目标目录执行 git init 创建新仓库，创建后自动登记进工作区列表（不做账号绑定/远端推拉）
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <input
                  autoFocus
                  disabled={operating}
                  className="w-full text-xs border border-zinc-300 rounded-md px-2 py-1 bg-white disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-zinc-50"
                  value={wsUrl}
                  onChange={(e) => setWsUrl(e.target.value)}
                  placeholder="https://github.com/..."
                  title="远程仓库地址（https 或 git@）"
                />
                <input
                  disabled={operating}
                  className="w-full text-xs border border-zinc-300 rounded-md px-2 py-1 bg-white disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-zinc-50"
                  value={wsDir}
                  onChange={(e) => setWsDir(e.target.value)}
                  placeholder="D:/Work/04_Temp/新仓库名"
                  title="克隆目标目录（必填）：仓库将创建在该目录下，如 D:/Work/04_Temp/my-repo"
                />
                {/* 克隆进度条：operating 且目标目录已填时渲染（不打断输入；无进度数据静默降级） */}
                {operating && wsDir.trim() && (
                  <CloneProgressBar dir={wsDir.trim().replace(/\\/g, '/').replace(/[\\/]+$/, '')} />
                )}
              </div>
            )}

            {wsFormError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{wsFormError}</div>}

            <div className="flex gap-1.5">
              <button
                type="submit"
                disabled={operating}
                className="px-2.5 py-1 rounded text-xs bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {operating ? `执行中…${opSuffix}` : wsMode === 'local' ? '添加' : wsMode === 'init' ? '创建' : '克隆'}
              </button>
              <button
                type="button"
                onClick={() => {
                  // 取消 = 丢弃本次表单草稿：清空各模式输入 + 回到默认「本地路径」tab。
                  // 与成功路径（doAddLocal/doCloneRemote/doInitLocal 提交后清空对应输入）对齐——
                  // 否则「输入到一半点取消再打开」会带回上次残留的 URL/路径，既有误提交风险
                  // （陈旧的远程地址被再次克隆/登记），表单状态也与成功提交不一致。
                  setWsFormOpen(false);
                  setWsFormError(null);
                  setWsPath('');
                  setWsUrl('');
                  setWsDir('');
                  setWsInitDir('');
                  setWsMode('local');
                }}
                disabled={operating}
                className="px-2.5 py-1 rounded text-xs bg-white border border-zinc-300 text-zinc-600 hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
            </div>
          </form>
        )}
      </div>

      {/* 区块 C 及以下状态展示区：status 未就绪（加载中/失败）时给专属骨架/错误态，
          不再整体替换卡片——工作区管理（区块 A）不依赖 status，登记/切换/添加保持可用，
          错误态里的「点右上角 + 添加」引导与上方真实按钮对得上。 */}
      {!status ? (
        loadError ? (
          <div className="space-y-2">
            <div className="border border-zinc-200 rounded-lg bg-white">
              <EmptyState
                icon={I.branch}
                title="Git 工作区状态不可用"
                hint="网关未响应或未启动（/api/git/status 拿不到状态）。确认 server.mjs 运行中，再点下方重试。工作区登记/添加不受影响。"
              />
            </div>
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => refreshStatus().catch(() => {})}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98]"
              >
                <Icon name={I.refresh} size={11} />
                重试
              </button>
            </div>
          </div>
        ) : (
          <div
            className="border border-zinc-200 rounded-lg bg-white p-3 space-y-2"
            role="status"
            aria-busy="true"
            aria-label="正在加载 Git 工作区状态"
          >
            <div className="h-4 bg-zinc-200 rounded animate-pulse w-1/3" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 bg-zinc-100 rounded animate-pulse" />
            ))}
          </div>
        )
      ) : (
        <>
          {/* 区块 C：当前工作区操作按钮行（git 可用且有活动工作区才显示） */}
          {gitOk && activeWorkspace && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-emerald-50 text-emerald-700 font-mono border border-emerald-200/70 truncate max-w-56" title={activeWorkspace.root}>
              {gitWorkspaceName(activeWorkspace.root, workspaces)}
            </span>
            <span className="text-[10px] text-zinc-400 truncate max-w-48" title={activeWorkspace.root}>
              {activeWorkspace.root}
            </span>
            <div className="ml-auto flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => doGitOperate('fetch')}
                disabled={operating}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                title="从远端拉取更新（不合并）"
              >
                <Icon name={I.download} size={11} className={busyAction === 'fetch' ? 'animate-spin' : undefined} />
                {busyAction === 'fetch' ? `拉取中…${opSuffix}` : 'fetch'}
              </button>
              <button
                type="button"
                onClick={() => doGitOperate('pull')}
                disabled={operating}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                title="拉取并合并远端更新"
              >
                <Icon name={busyAction === 'pull' ? I.clock : I.swap} size={11} />
                {busyAction === 'pull' ? `同步中…${opSuffix}` : 'pull'}
              </button>
              <button
                type="button"
                onClick={() => setPushConfirmOpen((v) => !v)}
                disabled={operating}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                title="推送本地提交到远端"
              >
                <Icon name={I.upload} size={11} />
                {busyAction === 'push' ? `推送中…${opSuffix}` : 'push'}
              </button>
              <div className="relative inline-flex items-center">
                <Icon name={I.branch} size={11} className="text-zinc-400 absolute left-1.5 pointer-events-none" />
                <select
                  className="text-xs border border-zinc-300 rounded-md pl-6 pr-1.5 py-0.5 bg-white text-zinc-600"
                  value={branchValue}
                  onChange={async (e) => {
                    // 打开分支面板：状态切到已展开、异步拉分支；value 保持空——
                    // `__open__` 不是真实分支，不能写进 branchValue（否则 select 的
                    // value 指向这把死值：分支加载后无匹配 option → 下拉框空白、
                    // 0 分支时停在「重新打开」上，都回不到「选择分支…」占位）。
                    if (e.target.value === '__open__') {
                      setBranchPanelOpen(true);
                      await loadBranches().catch(() => {});
                      return;
                    }
                    // 收起分支列表：纯折叠面板，不触发 checkout（只看不切时的退出路径）
                    if (e.target.value === '__close__') {
                      setBranchPanelOpen(false);
                      return;
                    }
                    setBranchValue(e.target.value);
                    if (e.target.value) await doCheckout(e.target.value);
                  }}
                  disabled={operating || branchLoading}
                  title="切换分支（选择后执行 checkout）"
                >
                  {branchLoading ? (
                    <option value="" disabled>
                      加载分支中…
                    </option>
                  ) : branchPanelOpen ? (
                    <>
                      <option value="" disabled>
                        选择分支…（{branchTotal}）
                      </option>
                      {/* 收起分支列表：纯折叠面板、不触发 checkout —— 面板一旦展开
                          只能靠 checkout 或切工作区退出，「只看不切」的用户会被困在
                          展开列表里；给一条明确的退出路径。 */}
                      <option value="__close__">收起分支列表</option>
                      {/* 分组下拉：本地分支在前，远端按 remote 分组（多远端一眼可分）。
                          当前分支标 ●（仅本地）；checkout 的 value 恒为原始分支名，语义不变。 */}
                      {branchGroups.map((g) => (
                        <optgroup key={g.label} label={`${g.label}（${g.branches.length}）`}>
                          {g.branches.map((b) => (
                            <option key={b.value} value={b.value}>
                              {b.current ? `● ${b.label}` : b.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                      {/* 面板打开但列表为空（0 分支 / 加载失败 / 重载被置空）→
                          select 里只有 value="" 的占位项，永远选不中、也没有任何
                          option 能把它拉回「__open__」：卡死成一把空下拉。
                          兜底放一个「重新打开」选项，总能把面板重新拉起来。 */}
                      {branchTotal === 0 && <option value="__open__">重新打开</option>}
                    </>
                  ) : (
                    <>
                      {/* 收起态常显当前分支：select value=branchValue 恒命中该 option 文本
                          （含 checkout 后 branchValue=真实分支名、初始 '' 两态），
                          避免 value 无匹配 option 时下拉显示空白；点「切换分支」打开面板。
                          游离 HEAD：status.branch 为 null → 占位文案给「游离 HEAD」（不再是裸
                          「—」），配合分支区块警示徽标一眼认出游离态；下拉仍可打开选分支脱离。 */}
                      <option value={branchValue} disabled hidden>
                        {status.branch || (detached ? '游离 HEAD' : '切换分支')}
                      </option>
                      <option value="__open__">切换分支</option>
                    </>
                  )}
                </select>
              </div>
            </div>
          </div>

          {/* push 二次确认：点 push 展开（红边 form，回车即可确认） */}
          {pushConfirmOpen && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (operating) return;
                void doGitOperate('push');
              }}
              className="rounded-lg border border-red-200 bg-red-50/40 p-2.5 space-y-2 animate-fade-in-up"
            >
              <div className="text-xs text-zinc-700">
                确认 push 到远端？此操作将发布本地提交。
                <span className="block text-[11px] text-zinc-400 mt-1">仓库：{activeWorkspace.root}</span>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="submit"
                  disabled={operating}
                  className="px-2.5 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busyAction === 'push' ? '推送中…' : '确认 push'}
                </button>
                <button
                  type="button"
                  onClick={() => setPushConfirmOpen(false)}
                  disabled={operating}
                  className="px-2.5 py-1 rounded text-xs bg-white border border-zinc-300 text-zinc-600 hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  取消
                </button>
              </div>
            </form>
          )}

          {branchError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{branchError}</div>}
        </div>
      )}

      {/* 顶部：分支 + HEAD + 连接状态徽标 */}
      <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Icon name={I.branch} size={13} />
            分支
          </div>
          <div className="flex items-center gap-1.5">
            {/* 游离 HEAD 警示徽标：git checkout <commit>/<tag> 后 detached（status.branch=null）。
                amber 强调 + tooltip 解释 —— 游离态提交会「悬空」（不被任何分支引用），
                下一步建议从分支下拉选择目标分支 checkout 脱离游离态。 */}
            {detached && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800 border border-amber-300"
                title="HEAD 处于游离（detached）状态：当前检出的 commit/tag 不属于任何分支，新提交会悬空（不被分支引用）。请从分支下拉选择目标分支 checkout 以回到分支上。"
              >
                <Icon name={I.warn} size={11} weight="fill" />
                游离 HEAD
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
                gitOk ? 'bg-sage-100 text-sage-700' : 'bg-amber-100 text-amber-800'
              }`}
              title={gitOk ? 'git 可用（网关已连）' : '网关在线但 git 不可用：工作区非 git 仓库或未安装 git（详见下方错误条）'}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${gitOk ? 'bg-sage-500' : 'bg-amber-500'}`} aria-hidden />
              {gitOk ? '已连接' : 'git 不可用'}
            </span>
          </div>
        </div>
        {/* 分支名：游离 HEAD 时 status.branch=null → 显示「游离 HEAD」（mono 琥珀），
            而非误导性的裸「—」（裸「—」会被误读成无分支/未知，游离态是明确已知的状态）。 */}
        <div className={`font-mono text-sm truncate ${detached ? 'text-amber-700' : 'text-zinc-800'}`} title={detached ? 'HEAD 游离（detached）：不在任何分支上' : (status.branch ?? '')}>
          {detached ? '游离 HEAD' : (status.branch || '—')}
        </div>
        {/* 上游跟踪分支：porcelain 首行 `## main...origin/main` 的 `origin/main`
            （网关 getStatus.upstream 已解析；无上游/游离/老网关 → null，不渲染）。
            与「领先 N · 落后 M」配套——一眼看出领先/落后相对哪个远端分支，不用猜。 */}
        {status.upstream && !detached && (
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <span className="text-zinc-400 shrink-0">跟踪</span>
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sage-50 text-sage-700 font-mono border border-sage-200/70"
              title={`当前分支跟踪远端分支 ${status.upstream}（领先/落后统计相对它计算）`}
            >
              <Icon name={I.branch} size={10} />
              {status.upstream}
            </span>
          </div>
        )}
        {status.error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
            {status.error}
          </div>
        )}
        {status.head && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-400 shrink-0">HEAD</span>
            <span className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-mono" title={status.head}>
              {shortHash(status.head)}
            </span>
            {(status.ahead > 0 || status.behind > 0) && (
              <span className="text-zinc-400 tabular-nums shrink-0">
                领先 {status.ahead} · 落后 {status.behind}
              </span>
            )}
          </div>
        )}
        {/* tag 清单：普通/注解/远端 tag 徽标流（git for-each-ref refs/tags，最多 20 个）。
            指向当前 HEAD 的 tag（headTags）实心 emerald + 「HEAD」角标 —— git 语义上
            tag 指向 HEAD = 当前检查点，一眼区分「历史里程碑」与「当前节点」。 */}
        {tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400 shrink-0">
              <Icon name={I.tag} size={11} />
              {tags.length} 个 tag
            </span>
            {tags.map((t) => {
              // 兼容归一：旧网关 tags 是字符串名，富格式网关是对象（含指向 commit）——
              // 统一按 name 参与 HEAD 判定，tooltip 走 gitTagTitle（无 commit 信息 → 中性降级）。
              const tagInfo = toGitTagInfo(t);
              if (!tagInfo) return null;
              const isHead = headTags.includes(tagInfo.name);
              const tagTitle = isHead
                ? '指向当前 HEAD（当前检查点）'
                : (gitTagTitle(tagInfo) ?? tagInfo.name);
              return (
                <span
                  key={tagInfo.name}
                  className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] border ${
                    isHead
                      ? 'bg-emerald-600 text-white border-emerald-700'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200/70'
                  }`}
                  title={tagTitle}
                >
                  {isHead && (
                    <span className="text-[9px] font-bold uppercase tracking-wide opacity-90">HEAD</span>
                  )}
                  {tagInfo.name}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* 脏文件列表 */}
      <div className="space-y-1.5">
        <SectionLabel>
          <span className="inline-flex items-center gap-1.5">
            工作区状态
            {/* 脏文件改动汇总：git diff HEAD --numstat 聚合（+N/-M 行数 + 文件数）。
                与头部「N 处改动」同源、一眼看出「改了多少」——不逐个 hover 就知道工作区
                改动量级；无 HEAD（首次提交前）/无净改动/老网关无此字段 → 不渲染。
                样式与操作留痕 pull 统计 chip 同口径（+emerald / -red / zinc 文件数）。 */}
            {dirtyStats && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-zinc-200 text-[10px] font-mono tabular-nums"
                title={`${dirtyStats.files} 个文件改动：+${dirtyStats.added} / -${dirtyStats.removed}（git diff HEAD --numstat 聚合）`}
              >
                <span className="text-zinc-400">{dirtyStats.files} 文件</span>
                <span className="text-emerald-700">+{dirtyStats.added}</span>
                <span className="text-red-600">-{dirtyStats.removed}</span>
              </span>
            )}
          </span>
        </SectionLabel>
        {dirtyCount === 0 ? (
          gitOk ? (
            <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-zinc-200 rounded-lg">
              工作区干净，没有未提交的改动
            </div>
          ) : (
            <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-amber-200 rounded-lg">
              git 不可用，无法读取工作区状态（非 git 仓库或未安装 git）
            </div>
          )
        ) : (
          <div className="space-y-1">
            {status.dirtyFiles.map((f: GitDirtyFile) => {
              const st = dirtyStyle(f.status);
              return (
                <div
                  key={f.path}
                  className="relative"
                  onMouseEnter={() => setHoverFile(f.path)}
                  onMouseLeave={() => setHoverFile((cur) => (cur === f.path ? null : cur))}
                >
                  <div
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs hover:border-emerald-300 transition-all group"
                    title="点击 diff 按钮或悬停查看改动"
                  >
                    <span className={`shrink-0 w-1 self-stretch rounded-full ${st.dot}`} aria-hidden />
                    <span className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${st.cls}`}>{st.label}</span>
                    {f.staged && (
                      <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-zinc-100 text-zinc-500">已暂存</span>
                    )}
                    <span className="min-w-0 truncate text-zinc-600 font-mono" title={f.path}>
                      {f.path}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        // 点击固定/收起：hover 预览随点击收起（避免两种浮层叠出），再次点击关闭
                        setHoverFile(null);
                        setOpenFile((cur) => (cur === f.path ? null : f.path));
                      }}
                      aria-expanded={openFile === f.path}
                      aria-label={`${openFile === f.path ? '收起' : '查看'} ${f.path} 的改动 diff`}
                      className="ml-auto shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-200 bg-white text-[11px] text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98]"
                      title="查看改动 diff"
                    >
                      <Icon name={I.fileCode} size={11} />
                      {openFile === f.path ? '收起' : 'diff'}
                    </button>
                  </div>
                  <DirtyDiffPreview
                    file={f}
                    open={openFile === f.path || (openFile === null && hoverFile === f.path)}
                    root={activeRoot}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* commit 历史：最近 5 条 */}
      <div className="space-y-1.5">
        <SectionLabel>最近提交</SectionLabel>
        {recent.length === 0 ? (
          gitOk ? (
            <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-zinc-200 rounded-lg">
              暂无 commit 记录
            </div>
          ) : (
            <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-amber-200 rounded-lg">
              git 不可用，无法读取最近提交
            </div>
          )
        ) : (
          <div className="space-y-1">
            {recent.map((c) => (
              <CommitRow
                key={c.hash}
                hash={c.hash}
                message={c.message}
                at={c.at}
                base={commitBaseByHash.get(c.hash) ?? null}
                root={activeRoot}
              />
            ))}
          </div>
        )}
      </div>
        </>
      )}

      {/* git 写操作留痕：clone/fetch/pull/push/checkout/init 的审计列表（时间倒序）。
          数据源 = 网关 git-workspace-audit.jsonl（写操作自动追加，append-only）。
          目的：写操作不再只有瞬时 toast —— 谁在哪个仓库、哪一刻做了什么 git 操作、
          成败如何，都可在卡片里回看（失败操作尤其要能查）。
          「仅失败」过滤：成功操作常把失败淹没，勾选后只聚焦失败（排障入口）。
          「重试」按钮：失败行按原 root 原地重跑（fetch/pull/push/checkout/init），
          重试目标 = 该条留痕记录的仓库（多仓库下不依赖活动工作区）。 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <SectionLabel>操作留痕</SectionLabel>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOnlyAuditFailed((v) => !v)}
              aria-pressed={onlyAuditFailed}
              disabled={!audit || audit.length === 0}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${
                onlyAuditFailed
                  ? 'bg-red-50 border-red-300 text-red-700'
                  : 'bg-white border-zinc-200 text-zinc-500 hover:border-red-300 hover:text-red-600'
              }`}
              title={
                !audit || audit.length === 0
                  ? '暂无操作留痕'
                  : auditFailTotal === 0
                    ? '当前没有失败操作可聚焦'
                    : onlyAuditFailed
                      ? '当前只显示失败的写操作（点击恢复全部）'
                      : '只看失败的 git 写操作（fetch/pull/push/checkout/clone/init 中 ok=false 的条目）'
              }
            >
              <Icon name={I.warn} size={10} weight={onlyAuditFailed ? 'fill' : undefined} />
              仅失败
              <span className={`tabular-nums ${onlyAuditFailed ? 'text-red-600' : 'text-zinc-400'}`}>
                {onlyAuditFailed ? visibleAudit.length : auditFailTotal}
                {onlyAuditFailed ? `/${auditFailTotal}` : ''}
              </span>
            </button>
            <button
              type="button"
              onClick={() => loadAudit().catch(() => {})}
              disabled={auditLoading}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              title="刷新写操作审计留痕"
            >
              <Icon name={I.refresh} size={10} />
              {auditLoading ? '刷新中…' : '刷新'}
            </button>
          </div>
        </div>
        {auditError && !audit ? (
          <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-red-200 rounded-lg space-y-1.5">
            <div>操作留痕加载失败（老网关无此端点，或网关未响应）</div>
            <button
              type="button"
              onClick={() => loadAudit().catch(() => {})}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98]"
            >
              <Icon name={I.refresh} size={11} />
              重试
            </button>
          </div>
        ) : audit === null ? (
          // audit 初始为 null（未加载）≠ 空数组（已确认无留痕）：与阶段留痕同口径——
          // null 归入骨架屏，避免首帧误闪「暂无 git 写操作留痕」再切到加载态。
          // 只认 null：刷新留痕（audit 已有内容 + auditLoading=true）不闪骨架，静默保持旧内容。
          <div className="space-y-1" role="status" aria-busy="true" aria-label="正在加载操作留痕">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-8 bg-zinc-100 rounded animate-pulse" />
            ))}
          </div>
        ) : audit.length === 0 ? (
          <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-zinc-200 rounded-lg">
            {auditError ? '操作留痕加载失败' : '暂无 git 写操作留痕（fetch/pull/push/checkout/clone/init 后自动记录）'}
          </div>
        ) : visibleAudit.length === 0 ? (
          // 仅失败过滤后为空 ≠ 无留痕：给专属空态（原始数据仍在，只是被当前视图滤掉了）
          <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-amber-200 rounded-lg">
            当前没有失败的写操作（切换「仅失败」查看全部 {audit.length} 条留痕）
          </div>
        ) : (
          <div className="space-y-1">
            {visibleAudit.map((e, i) => (
              <AuditRow
                key={`${e.at ?? 'na'}-${i}`}
                e={e}
                workspaces={workspaces}
                retrying={retryingRoot !== null && retryingRoot === e.root}
                onRetry={doRetryAudit}
              />
            ))}
          </div>
        )}
      </div>

      {/* 阶段留痕：stage 选择 → commit/tag 对照 + 回滚留档 */}
      <div className="space-y-1.5">
        <SectionLabel>阶段留痕</SectionLabel>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="text-xs border border-zinc-300 rounded-md px-2 py-1 font-mono bg-white text-zinc-700"
            value={traceStage}
            onChange={(e) => {
              setTraceStage(e.target.value);
              setConfirmTarget(null);
            }}
            title="选择阶段查看其 commit/tag 留痕"
          >
            {stageTokens.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-zinc-400">
            {commitsLoading || !commits
              ? '加载中…'
              : commitsError
                ? '加载失败'
                : traceTagOnly
                  ? `${commits.filter((c) => c.tag).length} / ${commits.length} 条留痕（仅 tag）`
                  : `${commits.length} 条留痕`}
          </span>
          {/* 仅 tag 检查点：只看打上 tag 的留痕（里程碑节点）。
              计数随开关实时变化；无 tag 留痕时开关灰置并给原因。 */}
          <button
            type="button"
            onClick={() => setTraceTagOnly((v) => !v)}
            disabled={commitsLoading || !commits || commitsError || (commits ?? []).every((c) => !c.tag)}
            aria-pressed={traceTagOnly}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${
              traceTagOnly
                ? 'bg-emerald-600 text-white border-emerald-700'
                : 'bg-white border-zinc-200 text-zinc-500 hover:border-emerald-300 hover:text-emerald-700'
            }`}
            title={
              !commits || commits.length === 0
                ? '该阶段暂无留痕'
                : commits.every((c) => !c.tag)
                  ? '该阶段留痕均未打 tag：过滤无结果'
                  : traceTagOnly
                    ? '当前只显示打上 tag 的留痕（点击恢复全部）'
                    : `只看打上 tag 的留痕（${commits.filter((c) => c.tag).length} 条）`
            }
          >
            <Icon name={I.tag} size={10} weight={traceTagOnly ? 'fill' : undefined} />
            仅 tag 检查点
          </button>
        </div>
        {/* commits 初始为 null（未加载）≠ 空数组（已确认无留痕）：null 归入骨架屏，
            避免首帧误闪「该阶段暂无留痕记录 + 0 条留痕」，再切到加载态。 */}
        {commitsLoading || !commits ? (
          <div className="space-y-1" role="status" aria-busy="true" aria-label="正在加载该阶段留痕">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-8 bg-zinc-100 rounded animate-pulse" />
            ))}
          </div>
        ) : commitsError ? (
          // 加载失败 ≠ 无留痕：给专属错误态 + 重试，避免把网关故障误报成「该阶段暂无留痕记录」
          <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-red-200 rounded-lg space-y-1.5">
            <div>该阶段留痕加载失败（网关未响应）</div>
            <button
              type="button"
              onClick={() => loadCommits(traceStage).catch(() => {})}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98]"
            >
              <Icon name={I.refresh} size={11} />
              重试
            </button>
          </div>
        ) : commits && commits.length > 0 ? (
          // 仅 tag 检查点：过滤后可能为空（全部无 tag 的留痕被滤掉）→ 给专属空态，
          // 不误报「该阶段暂无留痕记录」（原始数据仍在，只是被当前视图滤掉了）
          traceTagOnly && !commits.some((c) => c.tag) ? (
            <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-amber-200 rounded-lg">
              该阶段留痕均未打 tag，无检查点可显示（切换「仅 tag 检查点」查看全部）
            </div>
          ) : (
            <div className="space-y-1">
              {commits
                .filter((rec) => !traceTagOnly || rec.tag)
                .map((rec) => (
                  <TraceRow
                    key={`${rec.seq}-${rec.commit}`}
                    rec={rec}
                    stage={traceStage}
                    confirming={confirmTarget?.seq === rec.seq && confirmTarget?.commit === rec.commit}
                    onRollback={() => {
                      setConfirmTarget(rec);
                      setRollbackReason('');
                    }}
                    prevCommit={gitTraceBase(commits, rec.seq)}
                    gitOk={gitOk}
                    root={activeRoot}
                  />
                ))}
            </div>
          )
        ) : (
          <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-zinc-200 rounded-lg">
            {traceStage ? `该阶段暂无留痕记录（${traceStage}）` : '未选择阶段'}
          </div>
        )}
      </div>

      {/* 回滚确认态：原因输入 + 说明（常驻挂载；切目标时滚动进视区）。
          包在 <form> 里让回车即可提交（防误触发：仅 Enter 无默认副作用，
          不拦截 Tab/方向键等其余键），取消按钮 type="button" 避开隐式提交。 */}
      {confirmTarget && (
        <form
          ref={confirmRef}
          onSubmit={handleRollbackSubmit}
          className="rounded-lg border border-red-200 bg-red-50/40 p-2.5 space-y-2 animate-fade-in-up"
        >
          <div className="text-xs text-zinc-700">
            记录回滚：阶段 <span className="font-mono">{traceStage}</span> · 留痕{' '}
            <span className="font-mono">#{confirmTarget.seq}</span> · commit{' '}
            <span className="font-mono">{shortHash(confirmTarget.commit)}</span>
          </div>
          {/* autoFocus：确认面板在卡片底部，滚动区折叠之外时自动滚入视区并直接可输入，
              避免用户点「回滚」后找不到确认入口（面板挂载即聚焦，已可见时不跳转）。 */}
          <input
            autoFocus
            className="w-full text-xs border border-zinc-300 rounded-md px-2 py-1 bg-white"
            value={rollbackReason}
            onChange={(e) => setRollbackReason(e.target.value)}
            placeholder="回滚原因（留档必填）"
          />
          <div className="text-[11px] text-zinc-400">
            仅写入 .dsh/git-audit/ 审计留档，不执行任何 git 操作。
          </div>
          <div className="flex gap-1.5">
            <button
              type="submit"
              disabled={!rollbackReason.trim() || rolling}
              className="px-2.5 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {rolling ? '提交中…' : '确认回滚留档'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmTarget(null);
                setRollbackReason('');
              }}
              disabled={rolling}
              className="px-2.5 py-1 rounded text-xs bg-white border border-zinc-300 text-zinc-600 hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              取消
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
