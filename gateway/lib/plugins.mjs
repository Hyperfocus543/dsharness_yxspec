// =============================================================================
// plugins.mjs — 插件统一模型（Everything-is-a-Plugin 开关层）
// =============================================================================
// 概念：把「runtime 装配（cordis.yml）里的插件」和「已验证待接入的候选能力」
//      统一成一张"插件卡 + 开关"。遵循 DSH 逻辑——所有能力都是插件、都能开关。
//
// 三层：
//   base      —— DSH harness 基座必需（sdk/session/fs/bash/compaction…），只读不可关。
//   plugin    —— 已接入 cordis.yml 的我们插件（agent-spine / weknora / graph-memory /
//                yxspec-tool-guard / agent-presets…），可开关（disable 注入）。
//   candidate —— POC 已验证、未进主装配的候选能力（subagent / session-query / ralph /
//                schedule / feedback / commands / invariants），可开关（插入装配片段）。
//
// 开关生效方式（用户拍板）：开关即重建。改 plugins.yaml → 合成装配 yml →
// closeHarness() 重建 runtime 子进程（~2-5s，开关前确认无 active turn）。
// 合成装配 = 主 cordis.yml 保留 + disabled 注入（关插件）+ 候选片段插入（开候选）。
// 不动 harness 主仓源码（红线），全部在 gateway 层。
// =============================================================================
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT_ROOT } from './paths.mjs'

const __dirname = fileURLToPath(new URL('..', import.meta.url))
export const CORDIS_CONFIG = join(__dirname, 'runtime-js', 'config', 'cordis.yml')
export const PLUGINS_STATE_FILE = join(PROJECT_ROOT, 'project', 'config', 'plugins.yaml')

// ----------------------------------------------------------------------------
// 基座 id 白名单（只读不可关）——与 installed.mjs 的 BASE_IDS 保持一致
// ----------------------------------------------------------------------------
const BASE_IDS = new Set([
  'sdk-jsonrpc-server',
  'llm-pi-ai',
  'settings',
  'credentials',
  'sessions',
  'session-checkpoints',
  'subprocess',
  'bash',
  'fs-local',
  'fs-observation-policy',
  'tool-fs',
  'tool-todo',
  'tool-goal',
  'token-meter',
  'compaction-basic',
  'agent-presets',
])

/** 已装配插件的元信息（name 来自 cordis.yml，desc 手维护）。switchable:false = 不可关。 */
const INSTALLED_PLUGIN_META = {
  // agent-spine 是 agent 主脊，几乎所有插件 inject 它，禁了整棵插件树起不来 → 不可关
  'agent-spine': { desc: 'agent 主脊：goal/todo/skills/loop/bash 组合 + DSH_SYSTEM_PROMPT persona 注入', switchable: false },
  weknora: { desc: '知识库检索（WeKnora），第一原则「检索优先」' },
  'graph-memory': { desc: '跨会话图记忆（sqlite + embedding），长流程上下文连续' },
  'yxspec-tool-guard': { desc: '工具守卫：coding 阶段结构性拦截白名单外工具 + 门控' },
}

/**
 * 候选能力注册表（POC 已验证，未进主装配）。
 * assembly = 该能力的 cordis.yml 装配片段（插入合成装配表）。
 * deps = 依赖的已存在装配项（校验依赖不悬空）。
 */
