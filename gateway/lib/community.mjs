// =============================================================================
// community.mjs — 社区插件市场数据源（GET /api/community-plugins）
// =============================================================================
// 数据源：GitHub search API `q=topic:dsh-plugin`（社区登记层 dsh-plugin.org 的
// 仓库集合，与 DeepSeek 无隶属）。search API 无 token 限 32 次/小时
// （X-RateLimit-Reset），因此必须网关缓存，只在缓存过期时打一次 GitHub：
//
//   1) 缓存 < 6h         → 直接返回（source=cache）
//   2) 过期/无缓存       → 拉 GitHub（per_page=100，分页上限 8 页防超限，
//                          排除 fork，映射精简字段）→ 写缓存（source=github）
//   3) GitHub 挂/限流    → 有旧缓存则返回旧数据 + stale=true
//   4) 连缓存都没有      → 返回内置静态精选列表（source=static）
//
// 前端拿到的插件仅用于「浏览/筛选」，本期不做安装，不挂进 runtime。
// =============================================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const COMMUNITY_CACHE_FILE = join(__dirname, '..', 'community-plugins-cache.json')

const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 小时缓存
const MAX_PAGES = 8                     // 每页 100 条，最多 800 条，防打爆 search API 配额
const PER_PAGE = 100
const GITHUB_API = 'https://api.github.com'
const SEARCH_QUERY = 'topic:dsh-plugin'
// GitHub API 强制要求 User-Agent，缺失会被 403
const UA = 'yxspec-studio-gateway/1.0'

/** 单飞：并发请求共用一次 GitHub 拉取（避免多个客户端同时过期时打爆配额）。 */
let inflight = null

