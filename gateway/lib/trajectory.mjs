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
import { existsSync, readdirSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
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
        if (rec && rec.type === 'rollback' && rec.stage === stage) {
          // 回滚审计行：与同 seq 的执行记录合并成"最新状态"（append-only 不改原行）
          const target = out.find((r) => r.seq === rec.seq)
          if (target) {
            target.rollbackId = rec.rollbackId
            target.rolled_back = true
            target.rollbackAt = rec.at
            target.rollbackReason = rec.reason ?? null
            target.rollback = rec
          }
        } else if (rec && rec.stage === stage) {
          out.push(rec)
        }
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

/** rollbackId 形态校验：`<stage>-<seq>`（stage 为小写字母/数字/下划线，seq 为正整数）。 */
export function isValidRollbackId(stage, rollbackId) {
  if (typeof rollbackId !== 'string') return false
  return rollbackId === `${stage}-${String(rollbackId.slice(stage.length + 1))}` &&
    /^\d+$/.test(rollbackId.slice(stage.length + 1))
}

/**
 * 回滚协议（3.3 节落地，吸收 dsh-continual-harness rollbackId）：
 *   门控打回/阶段失败 → 把该阶段最新轨迹标记 rolled_back，记 rollbackId/reason/时间戳。
 *   落盘形态 = 在轨迹 JSONL 尾部追加一条 rollback 审计行（append-only，不改原行），
 *   与执行记录合并成"最新状态"（rolled_back 后轨迹证据三态转 blocked → 门控打回）。
 * 幂等：同一 rollbackId 重复调用 → 返回 { already: true }，不重复追加（审计留档唯一）。
 * 不越权：本函数只"发回滚指令留档"，绝不执行 git 操作——指令与 guard.sh 的
 *   `git reset --hard 块起始` 语义对齐（rollback_commit = 该阶段执行前的 HEAD，
 *   即轨迹记录里 git 起始 commit；拿不到时给 re-run 该阶段的降级指令）。
 * @param {string} stage 阶段 token
 * @param {string} [rollbackId] 可选；缺省 = 最新轨迹的 `<stage>-<seq>`（自动生成）
 * @param {string} [reason] 可选；回滚原因（如 'trajectory-blocked' / 'review-rejected'）
 * @returns {object} { ok, already, rollbackId, seq, targetStatus, rollbackCommit, instructions, command }
 */
export function rollbackTrajectory(stage, rollbackId = null, reason = null) {
  if (!isStageToken(stage)) return { ok: false, error: 'unknown-stage', stage }
  const all = listTrajectories(stage)
  if (all.length === 0) return { ok: false, error: 'no-trajectory', stage }

  const target = all[all.length - 1] // 最新一次执行（阶段起始点）
  // 显式 rollbackId 时按 id 的 seq 定位目标（幂等/旧轨迹回滚都依赖它）
  let seq = target.seq ?? 0
  if (isValidRollbackId(stage, rollbackId)) {
    const want = Number(rollbackId.slice(stage.length + 1))
    const bySeq = all.find((r) => r.seq === want)
    if (bySeq) seq = want
  }
  const id = isValidRollbackId(stage, rollbackId) ? rollbackId : `${stage}-${seq}`
  // 幂等判定必须落在「实际回滚的那条记录」上：seq 可能因显式 rollbackId
  // 指向旧轨迹（target 只是 latest，其 rollbackId 与本次 id 未必同 seq），
  // 否则同一旧轨迹会被重复追加 rollback 审计行。
  const alreadyMarked = (all.find((r) => r.seq === seq)?.rollbackId ?? null) === id
  if (alreadyMarked) {
    // 幂等：已标记过同一 rollbackId，不再追加（审计留档唯一）
    return {
      ok: true,
      already: true,
      rollbackId: id,
      seq,
      targetStatus: target.status ?? 'unverified',
      rollbackCommit: target.git?.commit ?? null,
      instructions: [],
      command: null,
    }
  }

  const entry = {
    type: 'rollback',
    stage,
    seq,
    rollbackId: id,
    reason: typeof reason === 'string' && reason.trim() ? reason.trim() : 'manual-rollback',
    at: Date.now(),
  }
  const dir = join(TRAJECTORY_ROOT, stage)
  const file = join(dir, `${stage}-${String(seq).padStart(3, '0')}.jsonl`)
  try {
    mkdirSync(dir, { recursive: true })
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
  } catch (e) {
    return { ok: false, error: 'write-failed', message: String(e?.message ?? e), stage }
  }

  const targetStatus = target.status ?? 'unverified'
  const rollbackCommit = target.git?.commit ?? null
  // 回滚指令（只发指令留档，不执行 git）——对齐 guard.sh `git reset --hard 块起始`
  const instructions = []
  if (rollbackCommit) {
    instructions.push(
      `git reset --hard ${rollbackCommit}  # 回到 ${stage} 执行前的阶段起始 commit（对齐 guard.sh 块起始语义）`,
    )
  } else {
    instructions.push(`重新派活：${STAGES[stage]?.command ?? stage}（无 git 起始 commit 记录，走 re-run）`)
  }
  return {
    ok: true,
    already: false,
    rollbackId: id,
    seq,
    targetStatus,
    rollbackCommit,
    instructions,
    command: STAGES[stage]?.command ?? null,
    at: entry.at,
  }
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
  const failed = rec.status === 'failed' || rec.status === 'blocked' || rec.rolled_back === true
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

// =============================================================================
// OTel GenAI 语义约定导出（3.4 节；Langfuse/LangSmith 可消费）
// 手写 JSON 映射，零依赖（不引入 OTel SDK）。span 命名遵循 gen_ai 语义：
//   gen_ai.system      → turn/start    （阶段回合边界，span_id = `<seq>.turn<N>`）
//   gen_ai.message     → assistant/message（token 用量：gen_ai.usage.input_tokens /
//                        output_tokens / cache_read_input_tokens / cache_creation_input_tokens）
//   gen_ai.tool        → tool/call + tool/result 成对（call 带 gen_ai.tool.name +
//                        gen_ai.tool.input；result 带 gen_ai.tool.output + 状态）
// 公共属性：resource（service.name=yxspec-studio, gen_ai.trace.id）、trace_id=stage、
// span_id=seq（tool 追加 .callId 去重）、start_time/unix_nano 自 startedAt。
// rolled_back 轨迹在 resource 标注 `yxspec.trajectory.status=rolled_back` 供审计筛选。
// =============================================================================
const NANO = 1e6

/** 事件类型 → gen_ai span kind（OTel 语义约定）。 */
const GENAI_KIND = {
  'gen_ai.system': 'client',
  'gen_ai.message': 'client',
  'gen_ai.tool': 'client',
}

function truncatePayload(v, max = 2000) {
  if (v === undefined || v === null) return v
  let s = typeof v === 'string' ? v : JSON.stringify(v)
  if (s.length > max) s = s.slice(0, max) + '…'
  return s
}

/** 工具结果内容提取：tool/result 的 message.content[] 拼接（截断防爆）。 */
function toolResultText(t) {
  const blocks = Array.isArray(t?.message?.content) ? t.message.content : []
  const texts = []
  for (const b of blocks) {
    if (b && typeof b === 'object') {
      if (typeof b.text === 'string') texts.push(b.text)
      else if (b.type === 'tool-result' && b.content != null) texts.push(String(b.content))
    }
  }
  return truncatePayload(texts.join('\n'))
}

/**
 * OTel GenAI 导出（GET /api/trajectory/:stage/export）。
 * @returns {object|null} { resource, trace_id, stage, span_count, spans }；未知阶段/无轨迹 → null
 */
export function exportOtelGenAi(stage) {
  if (!isStageToken(stage)) return null
  const all = listTrajectories(stage)
  if (all.length === 0) return null

  const resource = {
    'service.name': 'yxspec-studio',
    'service.version': '0.1.0',
    'gen_ai.trace.id': stage,
    'gen_ai.trace.name': `${STAGES[stage]?.label ?? stage}（${stage}）`,
    'gen_ai.provider.name': 'deepseek-harness',
  }
  const latest = all[all.length - 1]
  if (all.some((r) => r.rolled_back)) {
    resource['yxspec.trajectory.status'] = 'rolled_back'
    if (latest.rollbackId) resource['yxspec.trajectory.rollback_id'] = latest.rollbackId
  }

  const spans = []
  for (const rec of all) {
    const t0 = rec.startedAt ?? 0
    const t1 = rec.finishedAt ?? Date.now()
    const seq = rec.seq ?? 0

    // turn/start：回合边界（阶段执行一次 = 一条 gen_ai.system span，含整体 token 汇总）
    const model = null // 轨迹聚合未记录模型名（request/header 事件未聚合），置 null
    spans.push({
      name: 'turn/start',
      kind: GENAI_KIND['gen_ai.system'],
      trace_id: stage,
      span_id: `${seq}.turn1`,
      parent_span_id: null,
      start_time_unix_nano: t0 * NANO,
      end_time_unix_nano: Math.max(t1, t0) * NANO,
      attributes: {
        'gen_ai.system': 'deepseek-harness',
        'gen_ai.trace.id': stage,
        'gen_ai.trace.name': resource['gen_ai.trace.name'],
        'yxspec.trajectory.status': rec.rolled_back ? 'rolled_back' : rec.status,
        'yxspec.trajectory.seq': seq,
        'yxspec.trajectory.rollback_id': rec.rollbackId ?? null,
        'gen_ai.usage.input_tokens': rec.cost?.inputTokens ?? 0,
        'gen_ai.usage.output_tokens': rec.cost?.outputTokens ?? 0,
        'gen_ai.usage.cache_read_input_tokens': rec.cost?.cacheReadTokens ?? 0,
        'gen_ai.usage.cache_creation_input_tokens': rec.cost?.cacheWriteTokens ?? 0,
        'gen_ai.usage.total_tokens': rec.cost?.tokens ?? 0,
      },
      model,
    })

    // assistant/message：模型输出 + 单消息 token 用量
    if (Array.isArray(rec.events) && rec.events.includes('assistant/message')) {
      spans.push({
        name: 'assistant/message',
        kind: GENAI_KIND['gen_ai.message'],
        trace_id: stage,
        span_id: `${seq}.msg`,
        parent_span_id: `${seq}.turn1`,
        start_time_unix_nano: t0 * NANO,
        end_time_unix_nano: Math.max(t1, t0) * NANO,
        attributes: {
          'gen_ai.trace.id': stage,
          'gen_ai.usage.input_tokens': rec.cost?.inputTokens ?? 0,
          'gen_ai.usage.output_tokens': rec.cost?.outputTokens ?? 0,
          'gen_ai.usage.cache_read_input_tokens': rec.cost?.cacheReadTokens ?? 0,
          'gen_ai.usage.cache_creation_input_tokens': rec.cost?.cacheWriteTokens ?? 0,
          'gen_ai.usage.total_tokens': rec.cost?.tokens ?? 0,
        },
        model,
      })
    }

    // tool/call + tool/result 成对（按顺序消费 tools 数组）
    const tools = Array.isArray(rec.tools) ? rec.tools : []
    let callIdx = 0
    const pendingCalls = []
    for (const t of tools) {
      if (t.type === 'tool/call') {
        pendingCalls.push(t)
      } else if (t.type === 'tool/result') {
        const call = pendingCalls.length > 0 ? pendingCalls.shift() : null
        const callName = call?.name ?? t.name ?? null
        const callId = call?.callId ?? null
        const n = ++callIdx
        const ts = t.ts ?? t0
        // call span：工具名 + 输入（arguments）
        spans.push({
          name: `tool/${callName ?? 'unknown'}`,
          kind: GENAI_KIND['gen_ai.tool'],
          trace_id: stage,
          span_id: `${seq}.tool${n}`,
          parent_span_id: `${seq}.turn1`,
          start_time_unix_nano: ts * NANO,
          end_time_unix_nano: (t.ts ?? t0) * NANO,
          attributes: {
            'gen_ai.trace.id': stage,
            'gen_ai.tool.name': callName,
            'gen_ai.tool.call_id': callId,
            'gen_ai.tool.input': truncatePayload(call?.arguments ?? null),
          },
          model,
        })
        // result span：结果 + 成败状态
        spans.push({
          name: `tool/${callName ?? 'unknown'}/result`,
          kind: GENAI_KIND['gen_ai.tool'],
          trace_id: stage,
          span_id: `${seq}.tool${n}.result`,
          parent_span_id: `${seq}.tool${n}`,
          start_time_unix_nano: ts * NANO,
          end_time_unix_nano: (t.ts ?? t0) * NANO,
          attributes: {
            'gen_ai.trace.id': stage,
            'gen_ai.tool.name': callName,
            'gen_ai.tool.call_id': callId,
            'gen_ai.tool.error': t.ok === false ? (t.error ?? 'tool_failed') : null,
            'yxspec.trajectory.ok': t.ok === true,
            'gen_ai.tool.output': toolResultText(t),
          },
          model,
        })
      }
    }
  }

  return { resource, trace_id: stage, stage, span_count: spans.length, spans }
}