const CANDIDATE_META = [
  {
    id: 'subagent',
    name: 'subagent（并行子代理）',
    desc: 'agent 委派子 agent 并行执行——验证/评审阶段并行提效（spawn 全新 / fork 继承父历史）',
    assembly: `
- id: subagent
  name: '@deepseek-ai/dsh-subagent'
- id: subagent-spawn-in-process
  name: '@deepseek-ai/dsh-subagent-spawn-in-process'
  config:
    providerName: spawn
- id: subagent-fork-in-process
  name: '@deepseek-ai/dsh-subagent-fork-in-process'
  config:
    providerName: fork
- id: tool-subagent-control
  name: '@deepseek-ai/dsh-tool-subagent-control'
- id: tool-subagent-report
  name: '@deepseek-ai/dsh-tool-subagent-report'
- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent
    enableRunInBackground: false
- id: tool-subagent-fork
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: fork
    toolName: subagent_fork
    enableRunInBackground: false`,
    deps: [],
    guard: true,
    evidence: '.dsh/验证报告-DSH候选能力可达性-20260826.md §2.1',
  },
  {
    id: 'session-query',
    name: 'session-query（审计检索 + 轨迹）',
    desc: 'session 日志授权检索 + traceSession/traceEvent 轨迹——ASPICE 追溯断链定位',
    assembly: `
- id: session-query-sqlite
  name: '@deepseek-ai/dsh-session-query-sqlite'
  config:
    path: !!js "process.env.SESSION_QUERY_DB ?? 'D:/Work/01_Projects/Aima_X1_BCM/.dsh/gateway/runtime-js/poc-session-query/poc-session-query.db'"
    openAt: 'first-search'
- id: tool-session-query
  name: '@deepseek-ai/dsh-tool-session-query'`,
    deps: [],
    guard: true,
    evidence: '.dsh/验证报告-DSH候选能力可达性-20260826.md §2.2',
  },
  {
    id: 'ralph',
    name: 'ralph（fresh-agent 原子循环）',
    desc: 'fresh child + 不可变目标原子轮次——与自迭代「原子轮次 + 防污染」咬合',
    assembly: `
- id: workflow
  name: '@deepseek-ai/dsh-workflow'
- id: workflow-worker-thread
  name: '@deepseek-ai/dsh-workflow-worker-thread'
- id: tool-ralph
  name: '@deepseek-ai/dsh-tool-ralph'`,
    deps: [],
    guard: true,
    evidence: '.dsh/验证报告-DSH候选能力可达性-20260826.md §2.3',
  },
  {
    id: 'schedule',
    name: 'schedule（session 本地定时器）',
    desc: '无人值守定时复查/提醒（schedule_create/list/delete，session-local 投递）',
    assembly: `
- id: schedule
  name: '@deepseek-ai/dsh-schedule'`,
    deps: [],
    guard: true,
    evidence: '.dsh/验证报告-DSH候选能力可达性-20260826.md §2.4',
  },
  {
    id: 'feedback',
    name: 'feedback（人工反馈捕获）',
    desc: '人对单条消息打分/备注（sidecar）——自迭代人工反馈通道；反馈永不进模型请求',
    assembly: `
- id: storage
  name: '@deepseek-ai/dsh-storage'
- id: storage-json
  name: '@deepseek-ai/dsh-storage-json'
  config:
    root: !!js process.env.DSH_STORAGE_ROOT ?? './.storage'
- id: storage-domain
  name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- id: message-feedback
  name: '@deepseek-ai/dsh-message-feedback'
  config:
    maxNoteBytes: 8192`,
    deps: [],
    guard: false,
    evidence: '.dsh/验证报告-DSH候选能力可达性-20260826.md §2.5',
  },
  {
    id: 'commands',
    name: 'commands（阶段命令注册表）',
    desc: '把 25 个 /yxspec:* 命令经 harness 注册表路由，取代网关 includes 子串匹配',
    assembly: `
- id: yxspec-commands
  name: '@yxspec/commands'
- id: dsh-commands
  name: '@deepseek-ai/dsh-commands'`,
    deps: [],
    guard: false,
    evidence: 'gateway/runtime-js/config/cordis-poc-commands.yml',
  },
  {
    id: 'invariants',
    name: 'invariants（跨事件不变量）',
    desc: '阶段产物落盘前上游必须 done（方向 C）——结构性保证「追溯完整」',
    assembly: `
- id: invariants
  name: '@deepseek-ai/dsh-invariants'
  config:
    enabled: true
- id: yxspec-invariants
  name: '@yxspec/invariants'`,
    deps: [],
    guard: false,
    evidence: 'gateway/runtime-js/config/cordis-poc-invariants.yml',
  },
]
const CANDIDATE_MAP = Object.fromEntries(CANDIDATE_META.map((c) => [c.id, c]))

