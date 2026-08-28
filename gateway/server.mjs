// YXSpec SQT 对话网关 — Windows 本地 harness 后端闭环（Track B）
// =============================================================================
// 编码加固（Windows + Start-Process 重定向日志时避免 GBK 乱码）
// 1) 强制 stdout/stderr 用 UTF-8 写文件（setDefaultEncoding 在 pipe 模式有效）
// 2) stdin 在重定向/无终端时可能没有 setDefaultEncoding 方法，需用 typeof 守卫，
//    否则 Start-Process + 重定向 stdin 会在这里抛 TypeError
// 注意：process.stdout.isTTY 为 false（重定向/pipe）时，Node 默认按 OS 代码页(GBK)
//      写字节，中文会被转成 GBK 字节；这里显式设成 utf-8。
// =============================================================================
if (process.stdout) process.stdout.setDefaultEncoding('utf-8')
if (process.stderr) process.stderr.setDefaultEncoding('utf-8')
if (process.stdin && typeof process.stdin.setDefaultEncoding === 'function') {
  process.stdin.setDefaultEncoding('utf-8')
}
// HTTP 接口：
//   POST /api/agent {prompt, session_id}   → 派活（门控拦截或注册后台任务；成功后立即返回 task_id）
//   GET  /api/tasks/:id                    → 查询后台任务状态（前端轮询长任务）
//   POST /api/agent/abort {session_id}     → 中断当前 turn（杀 runtime）
//   POST /api/chat {prompt}                → 快速对话（501 未实现，占位）
//   GET  /api/events?session_id=           → SSE 事件流
//   GET  /api/session?session_id=          → dsh_state.json 快照
//   GET  /api/gates                        → 门控扫描结果（调试用）
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { readState, updateState, snapshot, nextCurrent } from './lib/state.mjs'
import { resolveStage, scanGates, buildAgentPrompt, STAGES, STAGE_TOKENS, PROJECT_ROOT } from './lib/stages.mjs'
import { openSseStream, broadcastGoal, broadcastTodos, broadcastTurnEnd, broadcastToolCall, broadcastToolResult, broadcastStageUpdate, emitEvent, rememberSessionState, getSessionState } from './lib/bus.mjs'
import { runTurn, closeHarness, abortTurn, getCurrentSpec, isTurnBusy, TurnAbortedError, TurnTimeoutError } from './lib/harness.mjs'
import * as models from './lib/models.mjs'
import { listFeatures, setFeature, addCustomFeature, removeCustomFeature, listFeatureSkills, syncFeatureSkillInvocation, syncAllFeatureSkillInvocations } from './lib/features.mjs'
import { buildCostStats } from './lib/cost.mjs'
import { getCommunityPlugins } from './lib/community.mjs'
import { listInstalledPlugins } from './lib/installed.mjs'
import { listCapabilityCandidates } from './lib/candidates.mjs'
import { listPlugins, setPluginEnabled } from './lib/plugins.mjs'
import { trajectoryView, trajectoryAll, gateStage, gateSummary, rollbackTrajectory, exportOtelGenAi } from './lib/trajectory.mjs'
import { getStatus, getStageRecords, getFileDiff, recordRollback } from './lib/git.mjs'
import { selfIterationOverview } from './lib/self-iteration.mjs'
import { checkDispatchGate } from './lib/gate-enforce.mjs'

const PORT = Number(process.env.GATEWAY_PORT ?? 8787)

// ---------- JSON body ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj, null, 2))
}

function notFound(res) {
  json(res, 404, { error: 'not_found' })
}

/**
 * 生成周报 Markdown（GET /api/export?format=md）。
 * 已读 stages.mjs 确认：STAGES 无 group 字段 → 按 aspice 点号前部分分组（ACQ/SYS/HWE/SWE/SUP/SPL）。
 */
function buildWeeklyReportMd() {
  const state = snapshot()
  // 只统计活跃阶段：STAGES 共 27 条（含废弃 swe_detail + PC 变体 swe_coding_verify_pc），
  // 周报口径按"25 活跃阶段"算进度，废弃/变体节点不列明细、不进分母。
  const tokens = Object.keys(STAGES).filter((t) => !STAGES[t]?.deprecated && !STAGES[t]?.variant)
  const total = tokens.length
  const done = tokens.filter((t) => state.stages?.[t]?.state === 'done').length
  const pct = Math.round((done / total) * 100)
  const today = new Date().toISOString().slice(0, 10)

  const lines = []
  lines.push('# YXSpec 项目周报')
  lines.push(`- 项目代号：${state.project ?? '—'}`)
  lines.push(`- 生成日期：${today}`)
  lines.push(`- 整体进度：${done}/${total}（${pct}%）`)
  lines.push('')

  // 阶段明细：按 STAGES 顺序，按 aspice 前缀分组，组内保持流程顺序
  lines.push('## 阶段明细')
  const groups = new Map()
  for (const token of tokens) {
    const meta = STAGES[token]
    const aspice = meta?.aspice ?? '—'
    const groupKey = aspice.split('.')[0] || '其他'
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push({ token, aspice, stage: state.stages?.[token] })
  }
  for (const [group, rows] of groups) {
    lines.push(`### ${group}`)
    lines.push('| 阶段 | ASPICE | 状态 | 产物数 | 门控 |')
    lines.push('|------|--------|------|--------|------|')
    for (const { token, aspice, stage } of rows) {
      const stateVal = stage?.state ?? '—'
      const artifactCount = Array.isArray(stage?.artifacts) ? stage.artifacts.length : 0
      const gateMsg = stage?.gate?.message || '—'
      lines.push(`| ${token} | ${aspice} | ${stateVal} | ${artifactCount} | ${gateMsg.replace(/\|/g, '\\|')} |`)
    }
    lines.push('')
  }

  // 阻塞与待产物：gate.message 非空且未完成的阶段
  lines.push('## 阻塞与待产物')
  let blockers = 0
  for (const token of tokens) {
    const stage = state.stages?.[token]
    const msg = stage?.gate?.message
    if (!msg || stage?.state === 'done') continue
    lines.push(`- ${token}: ${msg}`)
    blockers++
  }
  if (blockers === 0) lines.push('- （无）')
  lines.push('')

  return lines.join('\n')
}

