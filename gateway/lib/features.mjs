// =============================================================================
// 功能商店（Feature Store）— yxspec 适配功能的可启停开关层（Track B 后端）
// =============================================================================
// 概念：等价于 Claude Code 的 skills 商店，但挂在网关上——每个"功能"定义
//      它对哪些阶段注入什么内容；开关开 → 注入规则/模板/评分标准进 agent prompt；
//      关 → 降级为简要 prompt（buildAgentPrompt 的既有 brief 逻辑）。
//
// 三类开关：
//   1. rule-inject（轻量）：把 yxspec 框架 templates/rules/ 下的规则 yaml 注入对应阶段。
//      规则文件读不到（项目无 templates 或框架路径不可达）→ 注入空，开关仍显示。
//   2. builtin（轻量）：复用网关既有逻辑（knowledge-first / tool-restrict / audit-ledger），
//      本次只是把"始终生效"改成"可由开关控制"。
//   3. heavy（重，灰置）：依赖 RuFlo MCP / yxspec skill 在 harness 链路可用性未确认，
//      默认关、available=false，前端灰置（等 yxspec 专家 AI 确认后点亮）。
//
// 用户自定义功能：project/config/custom-features.yaml（与 features.yaml 同目录），
//   网关把内置 FEATURES 与自定义功能合并为运行时注册表（getFeatureMap）。
//   自定义 id 与内置冲突时【忽略自定义那条】（防误覆盖内置），其余完全复用
//   内置的开关/注入逻辑（isFeatureEnabled / setFeature / collectFeaturePrompts /
//   buildFeatureSections / loadRuleFile）。
//
// 配置落盘：project/config/features.yaml（每行 `id: true|false`，极简格式零依赖）。
// 缺失 → 回落 defaultEnabled（轻量开关默认全开 = 行为与现在一致）。
// =============================================================================
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from './paths.mjs'

// 规则文件根：优先项目本地 templates，其次 yxspec 框架仓库（Aima 项目本地无 templates，
// 规则实际在框架侧 ai_tbox/yxspec/templates/）。可经 YXSPEC_RULES_ROOT 覆盖。
export const RULES_ROOT =
  process.env.YXSPEC_RULES_ROOT ||
  'D:/Work/01_Projects/AI培训相关/yxspec_v4_tailg_linhanfei/ai_tbox/yxspec/templates'

export const FEATURES_FILE = join(PROJECT_ROOT, 'project', 'config', 'features.yaml')

// 用户自定义功能定义文件（与 features.yaml 同目录）。网关读写。
export const CUSTOM_FEATURES_FILE = join(PROJECT_ROOT, 'project', 'config', 'custom-features.yaml')

// A+A 迁移：harness 原生 dsh skills 根（<项目根>/.dsh/skills）。
// 功能开关（features.yaml）继续作为「哪些 skill 对模型可调」的依据：
//   开启 → SKILL.md frontmatter disable-model-invocation: false（模型可 skill() 调起）
//   关闭 → disable-model-invocation: true（模型目录不可见，仅 user-invocable）
export const FEATURE_SKILL_ROOT = process.env.YXSPEC_FEATURE_SKILL_ROOT || join(PROJECT_ROOT, '.dsh', 'skills')

// 阶段 token → review 检查单文件名的映射（review-checklist 用）。
// 规则：默认 review-<stageToken>.yaml；例外见下（审查 token ≠ 阶段 token）。
const REVIEW_CHECKLIST_ALIAS = {
  swe_coding_do: 'swe_coding', // 源码符合性审查 token=swe_coding
  swe_static_verify: 'sw_st', // 静态验证对应 sw_st 检查单
}

