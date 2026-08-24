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
//   POST /api/agent {prompt, session_id}   → 派活（门控拦截或真实推进）
//   POST /api/agent/abort {session_id}     → 中断当前 turn（杀 runtime）
//   POST /api/chat {prompt}                → 快速对话（501 未实现，占位）
//   GET  /api/events?session_id=           → SSE 事件流
//   GET  /api/session?session_id=          → dsh_state.json 快照
//   GET  /api/gates                        → 门控扫描结果（调试用）
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { readState, updateState, snapshot, nextCurrent } from './lib/state.mjs'
import { resolveStage, scanGates, buildAgentPrompt, STAGES } from './lib/stages.mjs'
import { openSseStream, broadcastGoal, broadcastTodos, broadcastTurnEnd, emitEvent } from './lib/bus.mjs'
import { runTurn, closeHarness, abortTurn, getCurrentSpec, TurnAbortedError } from './lib/harness.mjs'
import * as models from './lib/models.mjs'

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

// ---------- 派活核心 ----------
async function dispatchAgent({ prompt, sessionId, model }) {
  const session = sessionId || `bcm-${Date.now()}`
  // 识别目标阶段
  const hit = resolveStage(prompt)
  const state = readState()

  if (!hit) {
    // 没识别到阶段 → 通用咨询模式：读当前状态直接回答（不生成产物、不改状态）
    const current = state.current
    const stage = STAGES[current]
    const gates = scanGates(state)
    const agentPrompt = buildAgentPrompt({
      userPrompt: prompt, token: current, stage, state, gates, force: false, general: true,
    })
    return runAndEmit({ session, token: current, agentPrompt, state, general: true, model })
  }

  const { token, stage } = hit
  const gates = scanGates(state)
  const gate = gates[token]

  // 门控检查：上游未完成 → 拦截，不派给 agent
  const upstreamOk = Object.values(gate.upstream).every((v) => v === true)
  if (!upstreamOk) {
    broadcastGoal(session, token, 'blocked', stage.aspice)
    // 广播 turn/end(blocked)，让 SSE 订阅方（前端加载圈/等待态）得到终结信号
    broadcastTurnEnd(session, { kind: 'blocked' })
    const message = gate.message
    return {
      final_response: `门控拦截：${message}。请先完成上游阶段（${Object.entries(gate.upstream).filter(([, v]) => !v).map(([k]) => k).join('、')}）再推进 ${stage.label}。`,
      finish_reason: 'blocked',
      session_id: session,
      error: null,
      stage: token,
      gate,
    }
  }

  // 放行：置 in_progress → 驱动 agent
  updateState((s) => {
    if (s.stages[token]) {
      s.stages[token].state = 'in_progress'
      s.stages[token].lastUpdate = new Date().toISOString()
    }
    s.current = token
    return s
  })
  broadcastGoal(session, token, 'in_progress', stage.aspice)

  const agentPrompt = buildAgentPrompt({
    userPrompt: prompt, token, stage, state, gates, force: false,
  })
  return runAndEmit({ session, token, agentPrompt, state, model })
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
        } else if (evt.type === 'todo/write') {
          broadcastTodos(session, evt.data?.todos ?? [])
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
    updateState((s) => {
      if (s.stages[token]) {
        s.stages[token].state = finish === 'completed' ? 'done' : 'blocked'
        s.stages[token].lastUpdate = new Date().toISOString()
      }
      return s
    })
    // 阶段完成 → 推进 current 到下一个未完成阶段（驾驶舱显示正确入口）
    updateState((s) => {
      const next = nextCurrent(s)
      if (next) s.current = next
      return s
    })
  }
  // 产物扫描已由 updateState 重算
  const finalState = snapshot()

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
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    if (req.method === 'POST' && path === '/api/agent') {
      const body = await readBody(req)
      const { prompt, session_id, model } = body
      if (!prompt || typeof prompt !== 'string') {
        return json(res, 400, { error: 'prompt required' })
      }
      // 诊断日志：记录请求与响应（写文件，独立进程无 stdout）
      const t0 = Date.now()
      console.log(`[gateway] /api/agent 收到: prompt="${String(prompt).slice(0, 80)}" session=${session_id ?? '(none)'} model=${model ?? '(default)'}`)
      const out = await dispatchAgent({ prompt, sessionId: session_id, model })
      console.log(`[gateway] /api/agent 完成: ${Date.now() - t0}ms finish=${out.finish_reason} resp_len=${(out.final_response || '').length} stage=${out.stage ?? '(general)'} model=${out.model ?? '(default)'}`)
      return json(res, 200, out)
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
    // （前端捕获显示"已取消"）。
    if (req.method === 'POST' && path === '/api/agent/abort') {
      const body = await readBody(req)
      const { session_id } = body
      console.log(`[gateway] abort 请求: session_id=${session_id ?? '(none)'}`)
      abortTurn()
      await closeHarness()
      return json(res, 200, { ok: true, session_id: session_id ?? null })
    }

    if (req.method === 'GET' && path === '/api/events') {
      const sessionId = url.searchParams.get('session_id') ?? 'bcm'
      // SSE 挂起，不 await
      openSseStream(res, { sessionId })
      return
    }

    if (req.method === 'GET' && path === '/api/session') {
      const s = snapshot()
      return json(res, 200, s)
    }

    if (req.method === 'GET' && path === '/api/gates') {
      const gates = scanGates(readState())
      return json(res, 200, gates)
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[gateway] YXSpec SQT 网关已启动 http://127.0.0.1:${PORT}`)
  console.log(`[gateway] SSE:  /api/events?session_id=<id>`)
  console.log(`[gateway] 派活:  POST /api/agent`)
})

async function shutdown() {
  console.log('[gateway] 关闭中...')
  await closeHarness()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