// ---------- 后台任务注册表（长任务轮询） ----------
// 设计原因：3-5 分钟的长 turn 若占着 HTTP 请求不放，客户端连接抖动/代理超时
// 会让 fetch 抛 "Failed to fetch"，结果还丢在网关里。改成任务制：
//   POST /api/agent → 注册任务后立即返回 {task_id, session_id}
//   前端轮询 GET /api/tasks/:id 直到 status=done|error|aborted
// 纯内存实现（网关重启即失效，前端 abort 处理残留即可）。
// 防泄漏：TTL 清理——终态任务 30 分钟后回收（定时器兜底 + 查询时惰性清理）。
const TASK_TTL_MS = 30 * 60 * 1000
let taskSeq = 0
const tasks = new Map() // task_id -> { status, sessionId, result, error, createdAt, lastAccess }
// 每 10 分钟扫一次过期终态任务（timer 不 hold 事件循环退出）
setInterval(() => sweepExpiredTasks(), 10 * 60 * 1000).unref?.()

function sweepExpiredTasks() {
  const now = Date.now()
  for (const [id, t] of tasks) {
    // 只清终态；running 任务永不清（可能正在被前端轮询）
    if (t.status !== 'running' && now - t.lastAccess > TASK_TTL_MS) {
      tasks.delete(id)
      console.log(`[gateway] 任务 TTL 回收: ${id}`)
    }
  }
}

function registerTask({ sessionId }) {
  const taskId = `task-${Date.now()}-${++taskSeq}`
  tasks.set(taskId, {
    status: 'running',
    sessionId: sessionId ?? null,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    lastAccess: Date.now(),
  })
  return taskId
}

function settleTask(taskId, { result = null, error = null } = {}) {
  const t = tasks.get(taskId)
  if (!t) return
  t.result = result
  t.error = error
  t.status = error ? 'error' : 'done'
  t.lastAccess = Date.now()
}

/** 后台跑一轮 turn（串行闸门保证一次一个），完成后 settle 任务。 */
async function runTaskInBackground({ taskId, session, token, agentPrompt, state, general, model, warning }) {
  try {
    const out = await runAndEmit({ session, token, agentPrompt, state, general, model })
    if (warning && out && typeof out === 'object') out.warning = warning // 门控警告（unverified 放行）透传终态
    settleTask(taskId, { result: out })
  } catch (err) {
    // runAndEmit 内部已广播 turn/end(error) 并置 blocked；这里记录任务终态
    console.error(`[gateway] 后台任务失败: task=${taskId}`, err?.message ?? err)
    settleTask(taskId, {
      error: {
        message: String(err?.message ?? err),
        finish_reason: 'error',
        session_id: session,
        stage: general ? null : token,
      },
    })
  }
}

// ---------- 派活核心 ----------
// 返回两种形态：
//   { task: { task_id, session_id } }       → 任务已注册，后台跑 turn，前端轮询 /api/tasks/:id
//   { result: {...} }                        → 无需后台跑（门控拦截），直接返回结果

/** 把前端传的 system 补充说明追加到 buildAgentPrompt 产物末尾；system 为 undefined/null/空串时原样返回。 */
function withSystem(agentPrompt, system) {
  if (!system || typeof system !== 'string') return agentPrompt
  const trimmed = system.trim()
  if (!trimmed) return agentPrompt
  return `${agentPrompt}\n\n[System 补充] ${trimmed}`
}

