// =============================================================================
// GitWorkspaceCard — 「Git 工作区管控」功能卡
// 数据源：网关 /api/git*（只读采集 + 留痕，前端不执行 git）。
// 能力：
//   · 顶部：分支 + HEAD commit（mono）+ 连接状态徽标（gitAvailable 才亮）
//   · 脏文件列表：路径 + 状态色标（新增/修改/删除/未暂存），空则「工作区干净」
//   · commit 历史：最近 5 条（message + hash + 相对时间）
//   · 阶段留痕：输入/选择 stage → 列出该阶段 commit/tag 对照（复用 getGitCommits）
//   · 回滚按钮：选中一条留痕 → 底部唯一确认面板（填原因）→ recordGitRollback（只留档）→ toast 提示不自动执行
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { useGitStore } from '../../store/gitStore';
import { useToastStore } from '../../store/toastStore';
import { EmptyState, Icon, SectionLabel } from '../ui';
import { I } from '../ui/icons';
import { STAGE_TABLE } from '../../data/stage-mapping';
import type { StageToken } from '../../data/types';
import { getGitDiff, type GitDiffResult, type GitDirtyFile, type GitStageTrace } from '../../utils/ipc';

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

/** 单条 commit 行：hash（mono）+ message + 相对时间 */
const CommitRow: React.FC<{ hash: string; message: string; at: string | null }> = ({
  hash,
  message,
  at,
}) => (
  <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs hover:border-emerald-300 transition-all group">
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
  </div>
);

/** 阶段留痕行：seq + commit + tag + 状态 + 时间 + 回滚按钮 */
const TraceRow: React.FC<{
  rec: GitStageTrace;
  stage: string;
  confirming: boolean;
  onRollback: () => void;
}> = ({ rec, stage, confirming, onRollback }) => {
  const statusLabel = TRACE_STATUS_LABEL[rec.status] || rec.status || '—';
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs hover:border-emerald-300 transition-all group">
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
      <span className="shrink-0 text-zinc-400">{statusLabel}</span>
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
          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-zinc-200 text-zinc-500 hover:border-red-300 hover:text-red-600 transition-all active:scale-[0.98]"
          title="记录回滚指令（只留档，不执行 git）"
        >
          <Icon name={I.undo} size={11} />
          回滚
        </button>
      )}
    </div>
  );
};

/** 脏文件行内 diff 预览浮层（hover 时拉取 /api/git/diff 展示）。
 *  只读展示（含 +N/-M 统计）；untracked/无基线/网关不可用 → 降级提示，不阻塞行交互。 */
