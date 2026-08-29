// =============================================================================
// GitDiffPreview — 共享 commit 范围 diff 预览浮层（Git 工作区管控卡 + 轨迹瀑布共用）
// 数据源：网关 GET /api/git/diff 的 commit 范围模式（from...to 增量改动），只读 git diff。
// 定位：与 DirtyDiffPreview（脏文件行内预览）互补 —— 本组件只做「相邻两次执行/留痕
// 之间发生了什么」的 range diff 预览；脏文件（工作区 vs HEAD）走各自的 DirtyDiffPreview。
// 能力（与 GitWorkspaceCard.TraceDiffPreview 同款交互，抽到 ui 层复用）：
//   · open 变 true 才拉取（避免为每行都发请求），相同 base/target 命中 fetch 缓存
//   · 无 target / base===target / 无 base（首条）→ 各自降级提示，不触发请求
//   · 展示 +N/-M 统计 + 着色 diff（新增绿 / 删除红 / hunk 中性）
//   · 触发点（hover）为纯展示浮层，绝对定位在容器下方，不阻塞行内交互
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji。
// =============================================================================

import React from 'react';
import { getGitDiff, type GitDiffResult } from '../../utils/ipc';

/** 降级提示小节点（不触发 diff 请求）。 */
const GitDiffNote: React.FC<{ text: string }> = ({ text }) => (
  <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-zinc-200 bg-white shadow-lg p-2.5 animate-fade-in-up">
    <div className="text-[11px] text-zinc-400 py-1">{text}</div>
  </div>
);

/**
 * commit 范围 diff 预览浮层：hover 阶段留痕/轨迹行 → 拉取 target 相对 base 的改动。
 * base 缺省时退化为「对比上一提交」—— 轨迹行只带单 commit（该时刻最新提交），
 * 用它作为 target，以 base 为对比基线展示增量改动（无 base → 首条降级提示）。
 * 任何失败静默降级，不阻塞宿主行交互。
 */
export const GitDiffPreview: React.FC<{
  /** 对比基线 commit（无 → 降级提示；GitWorkspaceCard 传上一留痕，Trajectory 可省略） */
  base?: string | null;
  /** 目标 commit（该时刻最新提交；无 → 降级提示，不请求） */
  target?: string | null;
  /** 是否展开（由宿主 hover/点击状态控制） */
  open: boolean;
  /** 目标工作区根（多工作区下 diff 按活动 root 拉；缺省走网关默认根） */
  root?: string | null;
}> = ({ base = null, target = null, open, root = null }) => {
  const [data, setData] = React.useState<GitDiffResult | null>(null);
  const [loading, setLoading] = React.useState(false);

  // 无目标 commit 无法 diff；base===target 无增量；首条（base=null）无上一条可对比；
  // open 才拉取（避免无谓请求），相同 base/target 命中浏览器 fetch 缓存
  const usable = open && !!target && !!base && base !== target;
  React.useEffect(() => {
    if (!usable) return;
    let cancelled = false;
    setLoading(true);
    // range 模式：path 传空（网关 commit 范围模式不读路径），from/to 指定 diff 范围。
    // usable 已保证 base/target 均有值：`from...to` 三-dot 增量 diff。
    getGitDiff('', false, { from: base, to: target, root })
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
  }, [usable, base, target, root]);

  if (!open) return null;
  if (!target) {
    return <GitDiffNote text="该条执行无 commit 关联，无法预览改动" />;
  }
  if (base === target) {
    return <GitDiffNote text="该条与对比基线在同一 commit（无增量 diff）" />;
  }
  if (!base) {
    return <GitDiffNote text="首条执行无上一条 commit 可对比，无增量 diff" />;
  }
  const diff = data?.diff;
  return (
    <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-zinc-200 bg-white shadow-lg p-2.5 space-y-1.5 animate-fade-in-up">
      <div className="flex items-center gap-2 text-[11px] text-zinc-400">
        <span className="font-mono text-zinc-600 truncate min-w-0" title={`${base}...${target}`}>
          {`${base.slice(0, 7)}…${target.slice(0, 7)}`}
        </span>
        {data?.stats && (
          <span className="ml-auto shrink-0 tabular-nums">
            <span className="text-emerald-600">+{data.stats.added}</span>
            <span className="text-red-600"> -{data.stats.removed}</span>
          </span>
        )}
      </div>
      {loading ? (
        <div className="text-[11px] text-zinc-400 py-1">正在加载 commit diff…</div>
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
        <div className="text-[11px] text-zinc-400 py-1">{data.note || '该 commit 相对对比基线无可见改动'}</div>
      ) : data ? (
        <div className="text-[11px] text-zinc-400 py-1">该 commit 相对对比基线无可见改动</div>
      ) : (
        <div className="text-[11px] text-zinc-400 py-1">commit diff 不可用（网关未响应或 commit 不在当前仓库）</div>
      )}
    </div>
  );
};