// =============================================================================
// 注册表：v1 商店货架
// 字段：name 显示名 / desc 一句话说明 / appliesTo 适用阶段数组（'all'=全部，
//      'review'=所有 review_gate=true 阶段）/ cost low|medium|high /
//      depends 依赖说明（灰置重开关用）/ available 是否可开关 /
//      defaultEnabled 默认状态 / ruleFile 规则文件（相对 RULES_ROOT）/
//      maxChars 注入截断上限 / injectText 内置注入文本（builtin 用，不读文件）
// =============================================================================
export const FEATURES = {
  // ---------- 轻量：PRD 规则注入（sys_elicitation）----------
  'prd-gq6': {
    id: 'prd-gq6',
    name: 'PRD 六维打分表（GQ-5）',
    desc: '生成 PRD 后按 CMP/VER/CON/TRC/CLR/PRI 六维自评，加权 ≥75 分通过（GQ-rules.yaml GQ-5）',
    appliesTo: ['sys_elicitation'],
    cost: 'low', depends: [], available: true, defaultEnabled: true,
    ruleFile: 'rules/prd/GQ-rules.yaml', section: 'gq_rules', subKey: 'id: GQ-5', maxChars: 2000,
  },
  'prd-iq': {
    id: 'prd-iq',
    name: 'PRD 内联质量断言（IQ）',
    desc: '生成时逐项即时校验 IQ-1~9：章节完整性/占位符/来源/编号格式/验收准则等',
    appliesTo: ['sys_elicitation'],
    cost: 'low', depends: [], available: true, defaultEnabled: true,
    ruleFile: 'rules/prd/GQ-rules.yaml', section: 'iq_rules', maxChars: 3000,
  },
  'prd-mq': {
    id: 'prd-mq',
    name: 'PRD 维护性规则（MQ）',
    desc: '维护性维度质量规则（MQ-rules.yaml）',
    appliesTo: ['sys_elicitation'],
    cost: 'low', depends: [], available: true, defaultEnabled: true,
    ruleFile: 'rules/prd/MQ-rules.yaml', maxChars: 1500,
  },
  'prd-rq': {
    id: 'prd-rq',
    name: 'PRD 需求规则（RQ）',
    desc: '需求条目级规则（RQ-rules.yaml）',
    appliesTo: ['sys_elicitation'],
    cost: 'low', depends: [], available: true, defaultEnabled: true,
    ruleFile: 'rules/prd/RQ-rules.yaml', maxChars: 1500,
  },
  'prd-eq': {
    id: 'prd-eq',
    name: 'PRD 追溯规则（EQ）',
    desc: 'derived_from 格式与来源引用规范（EQ-rules.yaml）',
    appliesTo: ['sys_elicitation'],
    cost: 'low', depends: [], available: true, defaultEnabled: true,
    ruleFile: 'rules/prd/EQ-rules.yaml', maxChars: 1500,
  },
  // ---------- 轻量：SYS 规则注入（sys_analysis）----------
  'sys-granularity': {
    id: 'sys-granularity',
    name: 'SR 粒度规则',
    desc: '系统需求条目拆分粒度约束（SR-granularity-rules.yaml）',
    appliesTo: ['sys_analysis'],
    cost: 'low', depends: [], available: true, defaultEnabled: true,
    ruleFile: 'rules/sys/SR-granularity-rules.yaml', maxChars: 1500,
  },
  'sys-aq': {
    id: 'sys-aq',
    name: 'SYS 追问规则（AQ）',
    desc: '系统层需求澄清/追问机制（SYS-AQ-rules.yaml）',
    appliesTo: ['sys_analysis'],
    cost: 'low', depends: [], available: true, defaultEnabled: true,
    ruleFile: 'rules/sys/SYS-AQ-rules.yaml', maxChars: 1500,
  },
  'sys-fix': {
    id: 'sys-fix',
    name: 'SYS 修复动作规则',
    desc: '系统需求修复动作分类与边界（SYS-fix-actions-rules.yaml）',
    appliesTo: ['sys_analysis'],
    cost: 'low', depends: [], available: true, defaultEnabled: true,
    ruleFile: 'rules/sys/SYS-fix-actions-rules.yaml', maxChars: 1500,
  },
  // ---------- 轻量：SWE 规则注入（swe_arch）----------
  'swe-arch-terms': {
    id: 'swe-arch-terms',
    name: '架构术语中英映射',
    desc: '软件架构术语中英对照表（tech_terms_cn_en.yaml）',
    appliesTo: ['swe_arch'],
    cost: 'low', depends: [], available: true, defaultEnabled: true,
    ruleFile: 'rules/swe-arch/tech_terms_cn_en.yaml', maxChars: 1200,
  },
  // ---------- 轻量：阶段审查检查单（各 review 阶段）----------
  'review-checklist': {
    id: 'review-checklist',
    name: '阶段审查检查单',
    desc: '各阶段 review 时注入对应检查单（templates/yaml/review-checklist/review-<stage>.yaml）',
    appliesTo: ['review'],
    cost: 'low', depends: [], available: true, defaultEnabled: true,
    ruleFile: 'yaml/review-checklist/', maxChars: 2500,
  },
  // ---------- 轻量：内置（复用网关既有逻辑，改为可开关）----------
  'knowledge-first': {
    id: 'knowledge-first',
    name: '知识库检索优先',
    desc: '查询上游源资料前先读 project/knowledge/index.md 定位再跳源（已有逻辑，改可开关）',
    appliesTo: ['all'],
    cost: 'low', depends: ['project/knowledge/index.md'], available: true, defaultEnabled: true,
    ruleFile: null, maxChars: 0,
  },
  'tool-restrict': {
    id: 'tool-restrict',
    name: '工具集裁剪（coding 硬限制）',
    desc: 'coding/验证阶段只允许 fs/bash，禁止编排/web/外部 API 工具（已有逻辑，改可开关）',
    appliesTo: ['swe_coding_do', 'swe_static_verify', 'swe_coding_verify', 'swe_coding_verify_pc', 'sqt_auto_test'],
    cost: 'low', depends: [], available: true, defaultEnabled: true,
    ruleFile: null, maxChars: 0,
  },
  'audit-ledger': {
    id: 'audit-ledger',
    name: '全量审计账本',
    desc: '每轮 agent 的 tool/call+tool/result+turn/end 追加写 .dsh/gateway-log/<session>/turn-<n>.jsonl（始终启用）',
    appliesTo: ['all'],
    cost: 'low', depends: [], available: true, defaultEnabled: true, always: true,
    ruleFile: null, maxChars: 0,
  },
  // ---------- 重（灰置）：依赖 harness 链路可用性未确认 ----------
  'prd-pipeline': {
    id: 'prd-pipeline',
    name: 'PRD 生成流水线（hive-mind）',
    desc: '五阶段 plan→extract→merge→generate→review 并发编排（prd-generation-pipeline skill，依赖 RuFlo MCP）',
    appliesTo: ['sys_elicitation'],
    cost: 'high', depends: ['RuFlo MCP', 'yxspec skill'], available: false, defaultEnabled: false,
    ruleFile: null, maxChars: 0,
  },
  'coding-rules': {
    id: 'coding-rules',
    name: '工程编码规则（coding-rules）',
    desc: '编码入口唯一：分层/类型/工具库/日志/通信/API 规范/禁止事项强制规范（skill 已灌真，指针指向框架权威源）',
    appliesTo: ['swe_coding_do'],
    cost: 'medium', depends: [], available: true, defaultEnabled: true,
    ruleFile: null, maxChars: 0,
  },
  // ---------- 纯 UI 功能（uiOnly：不进 agent prompt，只控制前端功能卡显隐）----------
  'ui-report': {
    id: 'ui-report',
    name: '阶段进度周报',
    desc: '驾驶舱 25 阶段进度汇总导出（纯前端插件，开启后左侧出现「周报」功能卡）',
    appliesTo: ['all'],
    cost: 'low', depends: [], available: true, defaultEnabled: false,
    ruleFile: null, maxChars: 0, uiOnly: true,
  },
  'ui-git-workspace': {
    id: 'ui-git-workspace',
    name: 'Git 工作区管控',
    desc: '工作区状态 + 阶段留痕 + 回滚留档（纯前端插件，开启后左侧出现「Git 工作区」功能卡）',
    appliesTo: ['all'],
    cost: 'low', depends: [], available: true, defaultEnabled: false,
    ruleFile: null, maxChars: 0, uiOnly: true,
  },
}