async function dispatchAgent({ prompt, sessionId, model, system }) {
  const session = sessionId || `bcm-${Date.now()}`
  // 识别目标阶段
  const hit = resolveStage(prompt)
  const state = readState()

  if (!hit) {
    // 没识别到阶段 → 通用咨询模式：读当前状态直接回答（不生成产物、不改状态）
    const current = state.current
    const stage = STAGES[current]
    const gates = scanGates(state)
    const agentPrompt = withSystem(buildAgentPrompt({
      userPrompt: prompt, token: current, stage, state, gates, force: false, general: true,
    }), system)
    // 咨询模式也写缓存，让 /api/session 能反映"正在咨询"（当前阶段不点亮）
    rememberSessionState(session, {
      goal: { name: current, state: 'in_progress', command: 'general', aspice: stage?.aspice ?? '' },
    })
    const taskId = registerTask({ sessionId: session })
    runTaskInBackground({ taskId, session, token: current, agentPrompt, state, general: true, model })
    return { task: { task_id: taskId, session_id: session } }
  }

  const { token, stage } = hit
  const gates = scanGates(state)
  const gate = gates[token]

  // ===== Phase 2 派活前门控（轨迹证据强制）=====
  // gate_policy==='artifact+trajectory' 的阶段：派活前检查轨迹证据。
  //   blocked / no-trajectory → 拒绝派活（不启动 turn），reason 供前端徽标联动
  //   unverified             → 默认放行但响应带 warning 字段（YXSPEC_GATE_ENFORCE=0 全关）
  const dg = checkDispatchGate(token)
  if (dg.blocked) {
    console.log(`[gateway] 门控打回: stage=${token} reason=${dg.reason}（YXSPEC_GATE_ENFORCE=${process.env.YXSPEC_GATE_ENFORCE ?? '(on)'}）`)
    broadcastGoal(session, token, 'blocked', stage.aspice)
    broadcastTurnEnd(session, { kind: 'blocked' })
    return {
      result: {
        final_response: `门控拦截：阶段 ${stage.label}（${token}）缺少轨迹证据（${dg.reason}）。请先完成并验证本阶段的执行记录，再重新派活。`,
        finish_reason: 'blocked',
        session_id: session,
        error: null,
        stage: token,
        gate,
        trajectory_gate: dg.gate,
        reason: dg.reason,
      },
    }
  }

  // 门控检查：上游未完成 → 拦截，不派给 agent
  const upstreamOk = Object.values(gate.upstream).every((v) => v === true)
  if (!upstreamOk) {
    broadcastGoal(session, token, 'blocked', stage.aspice)
    // 广播 turn/end(blocked)，让 SSE 订阅方（前端加载圈/等待态）得到终结信号
    broadcastTurnEnd(session, { kind: 'blocked' })
    const message = gate.message
    return {
      result: {
        final_response: `门控拦截：${message}。请先完成上游阶段（${Object.entries(gate.upstream).filter(([, v]) => !v).map(([k]) => k).join('、')}）再推进 ${stage.label}。`,
        finish_reason: 'blocked',
        session_id: session,
        error: null,
        stage: token,
        gate,
        reason: 'upstream-blocked',
      },
    }
  }

  // 放行：置 in_progress → 注册后台任务，turn 在闸门队列里跑
  updateState((s) => {
    if (s.stages[token]) {
      s.stages[token].state = 'in_progress'
      s.stages[token].lastUpdate = new Date().toISOString()
    }
    s.current = token
    return s
  }, { activeToken: token })
  broadcastGoal(session, token, 'in_progress', stage.aspice)
  // 主动写 session 快照缓存：不等 harness 的 goal/change 事件（该事件要等模型首响应），
  // 让 /api/session 在 turn 一开始就能返回当前 goal，页面刷新后驾驶舱立即恢复状态。
  rememberSessionState(session, {
    goal: { name: token, state: 'in_progress', command: stage.command, aspice: stage.aspice },
  })

  const agentPrompt = withSystem(buildAgentPrompt({
    userPrompt: prompt, token, stage, state, gates, force: false,
  }), system)
  const taskId = registerTask({ sessionId: session })
  runTaskInBackground({ taskId, session, token, agentPrompt, state, model, warning: dg.warning })
  return { task: { task_id: taskId, session_id: session }, warning: dg.warning }
}

/** 驱动 agent 跑一轮，转发事件到 SSE，完成后回写状态。
 *  并发安全：runTurn 内部有串行闸门，一轮只跑一个 turn；
 *  abort / closeHarness 杀 runtime 会让 runTurn 抛错——这里必须兜底，
 *  保证状态不再悬停在 in_progress（回滚到上一状态或置 blocked）。
 */
