// =============================================================================
// trajectory.mjs — 阶段执行轨迹读取 + 门控判定 + 视图导出
// =============================================================================
// 数据源：gateway/runtime-data/trajectory/<stage>/<stage>-<seq>.jsonl
//   （@yxspec/aspice-trajectory 插件订阅 session/event 聚合落盘，append-only；
//   每条 = 一次阶段执行记录。运行时数据，gitignore 排除。）
// 职责：
//   1. listTrajectories(stage)   — 读某阶段全部执行记录（时间升序）
//   2. trajectoryView(stage, limit) — 前端轨迹面板视图（瀑布式：turn/step/tool 行）
//   3. gateStage(stageToken)     — 门控判定（3.2 节：artifact / artifact+trajectory
//      两策略，轨迹证据三态 verified/unverified/blocked）
//   4. gateSummary()             — 全阶段门控汇总（驾驶舱徽标数据源）
//
// 门控策略（权威表 stages.mjs STAGES[].gate_policy，默认 'artifact'）：
//   - 'artifact'             ：产物文件存在即过（兼容旧行为）
//   - 'artifact+trajectory'  ：产物存在 AND 轨迹证据完整才放行
//     轨迹证据三态（吸收 dsh-todo-guard 语义）：
//       verified   → 轨迹有 turn/end + tool/result ok + 产物文件存在 → 放行
//       unverified → 轨迹存在但缺关键证据（无 turn/end 或全工具失败）→ 警告
//       blocked    → 轨迹状态 failed / interrupted / 反复失败 → 打回
//
// 红线：只读 runtime-data；不写状态文件；网关侧无 trajectory 时门控回退 artifact。
// =============================================================================
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STAGES, scanStageArtifacts, stageGlobHit } from './stages.mjs'

// 轨迹根：gateway/runtime-data/trajectory（与插件 DEFAULT_ROOT 一致；
// 副本网关可用 YXSPEC_TRAJECTORY_ROOT 覆盖，与插件共用同一 env）。
const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime-data', 'trajectory')
export const TRAJECTORY_ROOT = process.env.YXSPEC_TRAJECTORY_ROOT || DEFAULT_ROOT

/** 阶段 token 是否在权威表（复用 stages.mjs）。 */
function isStageToken(token) {
  return typeof token === 'string' && Object.prototype.hasOwnProperty.call(STAGES, token)
}

/** 读某阶段全部轨迹文件 → 记录数组（时间升序；无轨迹 → []）。 */
export function listTrajectories(stage) {
  if (!isStageToken(stage)) return []
  const dir = join(TRAJECTORY_ROOT, stage)
  let files = []
  try {
    files = readdirSync(dir).filter((f) => /^[a-z0-9_]+-\d+\.jsonl$/.test(f)).sort()
  } catch {
    return [] // 目录不存在 = 从未执行过
  }
  const out = []
  for (const f of files) {
    const abs = join(dir, f)
    let lines = []
    try {
      lines = readFileSync(abs, 'utf8').split('\n').filter((l) => l.trim())
    } catch {
      continue // 单个文件损坏不影响其余
    }
    for (const line of lines) {
      try {
        const rec = JSON.parse(line)
        if (rec && rec.stage === stage) out.push(rec)
      } catch { /* 坏行跳过 */ }
    }
  }
  return out.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}

/** 最近一次执行（无 → null）。 */
export function latestTrajectory(stage) {
  const all = listTrajectories(stage)
  return all.length > 0 ? all[all.length - 1] : null
}

/**
 * 轨迹视图（GET /api/trajectory?stage=&limit=）：
 * 瀑布式：turn/step 计数 + 工具调用序列 + 状态/耗时/token + 关键事件索引。
 * @returns {object} { stage, policy, runs, latest, events, cost, ... }
 */
export function trajectoryView(stage, limit = 50) {
  if (!isStageToken(stage)) return null
  const meta = STAGES[stage]
  const all = listTrajectories(stage)
  const rows = all.slice(-Math.max(1, Math.min(500, Number(limit) || 50)))
  const artifacts = meta ? scanStageArtifacts(meta) : []

  const latest = all.length > 0 ? all[all.length - 1] : null
  const status = latest ? trajectoryStatus(latest, meta) : null

  return {
    stage,
    label: meta?.label ?? stage,
    aspice: meta?.aspice ?? '',
    command: meta?.command ?? '',
    gate_policy: meta?.gate_policy ?? 'artifact',
    exists: meta ? stageGlobHit(meta) : false,
    artifacts: artifacts.slice(0, 30).map((a) => ({ path: a.path, kind: a.kind })),
    totalRuns: all.length,
    latest,
    status,
    rows,
  }
}