/** 内置功能 id 清单（用户自定义功能不在此列；运行时合并用 getFeatureMap）。 */
export const FEATURE_IDS = Object.keys(FEATURES)

// =============================================================================
// 极简 yaml 读取（零依赖）：
//   loadRuleFile(relPath, maxChars, topLevelKey)：
//     读规则文件，可选只提取某顶层段（如 gq_rules / iq_rules），剥离注释与空行，
//     截断到 maxChars，返回纯文本注入内容。
//   目标只是把规则原文喂给 LLM 参考，不做完整 yaml 解析。
// =============================================================================
function loadRuleFile(relPath, maxChars, topLevelKey = null, subKey = null) {
  const candidates = [
    join(PROJECT_ROOT, 'templates', relPath.split('/').join('\\')),
    join(RULES_ROOT, relPath.split('/').join('\\')),
  ]
  for (const abs of candidates) {
    try {
      if (!existsSync(abs)) continue
      let text = readFileSync(abs, 'utf-8')
      if (topLevelKey) text = extractTopLevelSection(text, topLevelKey, subKey ?? null)
      // 去注释行（yaml 注释）与空行，保留正文
      text = text.split('\n').filter((l) => {
        const t = l.trim()
        return t && !t.startsWith('#')
      }).join('\n')
      return { ok: true, content: text.slice(0, maxChars || 4000), path: abs }
    } catch {
      /* 尝试下一个候选 */
    }
  }
  return { ok: false, content: '', path: null }
}

