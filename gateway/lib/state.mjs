// dsh_state.json 读写 + 状态机迁移（Track B 后端 · 全 25 阶段版）
// 契约 §1 状态 schema：pending|ready|in_progress|done|blocked|stale|skipped
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { STAGES, applyGatesToState, scanGates, scanStageArtifacts, globHit } from './stages.mjs'
import { PROJECT_ROOT, STATE_PATH } from './paths.mjs'
/** 状态机合法迁移（契约 §1）。 */
const TRANSITIONS = {
  pending: ['ready', 'in_progress', 'skipped'],
  ready: ['in_progress', 'pending', 'skipped'],
  in_progress: ['done', 'blocked', 'pending'],
  blocked: ['in_progress', 'pending', 'skipped'],
  done: ['stale'],
  skipped: ['pending'],
  stale: ['pending', 'in_progress'],
}

export function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false
}

/** 生成全新 25 阶段状态。 */
function buildFullState() {
  const state = {
    $schema: 'dsh_state.schema.json',
    project: 'Aima_X1_BCM',
    version: 2, // 全 25 阶段
    updatedAt: new Date().toISOString(),
    stages: {},
    current: 'init',
    productAdapters: { bcm: true },
  }
  for (const [token, stage] of Object.entries(STAGES)) {
    state.stages[token] = {
      token,
      command: stage.command,
      aspice: stage.aspice,
      state: 'pending',
      review: null,
      artifacts: [],
      gate: null,
      owner: null,
      lastUpdate: null,
    }
  }
  const gates = scanGates(state)
  applyGatesToState(state, gates)
  return state
}

/**
 * 迁移：把旧版本（6 阶段 / 部分阶段）dsh_state 补成完整 25 阶段。
 * 已有阶段保留原状态；缺失阶段补 pending。version 升到 2。
 * @returns {[state, changed]} changed=true 表示发生了结构变更（需回写）
 */
function migrateState(state) {
  if (!state || typeof state !== 'object') return [buildFullState(), true]
  let changed = false
  for (const [token, stage] of Object.entries(STAGES)) {
    if (state.stages?.[token]) {
      // 已有阶段：补齐 command/aspice（可能来自旧版）
      const entry = state.stages[token]
      if (!entry.token) { entry.token = token; changed = true }
      if (entry.command !== stage.command) { entry.command = stage.command; changed = true }
      if (entry.aspice !== stage.aspice) { entry.aspice = stage.aspice; changed = true }
      if (!entry.review) { entry.review = null; changed = true }
      if (!Array.isArray(entry.artifacts)) { entry.artifacts = []; changed = true }
      if (!entry.owner) { entry.owner = null; changed = true }
      if (!entry.lastUpdate) { entry.lastUpdate = null; changed = true }
    } else {
      if (!state.stages) { state.stages = {}; changed = true }
      state.stages[token] = {
        token,
        command: stage.command,
        aspice: stage.aspice,
        state: 'pending',
        review: null,
        artifacts: [],
        gate: null,
        owner: null,
        lastUpdate: null,
      }
      changed = true
    }
  }
  if (state.version !== 2) { state.version = 2; changed = true }
  if (!state.current) { state.current = 'init'; changed = true }
  return [state, changed]
}

/** 新建空白状态文件（若不存在）；存在则迁移。 */
export function ensureStateFile() {
  if (!existsSync(STATE_PATH)) {
    const state = buildFullState()
    writeState(state)
    return state
  }
  const state = readState()
  const gates = scanGates(state)
  applyGatesToState(state, gates)
  writeState(state)
  return state
}

export function readState() {
  if (!existsSync(STATE_PATH)) return ensureStateFile()
  let state, changed
  try {
    ;[state, changed] = migrateState(JSON.parse(readFileSync(STATE_PATH, 'utf8')))
  } catch {
    return ensureStateFile()
  }
  // 迁移或补齐字段后回写磁盘（幂等；不改变状态值）
  if (changed) writeState(state)
  // 产物即完成对账（自愈）：产物已命中 + 上游全 done 的 blocked/pending 阶段 → done
  const reconChanged = reconcileState(state)
  // current 应指向第一个未完成阶段；对账有变更或 current 落后（如历史残值）都一并修正
  const next = nextCurrent(state)
  const curStale = !!(state.current && next && next !== state.current)
  if (reconChanged || curStale) {
    if (next) state.current = next
    writeState(state)
  }
  return state
}