// ----------------------------------------------------------------------------
// cordis.yml 装配解析（复用 installed.mjs 的宽松解析）
// ----------------------------------------------------------------------------
function parseCordisEntries(text) {
  const entries = []
  let cur = null
  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (!line.startsWith(' ') && /^- id:\s*\S/.test(trimmed)) {
      if (cur) entries.push(cur)
      cur = { id: trimmed.replace(/^- id:\s*/, '').trim(), name: null }
      continue
    }
    if (cur && /^\s{2,}name:\s*\S/.test(line)) {
      cur.name = line.replace(/^\s*name:\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  if (cur) entries.push(cur)
  return entries
}

/** 解析 cordis.yml → 已装配插件条目（含 tier 分类）。 */
function listInstalled() {
  let text = ''
  try { if (existsSync(CORDIS_CONFIG)) text = readFileSync(CORDIS_CONFIG, 'utf-8') } catch { text = '' }
  const meta = INSTALLED_PLUGIN_META
  return parseCordisEntries(text).map((e) => {
    const base = BASE_IDS.has(e.id)
    const m = meta[e.id]
    const desc = m?.desc || (base ? 'DSH harness 基座' : '已接入 cordis.yml 的插件')
    const switchable = m?.switchable === undefined ? !base : m.switchable
    return {
      id: e.id,
      name: e.name || e.id,
      desc,
      tier: base ? 'base' : 'plugin',
      kind: 'plugin',
      switchable,
      defaultEnabled: true,
    }
  })
}

// ----------------------------------------------------------------------------
// 开关状态读写（project/config/plugins.yaml，极简 id: true|false）
// ----------------------------------------------------------------------------

function readState() {
  try {
    const conf = {}
    if (existsSync(PLUGINS_STATE_FILE)) {
      const text = readFileSync(PLUGINS_STATE_FILE, 'utf-8')
      for (const line of text.split('\n')) {
        const m = line.match(/^([a-z0-9-]+):\s*(true|false)\s*$/)
        if (m) conf[m[1]] = m[2] === 'true'
      }
    }
    return conf
  } catch { return {} }
}

function writeState(conf) {
  mkdirSync(join(PROJECT_ROOT, 'project', 'config'), { recursive: true })
  const lines = [
    '# YXSpec 插件开关状态（网关读写）',
    '# 每行: <plugin-id>: true|false；base 基座不可关，不写此文件',
    '# 开关生效 = 合成装配 → 重建 runtime（开关即重建）',
    '',
  ]
  for (const id of Object.keys(conf)) lines.push(`${id}: ${conf[id] ? 'true' : 'false'}`)
  writeFileSync(PLUGINS_STATE_FILE, lines.join('\n') + '\n', 'utf-8')
}

/** 某插件是否启用：状态文件显式记录则以此为准，否则回落 defaultEnabled。 */
export function isPluginEnabled(id) {
  const conf = readState()
  if (id in conf) return conf[id] === true
  const p = getPluginMap()[id]
  return p ? p.defaultEnabled === true : false
}

// ----------------------------------------------------------------------------
// 统一插件注册表
// ----------------------------------------------------------------------------
export function getPluginMap() {
  const map = {}
  for (const p of listInstalled()) map[p.id] = p
  for (const c of CANDIDATE_META) {
    map[c.id] = {
      id: c.id,
      name: c.name,
      desc: c.desc,
      tier: 'candidate',
      kind: 'candidate',
      switchable: true,
      defaultEnabled: false,
    }
  }
  return map
}

/** 列表：统一插件条目（含 enabled 状态）。 */
export function listPlugins() {
  const map = getPluginMap()
  return Object.keys(map).map((id) => {
    const p = map[id]
    return {
      id: p.id,
      name: p.name,
      desc: p.desc,
      kind: p.kind, // plugin | candidate
      tier: p.tier, // base | plugin | candidate
      enabled: isPluginEnabled(id),
      switchable: p.switchable !== false,
    }
  })
}

/**
 * 设置插件开关。生效方式：开关即重建。
 * 调用方（server.mjs）负责：校验无 active turn → 调本函数 → closeHarness() 重建。
 * @returns {Promise<{enabled: boolean, needsRebuild: boolean}>}
 */
export async function setPluginEnabled(id, enabled) {
  const map = getPluginMap()
  const p = map[id]
  if (!p) throw new Error(`unknown plugin: ${id}`)
  if (p.switchable === false) throw new Error(`plugin not switchable（基座不可关）: ${id}`)
  const conf = readState()
  conf[id] = !!enabled
  writeState(conf)
  return { enabled: !!enabled, needsRebuild: true }
}

// ----------------------------------------------------------------------------
// 合成装配（主 cordis.yml + disabled 注入 + 候选片段插入）
// ----------------------------------------------------------------------------
/**
 * 从主装配文本中物理剥离指定 id 的顶层条目块（含其缩进子块）。
 * 为什么物理剥离而不是 patch 层 `disabled: true` 注入：
 *   DSH boot 的 include 加载器把每条 `- id:` 视为 loader entry，
 *   主表已含 graph-memory 再注入同 id 的 disabled 条目 → duplicate loader entry id，
 *   runtime 直接拒绝启动（副本 8789 实测）。禁用 = 从装配表消失，而不是禁用标记。
 * 顶层条目格式：行首 `- id:`（无缩进）；条目内容为 2 空格缩进的子键；
 * 条目边界 = 下一个顶层行（`- id:` 或注释/键）。
 */
function stripTopLevelEntry(text, id) {
  const lines = String(text ?? '').split('\n')
  const out = []
  let skipping = false
  for (const line of lines) {
    const trimmed = line.trim()
    const isTopEntry = trimmed.startsWith('- id:')
    if (isTopEntry) {
      const entryId = trimmed.replace(/^- id:\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2')
      skipping = entryId === id
      if (skipping) continue
    }
    if (skipping) {
      // 跳过该条目内的所有缩进子行 + 紧随其后的注释（属于该条目的块头注释）
      if (line.trim().startsWith('#') || /^\s+\S/.test(line)) continue
      // 到达非缩进非注释行（下一个顶层条目/键）→ 结束跳过
      skipping = false
    }
    out.push(line)
  }
  return out.join('\n')
}

/**
 * 生成当前生效的合成装配 yml 文本。
 * 逻辑：
 *   1. 读主 cordis.yml；
 *   2. 对每个关闭的 plugin，物理剥离其顶层条目块（disabled = 从装配表消失）；
 *   3. 对每个开启的 candidate，追加其 assembly 片段。
 * 顶层注释按归属处理：条目块头注释（条目上方的 # 行）在剥离时一并移除，
 * 但通用文件头注释（第一条 - id: 之前的）保留。
 * @returns {string} 合成 yml 文本
 */
export function synthesizeConfig() {
  let text = ''
  try { if (existsSync(CORDIS_CONFIG)) text = readFileSync(CORDIS_CONFIG, 'utf-8') } catch { text = '' }
  const headers = []

  // 关闭的已装配插件 → 物理剥离（patch 层 disabled 注入会 duplicate loader entry id）
  let work = text
  const installed = listInstalled()
  for (const p of installed) {
    if (p.switchable && !isPluginEnabled(p.id)) {
      work = stripTopLevelEntry(work, p.id)
    }
  }

  // 开启的候选能力 → 插入装配片段
  const enabledCands = CANDIDATE_META.filter((c) => isPluginEnabled(c.id))
  if (enabledCands.length > 0) {
    headers.push('# ---- 候选能力（plugins.yaml 开启）----')
    for (const c of enabledCands) {
      headers.push(`# ${c.id}: ${c.name}`)
      headers.push(c.assembly.trim())
    }
  }

  const parts = []
  parts.push(work.trimEnd())
  if (headers.length > 0) parts.push('', ...headers)
  return parts.join('\n') + '\n'
}

/** 把合成装配写进临时文件，返回路径（供 runtime 启动用 env YXSPEC_CORDIS_CONFIG 指向）。 */
export function writeSynthesizedConfig() {
  const yml = synthesizeConfig()
  const dir = join(PROJECT_ROOT, '.dsh', 'gateway', 'runtime-js', 'config')
  mkdirSync(dir, { recursive: true })
  const abs = join(dir, 'cordis.synth.yml')
  writeFileSync(abs, yml, 'utf-8')
  return abs
}