const DirtyDiffPreview: React.FC<{ file: GitDirtyFile; open: boolean }> = ({ file, open }) => {
  const [data, setData] = React.useState<GitDiffResult | null>(null);
  const [loading, setLoading] = React.useState(false);

  // open 变 true 才拉取（避免为每个脏文件都发请求）；同一文件重复 hover 命中缓存
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    // staged 行预览暂存区改动（--cached），其余预览工作区改动
    getGitDiff(file.path, file.staged)
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
  }, [open, file.path, file.staged]);

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

  // 阶段留痕：当前选中 stage（默认第一个有命令的阶段）+ 确认中的回滚目标
  const stageTokens = Object.keys(STAGE_TABLE) as StageToken[];
  const [traceStage, setTraceStage] = React.useState<string>(stageTokens[0] ?? '');
  const [confirmTarget, setConfirmTarget] = React.useState<GitStageTrace | null>(null);
  const [rollbackReason, setRollbackReason] = React.useState('');
  // 回滚留档提交中：禁用确认按钮 + 显示进度，防重复提交
  const [rolling, setRolling] = React.useState(false);

  // 挂载即拉一次工作区状态；初始 stage 对应轨迹也一起拉
  React.useEffect(() => {
    refreshStatus().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshStatus]);

  React.useEffect(() => {
    loadCommits(traceStage).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceStage, loadCommits]);

  const dirtyCount = status?.dirtyFiles?.length ?? 0;
  // hover 查看 diff 的脏文件路径（仅一个；移出即收起，避免多浮层重叠）
  const [hoverFile, setHoverFile] = React.useState<string | null>(null);
  // 最近 5 条 commit（取带 message 的，倒序排列）；后端字段 recentCommits，旧字段 recent 兜底
  const recent = [...(status?.recentCommits ?? status?.recent ?? [])].slice(0, 5);
  const tags = status?.tags ?? [];
  const gitOk = status?.gitAvailable === true;
  const connected = gitOk && !loadError;

  const doRollback = async () => {
    if (!confirmTarget || rolling) return;
    setRolling(true);
    try {
      await rollback({
        stage: traceStage,
        seq: confirmTarget.seq,
        commit: confirmTarget.commit,
        reason: rollbackReason.trim() || '前端工作区管控（未填原因）',
      });
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

  // ---- status 未就绪：加载骨架 / 失败 EmptyState ----
  // loading 且已有内容时不打断：刷新时保留现有数据，不闪骨架（仅 status 缺失时出骨架/错误态）。
  // 注：gitStore 出错时 status 也会被置 null，故内层只需判 loadError。
  if (!status) {
    if (loadError) {
      return (
        <div className="p-4 space-y-3">
          <div className="border border-zinc-200 rounded-lg bg-white">
            <EmptyState
              icon={I.branch}
              title="Git 工作区不可用"
              hint="网关未响应或未启动（/api/git/status 拿不到状态）。确认 server.mjs 运行中，再点下方重试。"
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
      );
    }
    return (
      <div className="border border-zinc-200 rounded-lg bg-white p-3 space-y-2" role="status" aria-busy="true" aria-label="正在加载 Git 工作区状态">
        <div className="h-4 bg-zinc-200 rounded animate-pulse w-1/3" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 bg-zinc-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* 标题行 + 刷新 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-emerald-600">
            <Icon name={I.branch} size={15} weight="fill" />
          </span>
          <span className="text-sm font-bold text-zinc-800">Git 工作区管控</span>
          <span className="text-xs text-zinc-400">（{dirtyCount} 处改动）</span>
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

      {/* 顶部：分支 + HEAD + 连接状态徽标 */}
      <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Icon name={I.branch} size={13} />
            分支
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
              connected ? 'bg-sage-100 text-sage-700' : 'bg-zinc-100 text-zinc-500'
            }`}
            title={connected ? 'git 可用（网关已连）' : 'git 不可用或网关离线'}
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-sage-500' : 'bg-zinc-400'}`} aria-hidden />
            {connected ? '已连接' : '未连接'}
          </span>
        </div>
        <div className="font-mono text-zinc-800 text-sm truncate" title={status.branch ?? ''}>
          {status.branch || '—'}
        </div>
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
        {/* tag 清单：普通/注解/远端 tag 徽标流（git for-each-ref refs/tags，最多 20 个） */}
        {tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400 shrink-0">
              <Icon name={I.tag} size={11} />
              {tags.length} 个 tag
            </span>
            {tags.map((t) => (
              <span
                key={t}
                className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono text-[10px] border border-emerald-200/70"
                title={t}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 脏文件列表 */}
      <div className="space-y-1.5">
        <SectionLabel>工作区状态</SectionLabel>
        {dirtyCount === 0 ? (
          <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-zinc-200 rounded-lg">
            工作区干净，没有未提交的改动
          </div>
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
                    title="hover 查看改动 diff"
                  >
                    <span className={`shrink-0 w-1 self-stretch rounded-full ${st.dot}`} aria-hidden />
                    <span className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${st.cls}`}>{st.label}</span>
                    {f.staged && (
                      <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-zinc-100 text-zinc-500">已暂存</span>
                    )}
                    <span className="min-w-0 truncate text-zinc-600 font-mono" title={f.path}>
                      {f.path}
                    </span>
                  </div>
                  <DirtyDiffPreview file={f} open={hoverFile === f.path} />
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
          <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-zinc-200 rounded-lg">
            暂无 commit 记录
          </div>
        ) : (
          <div className="space-y-1">
            {recent.map((c) => (
              <CommitRow key={c.hash} hash={c.hash} message={c.message} at={c.at} />
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
            {commitsLoading ? '加载中…' : commitsError ? '加载失败' : `${commits?.length ?? 0} 条留痕`}
          </span>
        </div>
        {commitsLoading ? (
          <div className="space-y-1">
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
          <div className="space-y-1">
            {commits.map((rec) => (
              <TraceRow
                key={`${rec.seq}-${rec.commit}`}
                rec={rec}
                stage={traceStage}
                confirming={confirmTarget?.seq === rec.seq && confirmTarget?.commit === rec.commit}
                onRollback={() => {
                  setConfirmTarget(rec);
                  setRollbackReason('');
                }}
              />
            ))}
          </div>
        ) : (
          <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-zinc-200 rounded-lg">
            {traceStage ? `该阶段暂无留痕记录（${traceStage}）` : '未选择阶段'}
          </div>
        )}
      </div>

      {/* 回滚确认态：原因输入 + 说明 */}
      {confirmTarget && (
        <div className="rounded-lg border border-red-200 bg-red-50/40 p-2.5 space-y-2 animate-fade-in-up">
          <div className="text-xs text-zinc-700">
            记录回滚：阶段 <span className="font-mono">{traceStage}</span> · commit{' '}
            <span className="font-mono">{shortHash(confirmTarget.commit)}</span>
          </div>
          <input
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
              type="button"
              onClick={doRollback}
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
        </div>
      )}
    </div>
  );
};