async function runAndEmit({ session, token, agentPrompt, state, general = false, model }) {
  const stage = STAGES[token]
  let result
  try {
    result = await runTurn({
      prompt: agentPrompt,
      sessionId: session,
      model,
      onEvent: (evt) => {
        if (evt.type === 'goal/change') {
          // 通用咨询模式：不广播 in_progress（避免把阶段点亮成进行中）
          if (!general) broadcastGoal(session, token, 'in_progress', stage.aspice)
          // 缓存 session 最新 goal（/api/session 快照用，前端页面刷新可恢复）
          rememberSessionState(session, { goal: evt.data ?? null })
        } else if (evt.type === 'todo/write') {
          broadcastTodos(session, evt.data?.todos ?? [])
          rememberSessionState(session, { todos: evt.data?.todos ?? [] })
        } else if (evt.type === 'tool/call' || evt.type === 'tool/result') {
          // 事件级流式：把 agent 的工具动作实时转发给 SSE 订阅方（前端渲染"正在做…"）
          if (evt.type === 'tool/call') broadcastToolCall(session, evt)
          else broadcastToolResult(session, evt)
        } else if (evt.type === 'turn/end') {
          broadcastTurnEnd(session, evt.data?.reason ?? { kind: 'completed' })
        }
      },
    })
  } catch (err) {
    // abort 杀 runtime → 状态回滚，避免 stage 悬停在 in_progress
    if (err instanceof TurnAbortedError) {
      console.warn(`[gateway] turn 被中止: session=${session} stage=${token}`)
      if (!general) {
        updateState((s) => {
          if (s.stages[token] && s.stages[token].state === 'in_progress') {
            s.stages[token].state = 'blocked'
            s.stages[token].lastUpdate = new Date().toISOString()
          }
          return s
        })
      }
      broadcastTurnEnd(session, { kind: 'aborted' })
      return {
        final_response: '执行已取消',
        finish_reason: 'aborted',
        session_id: session,
        error: String(err?.message ?? err),
        stage: general ? null : token,
        artifacts: [],
        gate: null,
        model: getCurrentSpec() ? `${getCurrentSpec().provider}/${getCurrentSpec().model}` : (model ?? null),
      }
    }
    if (err instanceof TurnTimeoutError) {
      // 超时熔断：阶段置 blocked（不是悬停 in_progress），返回明确失败让编排器可重试。
      console.error(`[gateway] turn 超时: session=${session} stage=${token} ${err?.message}`)
      if (!general) {
        updateState((s) => {
          if (s.stages[token] && s.stages[token].state === 'in_progress') {
            s.stages[token].state = 'blocked'
            s.stages[token].lastUpdate = new Date().toISOString()
          }
          return s
        })
      }
      broadcastTurnEnd(session, { kind: 'error' })
      if (!general) broadcastStageUpdate(session, { token, state: 'blocked', artifacts: [], gate: null, lastUpdate: new Date().toISOString() })
      return {
        final_response: '执行超时（超过 30 分钟），阶段已置 blocked，可重试',
        finish_reason: 'error',
        session_id: session,
        error: String(err?.message ?? err),
        stage: general ? null : token,
        artifacts: [],
        gate: null,
        model: getCurrentSpec() ? `${getCurrentSpec().provider}/${getCurrentSpec().model}` : (model ?? null),
      }
    }
    // 其它异常（runtime 崩溃/传输层错误）→ 置 blocked，不悬停
    console.error(`[gateway] runTurn 异常: session=${session} stage=${token}`, err)
    if (!general) {
      updateState((s) => {
        if (s.stages[token] && s.stages[token].state === 'in_progress') {
          s.stages[token].state = 'blocked'
          s.stages[token].lastUpdate = new Date().toISOString()
        }
        return s
      })
    }
    broadcastTurnEnd(session, { kind: 'error' })
    throw err
  }

  const finish = result.finishReason ?? 'completed'
  if (!general) {
    // 状态回写：completed → done；否则 blocked
    // 传 activeToken 让对账跳过当前阶段（它刚置 in_progress），由这里显式回写
    updateState((s) => {
      if (s.stages[token]) {
        s.stages[token].state = finish === 'completed' ? 'done' : 'blocked'
        s.stages[token].lastUpdate = new Date().toISOString()
      }
      return s
    }, { activeToken: token })
    // 阶段完成 → 推进 current 到下一个未完成阶段（驾驶舱显示正确入口）
    updateState((s) => {
      const next = nextCurrent(s)
      if (next) s.current = next
      return s
    })
  }
  // 产物扫描已由 updateState 重算
  const finalState = snapshot()

  // stage/update 广播：让前端卡片实时同步（完成→done、产物数、门控），无需等刷新/下一轮
  if (!general) {
    const st = finalState.stages?.[token]
    if (st) {
      broadcastStageUpdate(session, {
        token,
        state: st.state,
        artifacts: st.artifacts ?? [],
        gate: st.gate ?? null,
        lastUpdate: st.lastUpdate ?? null,
      })
    }
  }

  return {
    final_response: result.finalResponse,
    finish_reason: finish,
    session_id: session,
    error: null,
    stage: general ? null : token,
    artifacts: finalState.stages[token]?.artifacts ?? [],
    gate: finalState.stages[token]?.gate ?? null,
    model: getCurrentSpec() ? `${getCurrentSpec().provider}/${getCurrentSpec().model}` : (model ?? null),
  }
}

