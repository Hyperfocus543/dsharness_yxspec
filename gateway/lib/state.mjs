// dsh_state.json 读写 + 状态机迁移（Track B 后端）
// 契约 §1 状态 schema：pending|ready|in_progress|done|blocked|stale|skipped
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { STAGES, applyGatesToState, scanGates, scanArtifacts } from './stages.mjs'

export const PROJECT_ROOT = 'D:/Work/01_Projects/Aima_X1_BCM'
export const STATE_PATH = join(PROJECT_ROOT, '.dsh', 'dsh_state.json')

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

/** 新建空白状态文件（若不存在）。 */
export function ensureStateFile() {
  if (existsSync(STATE_PATH)) return readState()
  const state = {
    $schema: 'dsh_state.schema.json',
    project: 'Aima_X1_BCM',
    version: 1,
    updatedAt: new Date().toISOString(),
    stages: {},
    current: 'sqt_strategy',
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
  writeState(state)
  return state
}

export function readState() {
  if (!existsSync(STATE_PATH)) return ensureStateFile()
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return ensureStateFile()
  }
}

export function writeState(state) {
  state.updatedAt = new Date().toISOString()
  mkdirSync(dirname(STATE_PATH), { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
  return state
}

/** 原子更新：读 → 改 → 写。 */
export function updateState(fn) {
  const state = readState()
  const result = fn(state)
  // 重新扫描门控与产物（可能被 agent 改了文件）
  const gates = scanGates(state)
  applyGatesToState(state, gates)
  for (const [token, stage] of Object.entries(state.stages)) {
    const meta = STAGES[token]
    if (!meta) continue
    stage.artifacts = scanArtifacts(meta.spec_glob)
  }
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
    stage.artifacts = scanArtifacts(meta.spec_glob)
  }
  state.current = nextCurrent(state)
  return state
}

/** 读取产物快照时，附加每阶段文件列表。 */
export function snapshotWithFiles() {
  const state = snapshot()
  return state
}

/** 计算 current：第一个不是 done/skipped 的阶段。 */
export function computeCurrent(state) {
  for (const token of Object.keys(STAGES)) {
    const s = state.stages[token]
    if (s && s.state !== 'done' && s.state !== 'skipped') return token
  }
  return state.current ?? Object.keys(STAGES)[0]
}

/** 计算当前应推进的阶段（快照用，不落盘）。 */
export function nextCurrent(state) {
  return computeCurrent(state)
}
