// =============================================================================
// installed.mjs — 已安装插件清单（GET /api/installed-plugins）
// =============================================================================
// 真相源 = runtime 装配表 cordis.yml（harness 真正加载了哪些插件）：
//   逐条解析 `- id: xxx` + `name: @scope/pkg`（或 `name: pkg/entry`），
//   与「内置 harness 插件」（@deepseek-ai/* 白名单）区分开 ——
//   内置插件是 sdk/runtime 基座，前端「功能开关」只展示用户额外接入的插件
//   （graph-memory、weknora、后续的 aegis 等）。
//
// 版本号：包名 → node_modules/<pkg>/package.json 的 version（读不到 → null，
// 不抛错：local module / 未装包名只显示"已装配"）。
//
// 纯静态读取，不启动 runtime、不写任何文件 —— 只回答"现在装了什么"。
// =============================================================================
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const CORDIS_CONFIG = join(__dirname, '..', 'runtime-js', 'config', 'cordis.yml')

/** 内置 harness 插件（@deepseek-ai 命名空间）→ 归类 builtin，不列进「已安装插件」。 */
const BUILTIN_PREFIXES = ['@deepseek-ai/']

/** 解析 cordis.yml → [{ id, name }]（宽松：只认 `- id:` 条目 + 相邻 name，其余行忽略）。 */
export function parseCordisEntries(text) {
  const entries = []
  let cur = null
  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    // 仅顶层条目（无缩进）且是 `- id: xxx`
    if (!line.startsWith(' ') && /^- id:\s*\S/.test(trimmed)) {
      if (cur) entries.push(cur)
      cur = { id: trimmed.replace(/^- id:\s*/, '').trim(), name: null }
      continue
    }
    // 相邻 `  name: xxx`（同条目、缩进的 name 字段）—— 用原行匹配缩进；剥 YAML 引号
    if (cur && /^\s{2,}name:\s*\S/.test(line)) {
      cur.name = line.replace(/^\s*name:\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  if (cur) entries.push(cur)
  return entries
}

/** 把 cordis 插件名归一成 npm 包名（用于查 node_modules）：`graph-memory/dsh` → `graph-memory`。 */
function toPackageName(name) {
  if (!name) return null
  const n = String(name).trim()
  if (n.startsWith('@')) {
    // scoped：@scope/pkg[/entry] → @scope/pkg
    const parts = n.split('/')
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`
    return n
  }
  // unscoped：pkg[/entry] → pkg
  return n.split('/')[0]
}

/** 读 node_modules/<pkg>/package.json 的 version（读不到 → null，静默）。 */
function readPkgVersion(pkg) {
  try {
    const mods = join(__dirname, '..', 'runtime-js', 'node_modules')
    const abs = join(mods, ...pkg.split('/'))
    const pj = join(abs, 'package.json')
    if (!existsSync(pj)) return null
    const j = JSON.parse(readFileSync(pj, 'utf-8'))
    return typeof j?.version === 'string' && j.version ? j.version : null
  } catch {
    return null
  }
}

/** 主入口：返回已安装（非内置）插件清单。 */
export function listInstalledPlugins() {
  let text = null
  try {
    if (!existsSync(CORDIS_CONFIG)) return []
    text = readFileSync(CORDIS_CONFIG, 'utf-8')
  } catch {
    return []
  }
  const out = []
  for (const e of parseCordisEntries(text)) {
    const name = e.name || e.id
    // 跳过内置 harness 基座插件
    if (BUILTIN_PREFIXES.some((p) => name.startsWith(p))) continue
    const pkg = toPackageName(name)
    out.push({
      id: e.id,
      name: name,
      package: pkg,
      version: pkg ? readPkgVersion(pkg) : null,
      source: 'cordis.yml',
    })
  }
  return out
}
