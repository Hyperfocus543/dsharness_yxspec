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
import { getGitDiff, type GitDiffResult, type GitDirtyFile, type GitStageTrace, type GitWorkspace } from '../../utils/ipc';
import { gitTraceBase, recentCommitDiffs } from '../../utils/gitTrace';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshWorkspaces, refreshStatus]);

  React.useEffect(() => {
    loadCommits(traceStage).catch(() => {});
    // 活动工作区切换 → 按新 root 重拉留痕（阶段↔commit/tag 是 per-root 的）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceStage, loadCommits, activeRoot]);

  const dirtyCount = status?.dirtyFiles?.length ?? 0;
  // hover 查看 diff 的脏文件路径（仅一个；移出即收起，避免多浮层重叠）。
  // 放 ref 而非 state：hover 只是"临时预览"（映射成 open 的中间层），
  // 不参与渲染；点按/键盘的"固定 diff"（open）才是受控源。
  // 固定 diff 展开时抑制全部 hover 预览（openFile !== null 即禁），
  // 保证任意时刻至多一个浮层——否则钉住 A 再悬停 B 会叠出第二块 diff。
  const hoverFileRef = React.useRef<string | null>(null);
  // 固定展开 diff 的文件路径（点击 diff 按钮或空格/回车切换；最多一个浮层）
  const [openFile, setOpenFile] = React.useState<string | null>(null);
  // 鼠标悬停是否仍生效（触屏/纯键盘场景自动关闭 hover 预览，避免无法移出的固定浮层）
  const [hoverEnabled, setHoverEnabled] = React.useState(true);
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

  // ---- 工作区管理 UI 状态 ----
  // 添加表单（区块 B）：默认收起，点「+ 添加」展开；form 内 tab 决定本地/远程
  const [wsFormOpen, setWsFormOpen] = React.useState(false);
  const [wsMode, setWsMode] = React.useState<'local' | 'remote' | 'init'>('local');
  const [wsPath, setWsPath] = React.useState('');
  const [wsUrl, setWsUrl] = React.useState('');
  const [wsDir, setWsDir] = React.useState('');
  const [wsInitDir, setWsInitDir] = React.useState('');
  const [wsFormError, setWsFormError] = React.useState<string | null>(null);
  // 分支切换（区块 C）：首次展开时拉 branches，选中后 checkout
  const [branchPanelOpen, setBranchPanelOpen] = React.useState(false);
  const [branches, setBranches] = React.useState<string[]>([]);
  const [branchLoading, setBranchLoading] = React.useState(false);
  const [branchValue, setBranchValue] = React.useState('');
  const [branchError, setBranchError] = React.useState<string | null>(null);
  // push 二次确认（区块 C）：点 push 展开红边确认框
  const [pushConfirmOpen, setPushConfirmOpen] = React.useState(false);
  // 正在执行的 git 操作（fetch/pull/push）：operating 是全局互斥锁，
  // 单靠它区分不了三个按钮哪个在跑；busyAction 记下本次动作，
  // 只有它自己显示「执行中…」，其余按钮保持原 label 但同样禁用。
  const [busyAction, setBusyAction] = React.useState<'fetch' | 'pull' | 'push' | null>(null);

  // 活动工作区切换 → 分支缓存属于旧 root：清空并收起分支面板，
  // 否则在 A 展开过的分支列表会在切到 B 后原样展示，选中 checkout 会串根执行到 B。
  React.useEffect(() => {
    setBranches([]);
    setBranchPanelOpen(false);
    setBranchValue('');
    setBranchError(null);
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

  // 克隆远程仓库：gitOperate clone → 网关自动登记 → 成功后刷新注册表 + 状态
  const doCloneRemote = async () => {
    const err = !wsUrl || !wsUrl.trim() ? '请输入远程仓库地址' : null;
    if (err) {
      setWsFormError(err);
      return;
    }
    setWsFormError(null);
    try {
      await useGitStore.getState().gitOperate({
        root: wsDir.trim() || activeWorkspace?.root || '',
        action: 'clone',
        args: { url: wsUrl.trim(), dir: wsDir.trim() || activeWorkspace?.root || '' },
      });
      pushToast('success', '克隆完成，已登记工作区');
      setWsUrl('');
      setWsDir('');
      setWsFormOpen(false);
      await refreshWorkspaces().catch(() => {});
      await refreshStatus().catch(() => {});
    } catch (e: any) {
      setWsFormError(e?.message || '克隆失败');
      pushToast('error', `克隆失败：${e?.message || e}`);
    }
  };

  // 新建本地仓库：gitOperate init → 网关 mkdir + git init + 自动登记 → 成功后刷新注册表 + 状态
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
      await useGitStore.getState().gitOperate({
        // root 语义同 clone：只是「目标父目录」锚点（网关 init 只取 args.dir，不要求已登记）
        root: activeWorkspace?.root || '',
        action: 'init',
        args: { dir: target },
      });
      pushToast('success', '已创建并登记新仓库');
      setWsInitDir('');
      setWsFormOpen(false);
      await refreshWorkspaces().catch(() => {});
      await refreshStatus().catch(() => {});
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
    } catch (e: any) {
      pushToast('error', `移除工作区失败：${e?.message || e}`);
    }
  };

  // 分支列表：首次打开面板才拉（gitOperate branch 只读列分支，不做切换）
  const loadBranches = async () => {
    if (branches.length > 0 || !activeWorkspace) return;
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
    } catch (e: any) {
      setBranchError(e?.message || `切换分支失败：${branch}`);
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
    } catch (e: any) {
      pushToast('error', `${label}失败：${e?.message || e}`);
    } finally {
      setBusyAction(null);
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
          {/* git 不可用且未登记任何工作区 → 引导添加本地/远程仓库（指向区块 A 的「添加」按钮） */}
          {!workspaceLoading && !workspaceError && workspaces.length === 0 && (
            <div className="text-xs text-zinc-400 text-center border border-dashed border-amber-200 rounded-lg px-3 py-2.5">
              可点击右上角「+ 添加」，添加本地 git 仓库路径、粘贴远程仓库地址克隆，或新建本地仓库（git init）
            </div>
          )}
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
          <span className="text-xs text-zinc-400">
            {gitOk ? `（${dirtyCount} 处改动）` : '（git 不可用，状态未知）'}
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

        {workspaceLoading ? (
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
          <div className="text-xs text-zinc-400 py-3 text-center border border-dashed border-zinc-200 rounded-lg">
            暂无工作区，点右上角「+ 添加」登记本地仓库、克隆远程仓库，或新建本地仓库（git init）
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
                      className="hidden sm:inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-200 bg-white text-[11px] text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed group-hover:inline-flex"
                      title="切换为当前工作区"
                    >
                      设为当前
                    </button>
                  )}
                  {!isAuto && (
                    <button
                      type="button"
                      onClick={() => doRemove(w.id)}
                      disabled={operating}
                      className="hidden sm:inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-200 bg-white text-[11px] text-zinc-500 hover:border-red-300 hover:text-red-600 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed group-hover:inline-flex"
                      title="移除该工作区（不做删除，仅取消登记）"
                    >
                      <Icon name={I.trash} size={11} />
                      移除
                    </button>
                  )}
                  {isActive && isAuto && (
                    <span
                      className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[11px] font-mono border border-emerald-200/70"
                      title="当前工作区（自动透传默认根，不可移除）"
                    >
                      当前 · 默认
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
                  className={`px-2 py-0.5 rounded text-xs border transition-all active:scale-[0.98] ${
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
                className="w-full text-xs border border-zinc-300 rounded-md px-2 py-1 bg-white"
                value={wsPath}
                onChange={(e) => setWsPath(e.target.value)}
                placeholder="D:/Work/01_Projects/..."
                title="本地 git 仓库根目录"
              />
            ) : wsMode === 'init' ? (
              <div className="space-y-1.5">
                <input
                  autoFocus
                  className="w-full text-xs border border-zinc-300 rounded-md px-2 py-1 bg-white"
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
                  className="w-full text-xs border border-zinc-300 rounded-md px-2 py-1 bg-white"
                  value={wsUrl}
                  onChange={(e) => setWsUrl(e.target.value)}
                  placeholder="https://github.com/..."
                  title="远程仓库地址（https 或 git@）"
                />
                <input
                  className="w-full text-xs border border-zinc-300 rounded-md px-2 py-1 bg-white"
                  value={wsDir}
                  onChange={(e) => setWsDir(e.target.value)}
                  placeholder="D:/Work/04_Temp/"
                  title="克隆目标目录（默认当前活动工作区根目录）"
                />
              </div>
            )}

            {wsFormError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{wsFormError}</div>}

            <div className="flex gap-1.5">
              <button
                type="submit"
                disabled={operating}
                className="px-2.5 py-1 rounded text-xs bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {operating ? '执行中…' : wsMode === 'local' ? '添加' : wsMode === 'init' ? '创建' : '克隆'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setWsFormOpen(false);
                  setWsFormError(null);
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

      {/* 区块 C：当前工作区操作按钮行（git 可用且有活动工作区才显示） */}
      {gitOk && activeWorkspace && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-emerald-50 text-emerald-700 font-mono border border-emerald-200/70 truncate max-w-56" title={activeWorkspace.root}>
              {activeWorkspace.name}
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
                {busyAction === 'fetch' ? '拉取中…' : 'fetch'}
              </button>
              <button
                type="button"
                onClick={() => doGitOperate('pull')}
                disabled={operating}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                title="拉取并合并远端更新"
              >
                <Icon name={busyAction === 'pull' ? I.clock : I.swap} size={11} />
                {busyAction === 'pull' ? '同步中…' : 'pull'}
              </button>
              <button
                type="button"
                onClick={() => setPushConfirmOpen((v) => !v)}
                disabled={operating}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:text-emerald-700 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                title="推送本地提交到远端"
              >
                <Icon name={I.upload} size={11} />
                {busyAction === 'push' ? '推送中…' : 'push'}
              </button>
              <div className="relative inline-flex items-center">
                <Icon name={I.branch} size={11} className="text-zinc-400 absolute left-1.5 pointer-events-none" />
                <select
                  className="text-xs border border-zinc-300 rounded-md pl-6 pr-1.5 py-0.5 bg-white text-zinc-600"
                  value={branchValue}
                  onChange={async (e) => {
                    setBranchValue(e.target.value);
                    if (e.target.value === '__open__') {
                      setBranchPanelOpen(true);
                      await loadBranches().catch(() => {});
                      return;
                    }
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
                        选择分支…
                      </option>
                      {branches.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </>
                  ) : (
                    <option value="__open__">切换分支</option>
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
              const isHead = headTags.includes(t);
              return (
                <span
                  key={t}
                  className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] border ${
                    isHead
                      ? 'bg-emerald-600 text-white border-emerald-700'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200/70'
                  }`}
                  title={isHead ? `指向当前 HEAD（当前检查点）` : t}
                >
                  {isHead && (
                    <span className="text-[9px] font-bold uppercase tracking-wide opacity-90">HEAD</span>
                  )}
                  {t}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* 脏文件列表 */}
      <div className="space-y-1.5">
        <SectionLabel>工作区状态</SectionLabel>
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
                  onMouseEnter={() => {
                    hoverFileRef.current = f.path;
                    setHoverEnabled(true);
                  }}
                  onMouseLeave={() => {
                    if (hoverFileRef.current === f.path) hoverFileRef.current = null;
                  }}
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
                        hoverFileRef.current = null;
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
                    open={openFile === f.path || (hoverEnabled && openFile === null && hoverFileRef.current === f.path)}
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
