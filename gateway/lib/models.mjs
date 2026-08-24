// =============================================================================
// models.mjs — 网关侧模型配置管理
// 负责 model-config.json 的读写 + 默认模型 + 模型 catalog 增删 + spec 解析。
//
// 职责分工（与 settings.yaml 无关）：
//   settings.yaml 的 llm-pi-ai.providers.<route> 决定「该 provider route 是否可服务」
//   model-config.json 决定「当前请求用哪个 provider/model」（SDK 构造参数）
// 切模型 = 改 model-config + 重建 harness（见 harness.mjs getHarness）
// =============================================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const CONFIG_PATH = join(__dirname, '..', 'model-config.json')

/** 种子模型：minimax-cn 兜底 + deepseek vision（默认指向 vision）*/
const SEED_MODELS = [
  {
    id: 'minimax-cn/MiniMax-M3',
    provider: 'minimax-cn',
    model: 'MiniMax-M3',
    label: 'MiniMax M3',
    modalities: ['text'],
    contextWindow: null,
    maxTokens: 49152,
  },
  {
    id: 'deepseek/deepseek-v4-flash-vision-exp',
    provider: 'deepseek',
    model: 'deepseek-v4-flash-vision-exp',
    label: 'DeepSeek V4 Flash Vision',
    modalities: ['text', 'image'],
    contextWindow: 1000000,
    maxTokens: 128000,
  },
]

const DEFAULT_CONFIG = {
  defaultModel: 'deepseek/deepseek-v4-flash-vision-exp',
  models: SEED_MODELS,
}

/** 读配置；文件缺失时创建种子并返回。 */
export function readConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) {
      writeConfig(DEFAULT_CONFIG)
      return { ...DEFAULT_CONFIG, models: [...DEFAULT_CONFIG.models] }
    }
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      defaultModel: parsed.defaultModel ?? DEFAULT_CONFIG.defaultModel,
      models: Array.isArray(parsed.models) ? parsed.models : [...DEFAULT_CONFIG.models],
    }
  } catch {
    return { ...DEFAULT_CONFIG, models: [...DEFAULT_CONFIG.models] }
  }
}

/** 写配置（自动建目录）。 */
export function writeConfig(cfg) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8')
}

/** 当前默认模型 id。 */
export function getDefaultModelId() {
  return readConfig().defaultModel
}

/** 按 id 解析模型 entry（未找到 → throw）。 */
export function resolveModel(id) {
  const cfg = readConfig()
  const entry = cfg.models.find((m) => m.id === id)
  if (!entry) throw new Error(`模型不存在: ${id}`)
  return {
    provider: entry.provider,
    model: entry.model,
    label: entry.label ?? entry.id,
    modalities: entry.modalities ?? ['text'],
    contextWindow: entry.contextWindow ?? null,
    maxTokens: entry.maxTokens ?? 49152,
  }
}

/** 当前 harness 实际运行的 spec（无则 null）。 */
export function listModels() {
  const cfg = readConfig()
  return { defaultModelId: cfg.defaultModel, models: cfg.models }
}

/** 设默认模型（校验存在）。 */
export function setDefault(id) {
  const cfg = readConfig()
  if (!cfg.models.some((m) => m.id === id)) throw new Error(`模型不存在: ${id}`)
  cfg.defaultModel = id
  writeConfig(cfg)
  return cfg
}

/** 新增模型（校验 id 唯一）。 */
export function addModel(entry) {
  const cfg = readConfig()
  if (!entry?.provider || !entry?.model) throw new Error('provider/model 必填')
  const id = entry.id || `${entry.provider}/${entry.model}`
  if (cfg.models.some((m) => m.id === id)) throw new Error(`模型已存在: ${id}`)
  cfg.models.push({
    id,
    provider: entry.provider,
    model: entry.model,
    label: entry.label ?? id,
    modalities: entry.modalities ?? ['text'],
    contextWindow: entry.contextWindow ?? null,
    maxTokens: entry.maxTokens ?? 49152,
  })
  writeConfig(cfg)
  return cfg
}

/** 删除模型（禁止删默认或仅剩一个）。 */
export function removeModel(id) {
  const cfg = readConfig()
  if (cfg.models.length <= 1) throw new Error('至少保留一个模型')
  if (cfg.defaultModel === id) throw new Error('不能删除默认模型，请先切换默认')
  cfg.models = cfg.models.filter((m) => m.id !== id)
  writeConfig(cfg)
  return cfg
}