// ---------- HTTP server ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname

  // CORS：前端（localhost:1420）跨端口调用本网关（127.0.0.1:8787）必需
  // 注意：Allow-Methods 必须覆盖前端用到的全部方法——PUT（功能开关 setFeature）、
  // DELETE（自定义功能删除）也是非简单请求，浏览器会先发 OPTIONS 预检，
  // 白名单漏掉就抛 Failed to fetch。
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    if (req.method === 'POST' && path === '/api/agent') {
      const body = await readBody(req)
      const { prompt, session_id, model, system } = body
      if (!prompt || typeof prompt !== 'string') {
        return json(res, 400, { error: 'prompt required' })
      }
      // 诊断日志：记录请求与响应（写文件，独立进程无 stdout）
      const t0 = Date.now()
      console.log(`[gateway] /api/agent 收到: prompt="${String(prompt).slice(0, 80)}" session=${session_id ?? '(none)'} model=${model ?? '(default)'} system=${system ? `len=${String(system).length}` : '(none)'}`)
      const out = await dispatchAgent({ prompt, sessionId: session_id, model, system })
      // 后台任务：立即返回 task_id（HTTP 202），turn 在网关内部跑；前端轮询 /api/tasks/:id
      if (out.task) {
        console.log(`[gateway] /api/agent 已注册后台任务: ${out.task.task_id} (${Date.now() - t0}ms)`)
        return json(res, 202, {
          task_id: out.task.task_id,
          session_id: out.task.session_id,
          accepted: true,
          message: '已进入执行队列，轮询 /api/tasks/:id 获取结果',
          ...(out.warning ? { warning: out.warning } : {}),
        })
      }
      // 门控拦截等即时结果：直接返回
      const r = out.result
      if (out.warning && r && typeof r === 'object') r.warning = out.warning // 门控警告（unverified 放行）透传
      console.log(`[gateway] /api/agent 即时完成: ${Date.now() - t0}ms finish=${r.finish_reason} stage=${r.stage ?? '(general)'}`)
      return json(res, 200, r)
    }

    // 后台任务状态查询（长任务轮询）：GET /api/tasks/:id
    if (req.method === 'GET' && path.startsWith('/api/tasks/')) {
      const taskId = path.slice('/api/tasks/'.length)
      const t = tasks.get(taskId)
      if (!t) return json(res, 404, { error: 'task_not_found', task_id: taskId })
      // 查询即续期（惰性 TTL）：终态任务也因被读到而保留，避免前端还没拿到就回收
      t.lastAccess = Date.now()
      // running 态不返回 result/error（终态 result 可能很大，如 final_response 几千字），
      // 轮询期间只回轻量元信息，避免每个轮询周期都传大 payload。
      if (t.status === 'running') {
        return json(res, 200, {
          task_id: taskId,
          status: t.status,
          session_id: t.sessionId,
          created_at: t.createdAt,
        })
      }
      return json(res, 200, {
        task_id: taskId,
        status: t.status, // done | error | aborted
        session_id: t.sessionId,
        result: t.result,
        error: t.error,
        created_at: t.createdAt,
      })
    }

    // 快速对话：暂未实现。保留路由让前端感知（501 → 隐藏"快速对话"按钮）。
    if (req.method === 'POST' && path === '/api/chat') {
      return json(res, 501, {
        error: 'not_implemented',
        message: '快速对话模式未实现，请使用 Agent 模式',
      })
    }

    // ---------- 模型管理 ----------
    // GET  /api/models           → 模型 catalog + 默认 + 当前 harness spec
    // POST /api/models/default   → 设默认模型（懒生效：下次派活重建）
    // POST /api/models           → 新增模型
    // DELETE /api/models         → 删除模型（body { id }）
    // POST /api/models/apply     → 立即重建 harness（显式切换）
    if (req.method === 'GET' && path === '/api/models') {
      const cfg = models.listModels()
      return json(res, 200, {
        ok: true,
        defaultModelId: cfg.defaultModelId,
        models: cfg.models,
        current: getCurrentSpec(),
      })
    }

    if (req.method === 'POST' && path === '/api/models/default') {
      const body = await readBody(req)
      const { modelId } = body
      if (!modelId || typeof modelId !== 'string') {
        return json(res, 400, { error: 'modelId required' })
      }
      try {
        const cfg = models.setDefault(modelId)
        console.log(`[gateway] 设置默认模型: ${modelId}`)
        return json(res, 200, { ok: true, defaultModelId: cfg.defaultModel })
      } catch (e) {
        return json(res, 400, { error: String(e?.message ?? e) })
      }
    }

    if (req.method === 'POST' && path === '/api/models') {
      const body = await readBody(req)
      try {
        const cfg = models.addModel(body.entry)
        console.log(`[gateway] 新增模型: ${body.entry?.id ?? `${body.entry?.provider}/${body.entry?.model}`}`)
        return json(res, 200, { ok: true, defaultModelId: cfg.defaultModel, models: cfg.models })
      } catch (e) {
        return json(res, 400, { error: String(e?.message ?? e) })
      }
    }

    if (req.method === 'DELETE' && path === '/api/models') {
      const body = await readBody(req)
      const { id } = body
      if (!id || typeof id !== 'string') {
        return json(res, 400, { error: 'id required' })
      }
      try {
        const cfg = models.removeModel(id)
        console.log(`[gateway] 删除模型: ${id}`)
        return json(res, 200, { ok: true, defaultModelId: cfg.defaultModel, models: cfg.models })
      } catch (e) {
        return json(res, 400, { error: String(e?.message ?? e) })
      }
    }

    if (req.method === 'POST' && path === '/api/models/apply') {
      console.log('[gateway] 立即重建 harness（模型切换）')
      // 重建 = 拆掉旧 runtime：在跑/等待中的 turn 一并取消，避免在错误模型上继续跑
      abortTurn()
      await closeHarness()
      return json(res, 200, { ok: true, current: null })
    }

    // 中断：清队列（等待中的 turn 立即判取消）+ 杀当前 runtime，让在跑的 turn 立刻报错
    // （前端捕获显示"已取消"）。同时把该 session 相关的后台任务置终态（aborted）。
    if (req.method === 'POST' && path === '/api/agent/abort') {
      const body = await readBody(req)
      const { session_id } = body
      console.log(`[gateway] abort 请求: session_id=${session_id ?? '(none)'}`)
      abortTurn()
      await closeHarness()
      // 关联任务终态：在跑 turn 因 runtime 被杀会抛 TurnAbortedError，
      // runAndEmit 返回 finish_reason=aborted → 这里直接同步标记 running→done(aborted)
      if (session_id) {
        for (const [id, t] of tasks) {
          if (t.sessionId === session_id && t.status === 'running') {
            t.status = 'done'
            t.result = {
              final_response: '执行已取消',
              finish_reason: 'aborted',
              session_id,
              error: 'aborted by user',
              stage: null,
              artifacts: [],
              gate: null,
            }
            console.log(`[gateway] abort 已将任务 ${id} 置为 done(aborted)`)
          }
        }
      }
      return json(res, 200, { ok: true, session_id: session_id ?? null })
    }

    if (req.method === 'GET' && path === '/api/events') {
      // 有 session_id → 订阅该频道；无 → 订阅全部事件（openSseStream 内部处理），
      // 让前端无论谁派活（含编排脚本 verify-*）都能实时看到模型动作。
      const sessionId = url.searchParams.get('session_id') ?? undefined
      // SSE 挂起，不 await
      openSseStream(res, { sessionId })
      return
    }

    if (req.method === 'GET' && path === '/api/session') {
      const s = snapshot()
      // 合并当前 turn 的 goal/todos（若该 session 有缓存）：
      // 前端 connectEvents 先拉快照再订阅，页面刷新后能恢复当前阶段状态。
      const sid = url.searchParams.get('session_id') ?? s.current
      if (sid) {
        const cached = getSessionState(sid)
        if (cached.goal) s.goal = cached.goal
        if (cached.todos?.length) s.todos = cached.todos
      }
      return json(res, 200, s)
    }

    // 周报导出：GET /api/export?format=md → {ok, format, content, filename}
    if (req.method === 'GET' && path === '/api/export') {
      const format = url.searchParams.get('format') ?? 'md'
      if (format !== 'md') {
        return json(res, 400, { ok: false, error: `unsupported format: ${format}` })
      }
      const content = buildWeeklyReportMd()
      const date = new Date().toISOString().slice(0, 10)
      return json(res, 200, {
        ok: true,
        format,
        content,
        filename: `yxspec-周报-${date}.md`,
      })
    }

    if (req.method === 'GET' && path === '/api/gates') {
      const gates = scanGates(readState())
      return json(res, 200, gates)
    }

    // 阶段执行轨迹（@yxspec/aspice-trajectory 插件聚合，只读）：
    //   GET /api/trajectory?stage=<token>&limit=50   → 轨迹视图（瀑布行 + 门控三态）
    //   GET /api/trajectory-gate?stage=<token>        → 门控判定（artifact / artifact+trajectory）
    //   不带 stage → 全阶段汇总（驾驶舱批量徽标数据源）
    if (req.method === 'GET' && path === '/api/trajectory') {
      const stage = url.searchParams.get('stage') ?? ''
      const limit = Number(url.searchParams.get('limit') ?? 50)
      const view = trajectoryView(stage, limit)
      if (!view || !view.stage) return json(res, 400, { error: 'unknown-stage', stage })
      return json(res, 200, view)
    }

    // 全阶段轨迹聚合（总轨迹时间轴数据源）：GET /api/trajectory-all?limit=N
    // trajectoryAll 内合并"该时刻最新 commit/tag"（轨迹 × git 增强），故为 async
    if (req.method === 'GET' && path === '/api/trajectory-all') {
      const limit = Number(url.searchParams.get('limit') ?? 200)
      return json(res, 200, await trajectoryAll(limit))
    }

    if (req.method === 'GET' && path === '/api/trajectory-gate') {
      const stage = url.searchParams.get('stage')
      if (stage) {
        const g = gateStage(stage)
        if (!g || g.reason === 'unknown-stage') return json(res, 400, { error: 'unknown-stage', stage })
        return json(res, 200, g)
      }
      return json(res, 200, { ok: true, gates: gateSummary() })
    }

    // OTel GenAI 语义导出（3.4 节）：GET /api/trajectory/:stage/export
    // → JSON spans（gen_ai.* 属性，Langfuse/LangSmith 可消费；手写映射零依赖）
    if (req.method === 'GET' && path.startsWith('/api/trajectory/') && path.endsWith('/export')) {
      const stage = decodeURIComponent(path.slice('/api/trajectory/'.length, -'/export'.length))
      const out = exportOtelGenAi(stage)
      if (!out) return json(res, 404, { error: out === null ? 'no-trajectory' : 'unknown-stage', stage })
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out, null, 2))
      return
    }

    // 回滚协议（3.3 节）：POST /api/trajectory/:stage/rollback { rollbackId?, reason? }
    // → 把该阶段最新轨迹标记 rolled_back（JSONL 尾部追加 rollback 审计行，append-only），
    //   返回回滚指令（含 git 操作提示，对齐 guard.sh reset --hard 块起始语义）。
    //   本端点只"发指令留档"，绝不执行 git reset（插件不越权）。
    if (req.method === 'POST' && path.startsWith('/api/trajectory/') && path.endsWith('/rollback')) {
      const stage = decodeURIComponent(path.slice('/api/trajectory/'.length, -'/rollback'.length))
      let body = {}
      try {
        const raw = await readBody(req)
        body = raw && typeof raw === 'object' ? raw : {}
      } catch {
        body = {}
      }
      const r = rollbackTrajectory(stage, typeof body.rollbackId === 'string' ? body.rollbackId : null, typeof body.reason === 'string' ? body.reason : null)
      if (!r.ok) {
        const code = r.error === 'unknown-stage' ? 400 : r.error === 'write-failed' ? 500 : 409
        return json(res, code, r)
      }
      console.log(`[gateway] 轨迹回滚: stage=${stage} rollbackId=${r.rollbackId} seq=${r.seq}${r.already ? '（幂等命中）' : ''}`)
      return json(res, 200, r)
    }

    // ---------- git 工作区状态 API（lib/git.mjs，只读 git + 追加审计 JSONL） ----------
    // 红线：网关只"只读执行 git + 追加审计 JSONL"，绝不执行 git reset / git push。
    // git 不可用（不是仓库/未装 git）时三个端点都优雅降级：仍返回 200，
    // 带 gitAvailable:false + error 字段，前端按 gitAvailable 渲染降级态。
    //   GET /api/git/status               → 工作区状态（分支/HEAD/脏文件/领先落后/最近提交）
    //   GET /api/git/commits?stage=<token> → 阶段 ↔ commit ↔ tag 对照表（轨迹 × git log）
    //   GET /api/git/diff?path=&staged=    → 单个脏文件 diff 预览（hover 用，只读）
    //   POST /api/git/rollback {stage,seq,commit,reason} → 回滚审计留档（只追加 JSONL，不执行 git）
    if (req.method === 'GET' && path === '/api/git/status') {
      return json(res, 200, await getStatus())
    }

    if (req.method === 'GET' && path === '/api/git/commits') {
      const stage = url.searchParams.get('stage') ?? ''
      if (!stage) return json(res, 400, { ok: false, error: 'stage required' })
      return json(res, 200, await getStageRecords(stage))
    }

    // 单个脏文件 diff 预览（hover 用）：GET /api/git/diff?path=<repo-relative>&staged=1
    // 留痕 diff 预览（阶段留痕行 hover）：同端点 + from/to commit 范围参数（range 模式，只读 git diff）
    // 只读 git diff；untracked 无基线 → status:'untracked'（前端提示无 diff 可预览）
    // path 校验只在「脏文件模式」下必须：commit 范围模式（from 是合法 hex）由
    // getFileDiff 自己判 range，不读 path（留痕 diff 预览 = pathless range 请求），
    // 不能在这层一刀切 400——否则 range 模式永远到不了 getFileDiff，预览恒失败。
    if (req.method === 'GET' && path === '/api/git/diff') {
      const p = url.searchParams.get('path') ?? ''
      const staged = url.searchParams.get('staged') === '1' || url.searchParams.get('staged') === 'true'
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      const rangeMode = typeof from === 'string' && from.trim() !== '' && /^[0-9a-fA-F]{4,40}$/.test(from)
      if (!p && !rangeMode) return json(res, 400, { ok: false, error: 'path required' })
      return json(res, 200, await getFileDiff({ path: p, staged, from, to }))
    }

    if (req.method === 'POST' && path === '/api/git/rollback') {
      let body = {}
      try {
        const raw = await readBody(req)
        body = raw && typeof raw === 'object' ? raw : {}
      } catch {
        body = {}
      }
      const r = await recordRollback({
        stage: typeof body.stage === 'string' ? body.stage : undefined,
        seq: typeof body.seq === 'number' ? body.seq : Number(body.seq),
        commit: typeof body.commit === 'string' ? body.commit : undefined,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      })
      if (!r.ok) {
        const code = r.error === 'unknown-stage' ? 400 : r.error === 'bad-request' ? 400 : r.error === 'write-failed' ? 500 : 409
        return json(res, code, r)
      }
      console.log(`[gateway] /api/git/rollback: stage=${r.stage} seq=${r.seq}${r.already ? '（幂等命中）' : ''}`)
      return json(res, 200, r)
    }

    // 执行成本统计：GET /api/cost
    // 聚合审计账本（.dsh/gateway-log）按阶段统计负载（耗时/次数/工具调用）。
    // token usage 由 harness 审计层从 SDK 事件流补记（assistant/message 的 data.usage）；
    // 改前执行的老账本无 usage 记录 → token 计 0，hasTokenData=false。
    // 单价可经 YXSPEC_COST_INPUT_PRICE / YXSPEC_COST_OUTPUT_PRICE 配置（每百万 token）。
    if (req.method === 'GET' && path === '/api/cost') {
      const cost = buildCostStats()
      return json(res, 200, cost)
    }

    // 自迭代打分结果：GET /api/self-iteration
    // 读 @yxspec/self-iteration 插件落盘的 run-state.json + self_iteration/*.jsonl
    // （runtime-data，纯只读）。从未跑过自迭代 / 网关未起 → 空数据（state:null,
    // stages:[]），前端据此渲染「尚未执行自迭代」空态，不阻塞驾驶舱。
    if (req.method === 'GET' && path === '/api/self-iteration') {
      return json(res, 200, selfIterationOverview())
    }

    // 断点续跑：GET /api/resume
    // 网关重启/电脑休眠后，前端据此恢复断点。只读，不改任何状态。
    // 返回 dsh_state 当前断点 + 第一个未完成阶段 + 建议继续执行的命令。
    // resumable=false 表示全部阶段已完成（或状态文件为空/结构异常）。
    if (req.method === 'GET' && path === '/api/resume') {
      const state = readState()
      const isDone = (tok) => {
        const s = state.stages?.[tok]
        return s?.state === 'done' || s?.state === 'skipped'
      }
      const activeTokens = STAGE_TOKENS.filter((t) => !STAGES[t]?.deprecated && !STAGES[t]?.variant)
      // current 语义：优先 dsh_state.current；为空/已完成 → 第一个非 done/skipped 的活跃阶段
      let current = state.current
      if (!current || !STAGE_TOKENS.includes(current) || isDone(current)) {
        current = activeTokens.find((t) => !isDone(t)) ?? current
      }
      if (!current) {
        return json(res, 200, {
          projectPath: PROJECT_ROOT,
          current: null,
          currentIndex: -1,
          pendingCount: 0,
          blockedStages: [],
          suggestedNext: null,
          resumable: false,
        })
      }
      const currentIndex = STAGE_TOKENS.indexOf(current)
      const pendingCount = activeTokens.filter((t) => !isDone(t)).length
      const gates = scanGates(state)
      const blockedStages = activeTokens.filter((t) => gates[t]?.blocked === true)
      const meta = STAGES[current]
      return json(res, 200, {
        projectPath: PROJECT_ROOT,
        current,
        currentIndex,
        pendingCount,
        blockedStages,
        suggestedNext: meta
          ? {
              token: current,
              command: meta.command,
              command_name: (meta.command || '').replace(/^\/yxspec:/, ''),
              aspice: meta.aspice ?? '',
              label: meta.label ?? '',
            }
          : null,
        resumable: true,
      })
    }

    // ---------- 功能商店 ----------
    // GET   /api/features              → 全部 feature 元数据 + 启用状态 + 规则可加载性
    // PUT   /api/features/{id}         → 设置开关（body { enabled: true|false }）
    // POST  /api/features/custom       → 新增自定义功能（body 传自定义字段，校验失败 400）
    // DELETE /api/features/custom/{id} → 删除自定义功能
    if (req.method === 'GET' && path === '/api/features') {
      return json(res, 200, { ok: true, features: listFeatures() })
    }

    if (req.method === 'POST' && path === '/api/features/custom') {
      const body = await readBody(req)
      try {
        const f = await addCustomFeature(body)
        console.log(`[gateway] 新增自定义功能: ${f.id}`)
        return json(res, 200, { ok: true, feature: f })
      } catch (e) {
        return json(res, 400, { error: String(e?.message ?? e) })
      }
    }

    if (req.method === 'DELETE' && path.startsWith('/api/features/custom/')) {
      const id = path.slice('/api/features/custom/'.length)
      try {
        await removeCustomFeature(id)
        console.log(`[gateway] 删除自定义功能: ${id}`)
        return json(res, 200, { ok: true, id })
      } catch (e) {
        return json(res, 400, { error: String(e?.message ?? e) })
      }
    }

    if (req.method === 'PUT' && path.startsWith('/api/features/')) {
      const id = path.slice('/api/features/'.length)
      const body = await readBody(req)
      try {
        const val = setFeature(id, body.enabled === true)
        // A+A：开关状态同步进 SKILL.md frontmatter（disable-model-invocation）
        syncFeatureSkillInvocation(id)
        console.log(`[gateway] 功能开关: ${id} -> ${val}（已同步 skill invocation）`)
        return json(res, 200, { ok: true, id, enabled: val })
      } catch (e) {
        return json(res, 400, { error: String(e?.message ?? e) })
      }
    }

    // A+A：harness 原生 dsh skills 只读清单（前端「dsh skills」区块展示）
    if (req.method === 'GET' && path === '/api/features/skills') {
      return json(res, 200, { ok: true, skills: listFeatureSkills() })
    }

    // 社区插件市场：GET /api/community-plugins
    // 浏览/筛选社区 dsh 插件（GitHub topic:dsh-plugin），只读不安装。
    // 网关侧缓存 6h；GitHub 挂/限流时降级旧缓存(stale)或内置静态精选(static)。
    if (req.method === 'GET' && path === '/api/community-plugins') {
      const data = await getCommunityPlugins()
      return json(res, 200, { ok: true, ...data })
    }

    // 插件统一列表：GET /api/plugins
    // Everything-is-a-Plugin：已装配插件（plugin）+ 候选能力（candidate）+ 基座（base）
    // 统一成可开关的插件条目。真相源 = lib/plugins.mjs（cordis.yml + candidates 注册表）。
    if (req.method === 'GET' && path === '/api/plugins') {
      const plugins = listPlugins()
      return json(res, 200, { ok: true, count: plugins.length, plugins })
    }

    // 插件开关：PUT /api/plugins/:id {enabled: true|false}
    // 生效方式 = 开关即重建：写 plugins.yaml → closeHarness() 重建 runtime（~2-5s）。
    // 安全检查：有 active turn 时拒绝（重建会杀 runtime 导致 in-flight turn 失败）。
    if (req.method === 'PUT' && path.startsWith('/api/plugins/')) {
      const id = decodeURIComponent(path.slice('/api/plugins/'.length))
      let body = {}
      try {
        const raw = await readBody(req)
        body = raw && typeof raw === 'object' ? raw : JSON.parse(raw || '{}')
      } catch { /* 空 body → 默认 {} */ }
      if (typeof body.enabled !== 'boolean') {
        return json(res, 400, { error: 'bad-request', message: 'enabled 必须为 boolean' })
      }
      if (isTurnBusy()) {
        return json(res, 409, { error: 'busy', message: '有 turn 在执行中，请等待完成后再开关插件' })
      }
      try {
        const r = await setPluginEnabled(id, body.enabled)
        // 重建：先关旧 runtime，下次 turn 时 getHarness 用新合成装配重建
        await closeHarness()
        return json(res, 200, { ok: true, ...r, message: `插件 ${id} 已${body.enabled ? '启用' : '关闭'}，runtime 已重建` })
      } catch (e) {
        return json(res, 400, { error: 'plugin', message: String(e?.message ?? e) })
      }
    }

    // 已验证待接入能力：GET /api/capability-candidates
    // 静态注册表（lib/candidates.mjs）——subagent/session-query/ralph/schedule/
    // feedback/commands/invariants 已 POC 验证但尚未进主 cordis.yml。
    // 前端「插件中心」据此展示候选，避免"功能做了但页面看不出来"。
    if (req.method === 'GET' && path === '/api/capability-candidates') {
      const wired = new URL(req.url, 'http://x').searchParams.get('wired') || 'all'
      const list = listCapabilityCandidates({ wired })
      return json(res, 200, { ok: true, count: list.length, candidates: list })
    }

    // 已安装插件：GET /api/installed-plugins
    // 真相源 = runtime 装配表 cordis.yml 解析；返回已接入 runtime 的非内置插件
    // （graph-memory / weknora 等），带版本号（读 node_modules package.json）。
    // 前端「功能开关」tab 顶部展示：已装了什么一目了然。
    if (req.method === 'GET' && path === '/api/installed-plugins') {
      const plugins = listInstalledPlugins()
      return json(res, 200, { ok: true, count: plugins.length, plugins })
    }

    if (req.method === 'GET' && path === '/health') {
      return json(res, 200, { ok: true, ts: new Date().toISOString() })
    }

    return notFound(res)
  } catch (err) {
    console.error('[gateway] error:', err)
    if (!res.headersSent) json(res, 500, { error: 'internal', message: String(err?.message ?? err) })
    else res.end()
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[gateway] YXSpec SQT 网关已启动 http://0.0.0.0:${PORT}`)
  console.log(`[gateway] SSE:  /api/events?session_id=<id>`)
  console.log(`[gateway] 派活:  POST /api/agent`)
  // A+A：启动时把 features.yaml 开关状态同步进 .dsh/skills/<id>/SKILL.md frontmatter
  try {
    const n = syncAllFeatureSkillInvocations()
    console.log(`[gateway] A+A: 已同步 ${n} 个 feature skill invocation（.dsh/skills）`)
  } catch (e) {
    console.warn(`[gateway] A+A: skill invocation 同步失败: ${e?.message ?? e}`)
  }
})

async function shutdown() {
  console.log('[gateway] 关闭中...')
  await closeHarness()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