/** 提取 yaml 顶层段（如 iq_rules / gq_rules）：
 *  找 `^<key>:<eol>` 行作为段起点，到下一个同缩进顶层 key 行或 EOF 为终点。
 *  找不到 → 返回原始文本（段名不存在时退化为整文件）。
 *  若同时给 subKey（如 'id: GQ-5'），再从该段里取 subKey 到下一条同前缀条目之间的子块。 */
function extractTopLevelSection(text, key, subKey = null) {
  const lines = text.split('\n')
  let start = -1
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`)
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i].trim())) { start = i; break }
  }
  if (start < 0) return text
  // 段终点：下一个"无缩进的 key:"（行首非空格）
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l && !l.startsWith(' ') && l.includes(':')) { end = i; break }
  }
  let block = lines.slice(start, end)
  // 子块提取：subKey 形如 'id: GQ-5'，取该行到下一条"同一缩进层级"的条目之间的内容。
  // 用「缩进层级」判定而非简单 '- id:' 前缀，避免误截 GQ-5 内部更深的 '- id: CMP' 子项。
  if (subKey) {
    const subIdx = block.findIndex((l) => l.includes(subKey))
    if (subIdx >= 0) {
      const indent = block[subIdx].match(/^\s*/)[0].length // 子块起始行的缩进
      const prefix = subKey.split(':')[0].trim() // 如 'id'
      const marker = subKey.split(':').slice(1).join(':').trim() // 如 'GQ-5'
      let subEnd = block.length
      for (let i = subIdx + 1; i < block.length; i++) {
        const l = block[i]
        const curIndent = l.match(/^\s*/)[0].length
        // 同缩进层级的 '- id:' 新条目，且不含当前 marker → 子块终点
        if (curIndent === indent && l.trim().startsWith(`- ${prefix}:`) && !l.includes(marker)) {
          subEnd = i
          break
        }
      }
      block = block.slice(subIdx, subEnd)
    }
  }
  return block.join('\n')
}

/** 读 review 检查单（按阶段 token 定位文件，含别名）。 */
function loadReviewChecklist(stageToken) {
  const alias = REVIEW_CHECKLIST_ALIAS[stageToken] || stageToken
  return loadRuleFile(`yaml/review-checklist/review-${alias}.yaml`, 2500)
}

// =============================================================================
// 配置读写（project/config/features.yaml，极简 key: value 格式）
// =============================================================================
let _cached = null
let _mtimeMs = 0

function readConfig() {
  try {
    const st = { mtimeMs: 0 }
    try { st.mtimeMs = statSync(FEATURES_FILE).mtimeMs } catch { /* 无文件 */ }
    if (_cached && _mtimeMs === st.mtimeMs) return _cached
    const conf = {}
    if (existsSync(FEATURES_FILE)) {
      const text = readFileSync(FEATURES_FILE, 'utf-8')
      for (const line of text.split('\n')) {
        const m = line.match(/^([a-z0-9-]+):\s*(true|false)\s*$/)
        if (m) conf[m[1]] = m[2] === 'true'
      }
    }
    _cached = conf
    _mtimeMs = st.mtimeMs
    return conf
  } catch {
    return {}
  }
}

function writeConfig(conf) {
  mkdirSync(join(PROJECT_ROOT, 'project', 'config'), { recursive: true })
  const lines = [
    '# YXSpec 功能商店开关配置（网关读写）',
    '# 每行: <feature-id>: true|false；只记录被显式改动的开关，其余回落默认（见 lib/features.mjs）',
    '',
  ]
  // 合并注册表（内置 + 自定义）里被显式改动的开关才落盘
  for (const id of Object.keys(getFeatureMap())) {
    if (!(id in conf)) continue // 未改动的不写，回落默认
    lines.push(`${id}: ${conf[id] ? 'true' : 'false'}`)
  }
  writeFileSync(FEATURES_FILE, lines.join('\n') + '\n', 'utf-8')
  _cached = { ...conf }
  _mtimeMs = Date.now()
}

// =============================================================================
// 用户自定义功能（project/config/custom-features.yaml）
// 极简 yaml 子集读写（零依赖）：仅支持文档约定的固定结构——
//   features:
//     - id: my-rule
//       name: ...
//       desc: ...
//       appliesTo: [sys_analysis]   ← 必须内联数组（['all'] / ['review'] 亦支持）
//       cost: low|medium|high
//       defaultEnabled: true|false
//       ruleFile: rules/my/my-rule.yaml   （可选）
//       maxChars: 1500                    （可选）
// =============================================================================
let _customCache = null
let _customMtimeMs = 0

/** 解析 custom-features.yaml 的 features 列表（宽松：坏行忽略，坏条目后续被过滤）。 */
function parseCustomFeatures(text) {
  const items = []
  let cur = null
  let curIndent = -1
  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (indent === 0 && trimmed === 'features:') continue
    if (trimmed.startsWith('- ')) {
      cur = {}
      curIndent = indent
      items.push(cur)
      const rest = trimmed.slice(2).trim()
      if (rest) parseKeyValueInto(cur, rest)
      continue
    }
    if (cur && indent > curIndent) {
      parseKeyValueInto(cur, trimmed)
      continue
    }
    /* 顶层其它 key 或不可归属行：忽略 */
  }
  return items
}

function parseKeyValueInto(obj, rest) {
  const idx = rest.indexOf(':')
  if (idx < 0) return
  const key = rest.slice(0, idx).trim()
  if (!key) return
  obj[key] = parseScalar(rest.slice(idx + 1))
}

/** 标量解析：内联数组 / 布尔 / 数字 / 字符串（剥引号与尾部注释）。 */
function parseScalar(raw) {
  let s = String(raw ?? '').trim()
  if (s.startsWith('[') && s.endsWith(']')) {
    return s
      .slice(1, -1)
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => unquoteScalar(x))
  }
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+$/.test(s)) return Number(s)
  return unquoteScalar(s)
}

function unquoteScalar(s) {
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'")
  }
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  const hashIdx = s.indexOf(' #')
  if (hashIdx >= 0) return s.slice(0, hashIdx).trim()
  return s
}

/** 写 yaml 标量：含特殊字符或空白 → 单引号包裹（内部单引号双写），否则原样。 */
function yamlScalar(v) {
  const s = String(v ?? '')
  if (s && !/[:#\[\]{}",'&*?|!%@`\s]/.test(s)) return s
  return `'${s.replace(/'/g, "''")}'`
}