// =============================================================================
// 内置静态精选（source=static 的兜底数据）
// 来源：dsh-plugin.org 社区站首页确认的工具/MCP/记忆/模型/智能体类仓库。
// 描述为社区站核验过的功能概括；stars/pushedAt 未知 → 0 / null（前端显示 —）。
// 明显依赖 Web UI 的条目保留在列表里，用 description 触发前端「界面类」灰置标注，
// 让 headless 兼容标记在静态源下也有演示样本。
// =============================================================================
const STATIC_PLUGINS = [
  { fullName: 'adoresever/graph-memory', name: 'graph-memory', owner: 'adoresever', description: '知识图谱记忆：跨会话召回 + 上下文压缩（记忆与上下文类）', stars: 0, pushedAt: null, url: 'https://github.com/adoresever/graph-memory' },
  { fullName: 'mnemon-dev/mnemon', name: 'mnemon', owner: 'mnemon-dev', description: 'LLM 监督的持久记忆：图式召回 + 跨会话知识（记忆与上下文类）', stars: 0, pushedAt: null, url: 'https://github.com/mnemon-dev/mnemon' },
  { fullName: 'nanmicoder/dsh-agent-teams', name: 'dsh-agent-teams', owner: 'nanmicoder', description: '多智能体编排：把单个 DSH 会话变成协调的子智能体团队（技能与智能体类）', stars: 0, pushedAt: null, url: 'https://github.com/nanmicoder/dsh-agent-teams' },
  { fullName: 'bowenliang123/dsh-context', name: 'dsh-context', owner: 'bowenliang123', description: '上下文洞察与管理：/context 命令 + 仪表盘与浏览器视图（记忆与上下文类）', stars: 0, pushedAt: null, url: 'https://github.com/bowenliang123/dsh-context' },
  { fullName: 'xmanrui/dsh-im', name: 'dsh-im', owner: 'xmanrui', description: 'IM 机器人接入：扫码/凭据把 9 个聊天通道接到 Harness（集成与连接类）', stars: 0, pushedAt: null, url: 'https://github.com/xmanrui/dsh-im' },
  { fullName: 'sandbaseai/sandbase-harness', name: 'sandbase-harness', owner: 'sandbaseai', description: '本地优先 Harness 插件：沙箱会话 + MCP 工具 + 记忆 + 凭据 + 审计回放 + 多模型（工具与能力类）', stars: 0, pushedAt: null, url: 'https://github.com/sandbaseai/sandbase-harness' },
  { fullName: 'superdesigndev/treg', name: 'treg', owner: 'superdesigndev', description: '工具代理：一枚 token 调用海量 API 端点，按调用计费（集成与连接/MCP 类）', stars: 0, pushedAt: null, url: 'https://github.com/superdesigndev/treg' },
  { fullName: 'ysr666/dsh-vision-router', name: 'dsh-vision-router', owner: 'ysr666', description: '纯文本 agent 的眼睛：内置免费视觉链 + 像素级工具，一键安装免 Python（模型与推理类）', stars: 0, pushedAt: null, url: 'https://github.com/ysr666/dsh-vision-router' },
  { fullName: 'anionex/dsh-vision-toolkit', name: 'dsh-vision-toolkit', owner: 'anionex', description: '视觉工具包：图像问答 + 长截图 OCR + 界面还原（模型与推理类）', stars: 0, pushedAt: null, url: 'https://github.com/anionex/dsh-vision-toolkit' },
  { fullName: 'toby-bridges/api-relay-audit', name: 'api-relay-audit', owner: 'toby-bridges', description: 'AI API 中转/LLM 代理本地安全审计：提示注入 / 模型替换 / 工具调用篡改检测（集成与连接类）', stars: 0, pushedAt: null, url: 'https://github.com/toby-bridges/api-relay-audit' },
  { fullName: 'omdsh-dev/dsh-at-file', name: 'dsh-at-file', owner: 'omdsh-dev', description: '@file 提及：在 composer 检索工作区文件并把路径附加到提示词（工具与能力类）', stars: 0, pushedAt: null, url: 'https://github.com/omdsh-dev/dsh-at-file' },
  { fullName: 'liustack/modlens', name: 'modlens', owner: 'liustack', description: '视觉插件：粘贴图片即获得结构化 JSON 证据（OCR / 版式 / 语义）（模型与推理类）', stars: 0, pushedAt: null, url: 'https://github.com/liustack/modlens' },
  { fullName: 'ganyuanran/aegis', name: 'aegis', owner: 'ganyuanran', description: '方法包：让编码 agent 更可靠——基线优先 + 证据校验 + 漂移检查（技能与智能体类）', stars: 0, pushedAt: null, url: 'https://github.com/ganyuanran/aegis' },
  { fullName: 'meteornox/deepseek-balance-whale-widget', name: 'deepseek-balance-whale-widget', owner: 'meteornox', description: '界面角标鲸鱼组件：展示 DeepSeek 余额与日用量，可拖拽带动画（界面类 · 不适用 headless）', stars: 0, pushedAt: null, url: 'https://github.com/meteornox/deepseek-balance-whale-widget' },
  { fullName: 'omdsh-dev/dsh-better-sidebar', name: 'dsh-better-sidebar', owner: 'omdsh-dev', description: '侧边栏工作区：服务化扩展 + 内置文件/终端/Git/侧聊页（界面类 · 不适用 headless）', stars: 0, pushedAt: null, url: 'https://github.com/omdsh-dev/dsh-better-sidebar' },
  { fullName: 'shaobeichen/dsh-pocket', name: 'dsh-pocket', owner: 'shaobeichen', description: '手机扫码镜像控制 PC 上的 Harness，走局域网或公网（界面类 · 不适用 headless）', stars: 0, pushedAt: null, url: 'https://github.com/shaobeichen/dsh-pocket' },
  { fullName: 'superdesigndev/superdesign-skill', name: 'superdesign-skill', owner: 'superdesigndev', description: '设计判断技能：让编码 agent 生成高质量 UI / 演示 / 图形（界面类 · 不适用 headless）', stars: 0, pushedAt: null, url: 'https://github.com/superdesigndev/superdesign-skill' },
]

