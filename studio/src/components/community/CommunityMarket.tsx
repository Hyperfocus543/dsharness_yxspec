// =============================================================================
// CommunityMarket — 社区插件市场面板（高密度版）
// 浏览/筛选 GitHub topic:dsh-plugin 的社区插件（数据源经网关缓存 6h）。
//
// 关键设计：
//   · headless 兼容标记：我们跑的是 headless JSON-RPC runtime（cordis.yml），
//     不是 DSH CLI/web profile。「界面与体验 / 会话 UI / 娱乐」类插件不可用。
//     description 含 sidebar/theme/web/console/ui/dashboard/widget 等词 →
//     标「界面类」灰置；其余标「可验证」。
//   · 分类为 description 关键词启发式，界面标注「启发式」。
//   · 静态源（source=static）时提示「GitHub 暂不可达，显示内置精选」。
//   · 高密度：紧凑行卡 + 两列网格，一行内并列名称/星标/日期/分类，描述单行截断。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { useCommunityStore } from '../../store/communityStore';
import { EmptyState, Icon, Skeleton } from '../ui';
import { I } from '../ui/icons';
import type { CommunityPlugin } from '../../utils/ipc';

// ---------- 分类（启发式，基于仓库 description 关键词） ----------
export type CommunityCategory =
  | '工具与能力'
  | '集成与连接'
  | '模型与推理'
  | '记忆与上下文'
  | '技能与智能体'
  | '其他';

const CATEGORIES: CommunityCategory[] = [
  '工具与能力',
  '集成与连接',
  '模型与推理',
  '记忆与上下文',
  '技能与智能体',
  '其他',
];

/** 关键词 → 分类（顺序即优先级；命中即归入）。
 *  集成与连接(MCP) 放最前：MCP/代理/通道类插件常同时含 tool/file 等词，须优先归入。 */
const CATEGORY_RULES: { cat: CommunityCategory; kws: string[] }[] = [
  { cat: '集成与连接', kws: ['mcp', 'integration', '集成', 'channel', '通道', 'bot', ' im ', 'relay', '中转', 'proxy', '代理', 'connector', '连接', 'connect'] },
  { cat: '工具与能力', kws: ['tool', '工具', 'file', '文件', 'shell', 'exec', 'api', '搜索', 'search', 'fetch', 'http', '终端', 'terminal', 'sandbox', '沙箱'] },
  { cat: '模型与推理', kws: ['model', '模型', 'vision', '视觉', 'ocr', 'image', '图像', 'reason', '推理', 'inference', 'prompt', '提示词'] },
  { cat: '记忆与上下文', kws: ['memory', '记忆', 'context', '上下文', 'graph', '图谱', 'recall', '召回', 'compress', '压缩', 'persist', '持久'] },
  { cat: '技能与智能体', kws: ['agent', '智能体', 'team', '团队', 'skill', '技能', 'orchestrat', '编排', 'sub-agent', '子智能体', 'workflow', '流水线'] },
];

/** 基于 description 启发式分类（无法命中 → 其他）。 */
export function classifyPlugin(p: CommunityPlugin): CommunityCategory {
  const text = `${p.description ?? ''} ${p.name} ${p.fullName}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.kws.some((k) => text.includes(k))) return rule.cat;
  }
  return '其他';
}

// ---------- headless 兼容标记 ----------
/** 明显依赖 Web UI 的插件关键词（sidebar/theme/web/console/ui/dashboard/widget 等）。 */
const UI_HINT_KWS = ['sidebar', 'theme', 'web ui', 'console', 'ui', 'dashboard', 'widget', '侧边栏', '界面', '主题', '仪表盘', '组件', 'display', 'view', '界面'];

/** true = 明显依赖 Web UI，标「界面类」；false = 「可验证」。 */
export function isUiDependent(p: CommunityPlugin): boolean {
  const text = `${p.description ?? ''} ${p.name} ${p.fullName}`.toLowerCase();
  return UI_HINT_KWS.some((k) => text.includes(k));
}

// ---------- 排序 ----------
type SortKey = 'stars' | 'pushedAt';
const SORT_LABEL: Record<SortKey, string> = { stars: 'Star 数', pushedAt: '最近更新' };

// ---------- 展示辅助 ----------
const SOURCE_LABEL: Record<string, string> = {
  github: 'GitHub 实时',
  cache: '缓存',
  static: '内置精选',
};
const SOURCE_TONE: Record<string, string> = {
  github: 'bg-emerald-100 text-emerald-700',
  cache: 'bg-blue-100 text-blue-700',
  static: 'bg-amber-100 text-amber-700',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtStars(n: number): string {
  if (!n || n <= 0) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** 紧凑插件卡：一行元信息 + 一行描述/标记，整卡可点击跳 GitHub。 */
const PluginCard: React.FC<{ p: CommunityPlugin }> = ({ p }) => {
  const uiDep = isUiDependent(p);
  const cat = classifyPlugin(p);
  return (
    <a
      href={p.url}
      target="_blank"
      rel="noreferrer"
      className={`block rounded-md border px-3 py-2 transition-colors active:scale-[0.99] ${
        uiDep
          ? 'border-zinc-200 bg-zinc-50 opacity-70 hover:border-zinc-300'
          : 'border-zinc-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40'
      }`}
      title={`${p.url}\n${p.description || ''}`}
    >
      {/* 第一行：名称 · 星标 · 日期 · 外链 */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-sm font-semibold text-zinc-800 font-mono truncate flex-1" title={p.fullName}>
          {p.fullName}
        </span>
        <span className="inline-flex items-center gap-0.5 text-xs shrink-0" title="GitHub Star 数">
          <span className="text-amber-500"><Icon name={I.star} size={12} weight="fill" /></span>
          <span className="text-zinc-600">{fmtStars(p.stars)}</span>
        </span>
        <span className="text-xs text-zinc-400 shrink-0" title="最近推送时间">{fmtDate(p.pushedAt)}</span>
        <span className="text-zinc-300 shrink-0"><Icon name={I.arrowSquareOut} size={12} /></span>
      </div>
      {/* 第二行：兼容标记 · 分类 · 描述（单行截断） */}
      <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
        <span
          className={`text-xs px-1.5 py-0.5 rounded shrink-0 leading-5 ${
            uiDep ? 'bg-zinc-200 text-zinc-500' : 'bg-sage-100 text-sage-700'
          }`}
          title={uiDep ? '界面类 · 不适用 headless' : '候选可验证'}
        >
          {uiDep ? '界面类' : '可验证'}
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 shrink-0 leading-5" title="分类为关键词启发式，可能误判">
          {cat}
        </span>
        <span className="text-xs text-zinc-500 truncate min-w-0" title={p.description || '（无描述）'}>
          {p.description || '（无描述）'}
        </span>
      </div>
    </a>
  );
};

/** 顶部数据源徽章（紧凑：仅色块 + 过期标，完整时间放 title）。 */
const SourceBadge: React.FC<{ source: string | null; stale: boolean; fetchedAt: string | null }> = ({
  source,
  stale,
  fetchedAt,
}) => {
  const label = source ? SOURCE_LABEL[source] || source : '未知';
  const tone = SOURCE_TONE[source || ''] || 'bg-zinc-100 text-zinc-500';
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${tone}`}
      title={
        fetchedAt
          ? `${label} · 更新于 ${new Date(fetchedAt).toLocaleString('zh-CN', { hour12: false })}`
          : label
      }
    >
      <Icon name={source === 'github' ? I.github : I.storefront} size={12} />
      {label}
      {stale && <span className="font-semibold">· 过期</span>}
    </span>
  );
};