function readCustomFeatures() {
  try {
    const st = { mtimeMs: 0 }
    try { st.mtimeMs = statSync(CUSTOM_FEATURES_FILE).mtimeMs } catch { /* 无文件 */ }
    if (_customCache && _customMtimeMs === st.mtimeMs) return _customCache
    let list = []
    if (existsSync(CUSTOM_FEATURES_FILE)) {
      list = parseCustomFeatures(readFileSync(CUSTOM_FEATURES_FILE, 'utf-8'))
    }
    _customCache = list
    _customMtimeMs = st.mtimeMs
    return list
  } catch {
    return []
  }
}

function writeCustomFeatures(items) {
  mkdirSync(join(PROJECT_ROOT, 'project', 'config'), { recursive: true })
  const lines = [
    '# YXSpec 功能商店 · 用户自定义功能（网关读写）',
    '# id 不得与内置功能冲突；冲突条目在合并时会被忽略。',
    '# appliesTo 用内联数组：appliesTo: [sys_analysis] 或 [all] / [review]。',
    '# 开关状态仍记录在 project/config/features.yaml（defaultEnabled 仅作默认值）。',
    '',
    'features:',
  ]
  for (const f of items) {
    const normalized = normalizeCustom(f)
    lines.push(`  - id: ${yamlScalar(normalized.id)}`)
    lines.push(`    name: ${yamlScalar(normalized.name)}`)
    lines.push(`    desc: ${yamlScalar(normalized.desc)}`)
    lines.push(`    appliesTo: [${(normalized.appliesTo || ['all']).map((t) => yamlScalar(t)).join(', ')}]`)
    lines.push(`    cost: ${normalized.cost || 'low'}`)
    lines.push(`    defaultEnabled: ${normalized.defaultEnabled === false ? 'false' : 'true'}`)
    if (normalized.ruleFile) lines.push(`    ruleFile: ${yamlScalar(normalized.ruleFile)}`)
    if (normalized.section) lines.push(`    section: ${yamlScalar(normalized.section)}`)
    if (normalized.subKey) lines.push(`    subKey: ${yamlScalar(normalized.subKey)}`)
    if (Number.isFinite(Number(normalized.maxChars)) && Number(normalized.maxChars) > 0) {
      lines.push(`    maxChars: ${Number(normalized.maxChars)}`)
    }
  }
  writeFileSync(CUSTOM_FEATURES_FILE, lines.join('\n') + '\n', 'utf-8')
  _customCache = items.map((f) => ({ ...f }))
  _customMtimeMs = Date.now()
}