/** 轨迹证据三态判定（仅 trajectory 维度；不掺产物）。 */
export function trajectoryStatus(rec, meta) {
  if (!rec) return null
  const hasTurnEnd = rec.reason !== null || (Array.isArray(rec.events) && rec.events.includes('turn/end'))
  const toolOk = Array.isArray(rec.tools) && rec.tools.some((t) => t.type === 'tool/result' && t.ok === true)
  const failed = rec.status === 'failed' || rec.status === 'blocked'
  const status = failed ? 'blocked' : hasTurnEnd && toolOk ? 'verified' : 'unverified'
  return {
    status, // verified | unverified | blocked
    hasTurnEnd,
    toolOk,
    toolCalls: Array.isArray(rec.tools) ? rec.tools.filter((t) => t.type === 'tool/call').length : 0,
    toolResults: Array.isArray(rec.tools) ? rec.tools.filter((t) => t.type === 'tool/result').length : 0,
    tokens: rec.cost?.tokens ?? 0,
    reason: rec.reason ?? null,
  }
}

/**
 * 门控判定（3.2 节伪代码落地）：
 *   artifact              → 产物命中即过（spec_globs 为空阶段视为产物过，兼容 SDK tag 类）
 *   artifact+trajectory   → 产物命中 AND 轨迹证据三态（blocked 打回 / unverified 警告 / verified 放行）
 * @returns {object} { stage, gate_policy, artifact, trajectory, status, passed, reason }
 */
export function gateStage(stageToken) {
  const stage = STAGES[stageToken]
  if (!stage || !isStageToken(stageToken)) return { stage: stageToken, passed: false, reason: 'unknown-stage' }

  // 产物门（复用权威表 glob）：无 glob 阶段（如 swe_sdk_release tag）视产物过
  const globs = stage.spec_globs || []
  const artifactPassed = globs.length === 0 || stageGlobHit(stage)
  const artifact = {
    passed: artifactPassed,
    files: globs.length === 0 ? [] : scanStageArtifacts(stage).map((a) => a.path).slice(0, 50),
  }

  // 默认策略兼容旧行为：只产物门
  if (stage.gate_policy !== 'artifact+trajectory') {
    return {
      stage: stageToken,
      gate_policy: stage.gate_policy ?? 'artifact',
      artifact,
      trajectory: null,
      status: artifactPassed ? 'verified' : 'unverified',
      passed: artifactPassed,
      reason: artifactPassed ? 'artifact-passed' : 'artifact-missing',
    }
  }

  // artifact+trajectory：产物 AND 轨迹证据
  const latest = latestTrajectory(stageToken)
  if (!latest) {
    return {
      stage: stageToken,
      gate_policy: 'artifact+trajectory',
      artifact,
      trajectory: null,
      status: 'unverified',
      passed: artifactPassed,
      reason: artifactPassed ? 'artifact-passed-no-trajectory' : 'no-trajectory',
    }
  }
  const traj = trajectoryStatus(latest, stage)
  if (!artifactPassed) {
    return {
      stage: stageToken,
      gate_policy: 'artifact+trajectory',
      artifact,
      trajectory: traj,
      status: traj.status,
      passed: false,
      reason: 'artifact-missing',
    }
  }
  if (traj.status === 'blocked') {
    return {
      stage: stageToken,
      gate_policy: 'artifact+trajectory',
      artifact,
      trajectory: traj,
      status: 'blocked',
      passed: false,
      reason: 'trajectory-blocked',
    }
  }
  if (traj.status === 'unverified') {
    return {
      stage: stageToken,
      gate_policy: 'artifact+trajectory',
      artifact,
      trajectory: traj,
      status: 'unverified',
      passed: false,
      reason: 'trajectory-unverified',
    }
  }
  return {
    stage: stageToken,
    gate_policy: 'artifact+trajectory',
    artifact,
    trajectory: traj,
    status: 'verified',
    passed: true,
    reason: 'artifact+trajectory-passed',
  }
}

/** 全阶段门控汇总（GET /api/trajectory-gate 不带 stage 时 / 驾驶舱徽标批量数据源）。 */
export function gateSummary() {
  const out = {}
  for (const token of Object.keys(STAGES)) {
    out[token] = gateStage(token)
  }
  return out
}