const LOADING_SKELETONS = Array.from({ length: 8 }, (_, i) => i);

/** 插件市场面板（高密度）。 */
export const CommunityMarket: React.FC = () => {
  const plugins = useCommunityStore((s) => s.plugins);
  const source = useCommunityStore((s) => s.source);
  const stale = useCommunityStore((s) => s.stale);
  const fetchedAt = useCommunityStore((s) => s.fetchedAt);
  const loading = useCommunityStore((s) => s.loading);
  const error = useCommunityStore((s) => s.error);
  const load = useCommunityStore((s) => s.load);

  const [query, setQuery] = React.useState('');
  const [cat, setCat] = React.useState<CommunityCategory | '全部'>('全部');
  const [sort, setSort] = React.useState<SortKey>('stars');

  React.useEffect(() => {
    load();
  }, [load]);

  const filtered = React.useMemo(() => {
    let list = plugins;
    if (cat !== '全部') {
      list = list.filter((p) => classifyPlugin(p) === cat);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        `${p.fullName} ${p.name} ${p.owner} ${p.description ?? ''}`.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      if (sort === 'stars') return (b.stars || 0) - (a.stars || 0);
      const pa = a.pushedAt ? Date.parse(a.pushedAt) : 0;
      const pb = b.pushedAt ? Date.parse(b.pushedAt) : 0;
      return pb - pa;
    });
  }, [plugins, cat, query, sort]);

  return (
    <div className="p-3 space-y-2">
      {/* 工具条：搜索 + 排序 + 数据源徽章（一行） */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400">
            <Icon name={I.search} size={14} />
          </span>
          <input
            className="w-full text-sm border border-zinc-300 rounded-md pl-7 pr-2 py-1.5 bg-white focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
            placeholder="搜索插件名 / 描述关键词…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="text-sm border border-zinc-300 rounded-md px-1.5 py-1.5 bg-white text-zinc-600 shrink-0"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          title="排序方式"
        >
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABEL[k]}
            </option>
          ))}
        </select>
        <SourceBadge source={source} stale={stale} fetchedAt={fetchedAt} />
      </div>

      {/* 分类筛选（启发式） */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {(['全部', ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            className={`text-xs px-2 py-1 rounded-md border transition-all active:scale-[0.97] ${
              cat === c
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : 'border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300'
            }`}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 数据源说明 */}
      {source === 'static' && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          GitHub 暂不可达（限流/网络），显示内置精选列表。缓存过期后网关会自动重试。
        </div>
      )}
      {source === 'cache' && stale && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          数据来自过期缓存（GitHub 刷新失败），仅供参考。
        </div>
      )}

      {/* 列表 / 加载 / 空态（两列紧凑网格） */}
      {loading && plugins.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {LOADING_SKELETONS.map((i) => (
            <div key={i} className="rounded-md border border-zinc-200 p-2 space-y-1.5">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : error && plugins.length === 0 ? (
        <EmptyState icon={I.plugs} title="社区插件加载失败" hint={error} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={I.search}
          title={plugins.length === 0 ? '暂无插件数据' : '没有匹配的插件'}
          hint={
            plugins.length === 0
              ? '确认网关（server.mjs）运行中，且已升级到含 /api/community-plugins 的版本。'
              : '换个搜索词或分类试试。'
          }
        />
      ) : (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {filtered.map((p) => (
              <PluginCard key={p.fullName} p={p} />
            ))}
          </div>
          <div className="text-xs text-zinc-400 pt-1.5 flex items-center justify-between">
            <span>共 {filtered.length} 个插件（筛选后）</span>
            <button
              className="inline-flex items-center gap-1 text-emerald-600 hover:underline"
              onClick={() => load()}
              disabled={loading}
            >
              <Icon name={I.refresh} size={12} />
              {loading ? '刷新中…' : '刷新'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