/** 归一化一条自定义功能到运行时字段（与内置 feature 同构 + custom:true 标记）。 */
function normalizeCustom(c) {
  return {
    id: String(c.id),
    name: String(c.name || c.id),
    desc: String(c.desc || ''),
    appliesTo: normalizeAppliesTo(c.appliesTo),
    cost: ['low', 'medium', 'high'].includes(c.cost) ? c.cost : 'low',
    depends: [], // 自定义无依赖
    available: true, // 自定义功能一律可开关
    defaultEnabled: c.defaultEnabled !== false,
    ruleFile: c.ruleFile ? String(c.ruleFile) : null,
    section: c.section ? String(c.section) : null,
    subKey: c.subKey ? String(c.subKey) : null,
    maxChars: Number.isFinite(Number(c.maxChars)) && Number(c.maxChars) > 0 ? Number(c.maxChars) : 4000,
    custom: true,
  }
}

/** appliesTo 归一化为数组：'all' / 'review' / 'a,b' / ['a','b'] → ['a', ...]。 */
function normalizeAppliesTo(a) {
  if (typeof a === 'string') {
    if (a === 'all' || a === 'review') return [a]
    return a.split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (Array.isArray(a)) {
    const out = []
    for (const t of a) {
      const s = typeof t === 'string' ? t.trim() : String(t ?? '')
      if (s) out.push(s)
    }
    return out
  }
  return ['all']
}

/**
 * 运行时合并注册表 = 静态内置 FEATURES + 用户自定义。
 * 自定义 id 与内置冲突（或出现在内置原型链上的危险 id）→ 忽略该条自定义，防误覆盖内置。
 */
export function getFeatureMap() {
  const map = {}
  for (const id of Object.keys(FEATURES)) map[id] = FEATURES[id]
  const customs = readCustomFeatures()
  for (const c of customs) {
    const id = c && typeof c === 'object' ? c.id : null
    if (!id || typeof id !== 'string') continue
    if (id === '__proto__' || id === 'prototype' || id === 'constructor') continue
    if (Object.prototype.hasOwnProperty.call(map, id)) continue // 冲突：忽略自定义条目
    map[id] = normalizeCustom(c)
  }
  return map
}

/** 新增自定义功能：校验必填（id 唯一且非内置 / name 非空 / appliesTo 合法 / cost 合法）。 */
export async function addCustomFeature(fields) {
  if (!fields || typeof fields !== 'object') throw new Error('缺少自定义功能字段')
  const map = getFeatureMap()
  const id = String(fields.id ?? '').trim()
  if (!id) throw new Error('id 必填')
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('id 仅允许小写字母/数字/连字符，且必须以字母开头')
  if (id === '__proto__' || id === 'prototype' || id === 'constructor') throw new Error('id 非法')
  if (Object.prototype.hasOwnProperty.call(map, id)) {
    throw new Error(`id 冲突：${id} 已存在（内置或已有自定义）`)
  }
  const name = String(fields.name ?? '').trim()
  if (!name) throw new Error('name 必填')
  const appliesTo = normalizeAppliesTo(fields.appliesTo)
  if (appliesTo.length === 0) throw new Error('appliesTo 至少填一个（all / review / 阶段 token）')
  const valid = await loadValidStageTokens()
  for (const t of appliesTo) {
    if (!valid.has(t)) throw new Error(`appliesTo 非法阶段 token：${t}`)
  }
  const cost = fields.cost ?? 'low'
  if (!['low', 'medium', 'high'].includes(cost)) throw new Error('cost 必须为 low|medium|high')
  const normalized = normalizeCustom({
    id,
    name,
    desc: String(fields.desc ?? '').trim(),
    appliesTo,
    cost,
    defaultEnabled: fields.defaultEnabled !== false,
    ruleFile: fields.ruleFile ? String(fields.ruleFile).trim() : null,
    section: fields.section ? String(fields.section).trim() : null,
    subKey: fields.subKey ? String(fields.subKey).trim() : null,
    maxChars: fields.maxChars != null ? Number(fields.maxChars) : null,
  })
  const list = readCustomFeatures()
  list.push(normalized)
  writeCustomFeatures(list)
  return { ...normalized }
}

/** 删除自定义功能（同步清理 features.yaml 里可能残留的开关记录）。 */
export function removeCustomFeature(id) {
  if (!id || typeof id !== 'string') throw new Error('id 必填')
  const list = readCustomFeatures()
  const next = list.filter((c) => c.id !== id)
  if (next.length === list.length) throw new Error(`未找到自定义功能：${id}`)
  writeCustomFeatures(next)
  const conf = readConfig()
  if (id in conf) {
    delete conf[id]
    writeConfig(conf)
  }
  return true
}

/** 合法 appliesTo token 集：全部阶段 token + 'all' + 'review'（懒加载避免与 stages.mjs 循环依赖）。 */
async function loadValidStageTokens() {
  const { STAGES: stageTable } = await import('./stages.mjs')
  return new Set([...Object.keys(stageTable), 'all', 'review'])
}

/** 某 feature 当前是否启用。
 *  available=false（灰置）恒关；config 显式记录则以 config 为准；未记录回落 defaultEnabled。 */
export function isFeatureEnabled(id) {
  const f = getFeatureMap()[id]
  if (!f || f.available === false) return false
  const conf = readConfig()
  if (id in conf) return conf[id] === true
  return f.defaultEnabled === true
}

/** 商店总览：每个 feature 的元数据 + 启用状态 + 规则内容是否加载到。 */
export function listFeatures() {
  const map = getFeatureMap()
  return Object.keys(map).map((id) => {
    const f = map[id]
    const enabled = isFeatureEnabled(id)
    let loaded = null
    if (enabled && f.ruleFile) {
      // 只有启用且已加载的注入才有内容（轻量读一次，判断文件可达）
      const rel =
        id === 'review-checklist'
          ? `${f.ruleFile}review-sys_elicitation.yaml` // 探测用：任一检查单
          : f.ruleFile
      const r = loadRuleFile(rel, 10)
      loaded = r.ok ? { path: r.path } : null
    }
    const item = {
      id,
      name: f.name,
      desc: f.desc,
      appliesTo: f.appliesTo,
      cost: f.cost,
      depends: f.depends,
      available: f.available !== false,
      always: f.always === true,
      enabled,
      loaded,
      // A+A：该 feature 对应的 harness 原生 skill（存在 SKILL.md 才有值）
      skill: existsSync(join(FEATURE_SKILL_ROOT, id, 'SKILL.md'))
        ? {
            name: id,
            invocation: skillInvocationFromFeature(id) ? 'model-disabled' : 'model-invocable',
          }
        : null,
    }
    if (f.uiOnly) item.uiOnly = true
    if (f.custom) item.custom = true
    return item
  })
}

/** 设置开关（写入 features.yaml）。重开关（available=false）拒绝。 */
export function setFeature(id, enabled) {
  const f = getFeatureMap()[id]
  if (!f) throw new Error(`unknown feature: ${id}`)
  if (f.available === false) throw new Error(`feature not available (灰置，依赖 ${(f.depends || []).join('、')})`)
  const conf = readConfig()
  conf[id] = !!enabled
  writeConfig(conf)
  return conf[id]
}

// =============================================================================
// 可用技能目录（A+A 按需加载）——供 buildAgentPrompt 注入「本阶段可用技能」指引
// =============================================================================
/** 哪些 feature 已有对应的 harness skill 目录（FEATURES 注册表里 agent 相关的都算）。
 *  uiOnly（如周报）不进 agent prompt，无 SKILL.md；audit-ledger 是网关机制，
 *  模型不可调（disable-model-invocation: true）。 */
function featureHasSkill(id) {
  const f = getFeatureMap()[id]
  if (!f) return false
  if (f.uiOnly) return false // 纯 UI 功能无 SKILL.md
  return true
}

/** 读取一个 SKILL.md 的 frontmatter 描述（轻量解析，仅读 description 字段）。 */
function readSkillDescription(id) {
  try {
    const abs = join(FEATURE_SKILL_ROOT, id, 'SKILL.md')
    if (!existsSync(abs)) return ''
    const text = readFileSync(abs, 'utf-8')
    const m = text.match(/^description:\s*(.+)$/m)
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

/**
 * feature 开关 → skill 前门（invocation）策略：
 *   开启   → disable-model-invocation: false（模型可 skill() 调起）
 *   关闭   → disable-model-invocation: true（模型目录不可见，仅 user-invocable）
 * 例外：always（如 audit-ledger）是网关机制，恒 disable-model-invocation: true（模型不可调）。
 */
export function skillInvocationFromFeature(id) {
  const f = getFeatureMap()[id]
  if (f && f.always === true) return true // 网关机制：模型不可调
  return isFeatureEnabled(id) ? false : true
}

/** 把当前开关状态同步进 .dsh/skills/<id>/SKILL.md 的 frontmatter（幂等，无文件则跳过）。 */
export function syncFeatureSkillInvocation(id) {
  try {
    const abs = join(FEATURE_SKILL_ROOT, id, 'SKILL.md')
    if (!existsSync(abs)) return false
    const text = readFileSync(abs, 'utf-8')
    const want = skillInvocationFromFeature(id)
    const next = text.replace(
      /^(disable-model-invocation:\s*)(true|false)\s*$/m,
      `$1${want}`,
    )
    if (next !== text) writeFileSync(abs, next, 'utf-8')
    return true
  } catch {
    return false
  }
}

/** 同步全部 agent 相关 feature 的 SKILL.md frontmatter（setFeature / 启动时调用）。返回成功同步数。 */
export function syncAllFeatureSkillInvocations() {
  const map = getFeatureMap()
  let n = 0
  for (const id of Object.keys(map)) {
    if (featureHasSkill(id)) {
      if (syncFeatureSkillInvocation(id)) n++
    }
  }
  return n
}

/**
 * 列出 .dsh/skills 下已生成的原生 skill（供前端「dsh skills」只读清单展示）。
 * 只列 FEATURES 注册表里有对应 feature 的 skill；字段对齐前端 FeatureItem 扩展。
 */
export function listFeatureSkills() {
  const out = []
  let entries = []
  try { entries = readdirSync(FEATURE_SKILL_ROOT, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const id = e.name
    const f = getFeatureMap()[id]
    if (!f) continue
    const skillFile = join(FEATURE_SKILL_ROOT, id, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    out.push({
      id,
      name: id, // skill 名 = kebab-case feature id
      desc: f.desc,
      description: readSkillDescription(id),
      enabled: isFeatureEnabled(id),
      invocation: skillInvocationFromFeature(id) ? 'model-disabled' : 'model-invocable',
      source: 'project-dsh',
      path: skillFile,
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** 某阶段「可用技能目录」——A+A 按需加载核心：只给 name+desc，不给全文，模型要时再 skill() 调起。 */
export function collectSkillGuide(featuresEnabled, stageToken, stage) {
  const out = []
  const map = getFeatureMap()
  for (const id of Object.keys(map)) {
    const f = map[id]
    if (!f) continue
    if (f.uiOnly) continue // 纯 UI 功能不进 agent prompt
    if (f.available === false) continue // 灰置：不给模型
    if (f.always) continue // audit-ledger 是网关机制，非 prompt 技能
    if (!featuresEnabled[id]) continue
    // 命中判定与旧 collectFeaturePrompts 完全一致（custom 语义 / 内置语义）
    let hit
    if (f.custom) {
      hit = (f.appliesTo || []).includes('all')
        ? true
        : (f.appliesTo || []).includes('review')
          ? stage.review_gate === true
          : (f.appliesTo || []).includes(stageToken)
    } else {
      hit =
        f.appliesTo === 'all' ? true
          : f.appliesTo === 'review' ? (stage.review_gate === true)
          : (f.appliesTo || []).includes(stageToken)
    }
    if (!hit) continue
    const skillFile = join(FEATURE_SKILL_ROOT, id, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const description = readSkillDescription(id) || f.desc
    out.push(`- ${id}：${description}`)
  }
  return out
}

/**
 * 供 buildAgentPrompt 使用：返回「本阶段可用技能」指引段。
 * 语义从「全量注入规则正文」改为「目录 + 提示按需调起」。
 * 对历史调用方保持返回 string 契约。
 */
export function buildFeatureSections(stageToken, stage) {
  const enabled = {}
  const map = getFeatureMap()
  for (const id of Object.keys(map)) {
    const f = map[id]
    if (f && f.available !== false && isFeatureEnabled(id)) enabled[id] = true
  }
  const guide = collectSkillGuide(enabled, stageToken, stage)
  if (guide.length === 0) return ''
  const lines = []
  lines.push('### 可用技能（harness 原生 dsh skills，按需加载）')
  lines.push('以下是本阶段可用的质量/规则技能目录。需要时用 skill({ name: "<id>" }) 调起读取完整规则正文并严格执行；不需要时不要全部加载。')
  lines.push(...guide)
  return lines.join('\n')
}

/** 旧全量注入收集器：已停用（A+A 迁移），保留导出兼容调用方，恒返回空数组。 */
export function collectFeaturePrompts() {
  return []
}