export function writeState(state) {
  state.updatedAt = new Date().toISOString()
  mkdirSync(dirname(STATE_PATH), { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
  return state
}

/** 原子更新：读 → 改 → 写。 */
export function updateState(fn, opts) {
  const state = readState()
  const result = fn(state)
  // 重新扫描门控与产物（可能被 agent 改了文件）
  const gates = scanGates(state)
  applyGatesToState(state, gates)
  for (const [token, stage] of Object.entries(state.stages)) {
    const meta = STAGES[token]
    if (!meta) continue
    stage.artifacts = scanStageArtifacts(meta)
  }
  // 产物即完成对账（写盘前，跳过活跃 token 防误伤——正在跑的阶段不提前标 done）
  reconcileState(state, opts)
  writeState(state)
  return result ?? state
}

/** 快照响应（契约 §1 结构 + 计算 current）。current 动态计算，不依赖落盘值。 */
export function snapshot() {
  const state = readState()
  const gates = scanGates(state)
  applyGatesToState(state, gates)
  for (const [token, meta] of Object.entries(STAGES)) {
    const stage = state.stages[token]
    if (!stage) continue
    stage.artifacts = scanStageArtifacts(meta)
  }
  state.current = nextCurrent(state)
  return state
}

/** 读取产物快照时，附加每阶段文件列表。 */
export function snapshotWithFiles() {
  return snapshot()
}

/** 计算 current：第一个不是 done/skipped 的活跃阶段。
 * 废弃/变体阶段（swe_detail / swe_coding_verify_pc）不参与推进：
 * 与 reconcileState / 周报口径 / /api/resume 一致，否则 swe_arch_if 完成后
 * current 会永远卡在永不完成的 swe_detail 上。 */
export function computeCurrent(state) {
  for (const token of Object.keys(STAGES)) {
    const meta = STAGES[token]
    if (meta.deprecated || meta.variant) continue
    const s = state.stages?.[token]
    if (s && s.state !== 'done' && s.state !== 'skipped') return token
  }
  return state.current ?? Object.keys(STAGES)[0]
}

/** 计算当前应推进的阶段（快照用，不落盘）。 */
export function nextCurrent(state) {
  return computeCurrent(state)
}

/**
 * 产物即完成对账：把「产物已命中 + 上游全 done + 未被正在跑」的阶段推进为 done。
 * 目标阶段（token）若 in_progress 则跳过（跑完由 runAndEmit 回写），防中途误伤。
 * 适用状态：blocked / pending / ready（stale/skipped/done 不动）。
 * 幂等：全 done 时无变更。
 */
export function reconcileState(state, { activeToken = null } = {}) {
  let changed = false
  for (const [token, meta] of Object.entries(STAGES)) {
    if (token === activeToken) continue
    if (meta.deprecated || meta.variant) continue
    const s = state.stages?.[token]
    if (!s) continue
    if (s.state === 'done' || s.state === 'stale' || s.state === 'skipped') continue
    if (s.state === 'in_progress') continue
    // 上游是否全 done（无上游阶段视为满足）
    const upOk = Object.entries(meta.upstream || {}).every(([k]) => state.stages?.[k]?.state === 'done')
    if (!upOk) continue
    // 产物是否命中（有 spec_glob 的阶段；无 glob 阶段如 SDK tag 靠 runAndEmit 回写）
    const globs = meta.spec_globs || []
    if (globs.length === 0) continue
    const hit = globs.some((g) => globHit(g))
    if (!hit) continue
    s.state = 'done'
    s.lastUpdate = new Date().toISOString()
    changed = true
  }
  return changed
}