/** 读取缓存；不存在/损坏 → null。 */
function readCache() {
  try {
    if (!existsSync(COMMUNITY_CACHE_FILE)) return null
    const raw = readFileSync(COMMUNITY_CACHE_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.plugins)) return null
    return parsed
  } catch {
    return null
  }
}

/** 写缓存（自动建目录；失败只打日志不影响主流程）。 */
function writeCache(data) {
  try {
    mkdirSync(dirname(COMMUNITY_CACHE_FILE), { recursive: true })
    writeFileSync(COMMUNITY_CACHE_FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  } catch (e) {
    console.warn('[community] 写缓存失败:', e?.message ?? e)
  }
}

/** 精简映射：GitHub raw repo → 前端插件字段。 */
function mapRepo(r) {
  if (!r || !r.full_name) return null
  const parts = String(r.full_name).split('/')
  return {
    fullName: r.full_name,
    name: r.name ?? parts[1] ?? r.full_name,
    owner: parts[0] ?? '',
    description: r.description ?? '',
    stars: Number(r.stargazers_count) || 0,
    pushedAt: r.pushed_at ?? null,
    url: r.html_url ?? `https://github.com/${r.full_name}`,
  }
}

/** 分页拉取 GitHub search 全部结果（上限 MAX_PAGES，防超配额）。 */
async function fetchAllFromGitHub() {
  const out = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(SEARCH_QUERY)}&sort=stars&order=desc&per_page=${PER_PAGE}&page=${page}`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) {
      // 限流/超配额/5xx → 抛错走降级（不写半截缓存）
      let remaining = null
      try { remaining = res.headers?.get?.('x-ratelimit-remaining') ?? null } catch { /* ignore */ }
      console.warn(`[community] GitHub HTTP ${res.status} page=${page} rateLimitRemaining=${remaining}`)
      throw new Error(`GitHub API HTTP ${res.status}`)
    }
    const data = await res.json()
    const items = Array.isArray(data?.items) ? data.items : []
    if (items.length === 0) break
    out.push(...items)
    if (out.length >= (data?.total_count ?? Infinity)) break
    if (items.length < PER_PAGE) break
  }
  return out
}

/**
 * 主入口：缓存优先 → GitHub 兜底 → 静态精选保底。
 * @returns {{ source: 'github'|'cache'|'static', stale: boolean, fetchedAt: string|null, count: number, plugins: Array<{fullName,name,owner,description,stars,pushedAt,url}> }}
 */
export async function getCommunityPlugins() {
  const now = new Date().toISOString()
  const cached = readCache()

  // 1) 缓存有效 → 直接返回（不碰 GitHub）
  if (cached && cached.fetchedAt && Number.isFinite(Date.parse(cached.fetchedAt))) {
    if (Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) {
      return {
        source: 'cache',
        stale: false,
        fetchedAt: cached.fetchedAt,
        count: cached.plugins.length,
        plugins: cached.plugins,
      }
    }
  }

  // 2) 过期/无缓存 → 刷新 GitHub（单飞：并发只触发一次拉取）
  try {
    if (!inflight) {
      inflight = fetchAllFromGitHub().finally(() => { inflight = null })
    }
    const raw = await inflight
    const plugins = raw
      .filter((r) => !r.fork) // 排除 fork
      .map(mapRepo)
      .filter(Boolean)
    const fresh = { fetchedAt: now, plugins }
    writeCache(fresh)
    return { source: 'github', stale: false, fetchedAt: now, count: plugins.length, plugins }
  } catch (e) {
    console.warn('[community] GitHub 刷新失败，降级:', e?.message ?? e)
  }

  // 3) 有旧缓存 → 返回旧数据 + stale
  if (cached && Array.isArray(cached.plugins)) {
    return {
      source: 'cache',
      stale: true,
      fetchedAt: cached.fetchedAt,
      count: cached.plugins.length,
      plugins: cached.plugins,
    }
  }

  // 4) 无任何缓存 → 内置静态精选
  return { source: 'static', stale: false, fetchedAt: null, count: STATIC_PLUGINS.length, plugins: STATIC_PLUGINS }
}
