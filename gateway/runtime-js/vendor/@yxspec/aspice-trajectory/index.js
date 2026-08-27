// =============================================================================
// @yxspec/aspice-trajectory — 阶段执行轨迹聚合 + 门控证据（Phase 1）
// =============================================================================
// 架构结论（POC 实测 2026-08-27，真实 runtime 探针验证）：
//   1. 根 ctx 的 ctx.on('session/event') 能收到全部事件 —— 前提是插件声明
//      `inject: ['sessions']`。yxspec-commands 头注释（2026-08-25 实测"收不到"）
//      的场景已不复现：当前 harness（llm-pi-ai 适配器时代）root ctx 直接订阅
//      即达，无需 session 专属 ctx 作用域，也不用 { global: true }（两种都收到，
//      且未声明 inject 时 apply() 直接抛 "cannot get property sessions without
//      inject"）。分发路径：SessionStore.append → collectSessionCallbacks(entry
//      .emitCtx=store.ctx, [scopeCarrier, 'session/event', session, event]) →
//      scopeCarrier 的 filter 放行无 kScope 标签的根插件 ctx。
//   2. 事件形状（POC 实测最小提问 + create_goal/todo_write/fs 工具 turn）：
//      - agent/inbox/spliced { target:'next-turn', inserted:[{content:[{type:
//        'text', text:'<prompt>'}], source:{kind:'user'}, role:'user'}] }  ← 阶段边界判定源
//      - turn/start  { turn: 1 }
//      - step/start  { turn, step } / step/end { turn, step }
//      - user/message{ content: [...] }（含 runtime context / skills 系统注入）
//      - session/title { title, messageSeqs }（噪声，聚合忽略）
//      - request/header { header: { config: { provider, model, maxTokens } } }
//      - request/context { provider, model, contextWindow }
//      - assistant/chunk { turn, step, chunk }（噪声）
//      - assistant/message { turn, step, message, usage:{ inputTokens,
//        outputTokens, cacheReadTokens, cacheWriteTokens } }  ← token 用量源
//      - tool/call    { turn, step, callId, name, arguments }（arguments 可能
//        是 JSON 字符串）
//      - tool/result  { turn, step, message: { source:{callId}, content:[{
//        type:'tool-result', toolCallId, content, isError }] }, meta? }
//        —— ok 判定：content[].isError !== true 且无 data.error；
//        工具 runtime deny 时 data.error = { message: denialReason }
//      - goal/change  { kind:'goal/change', operation:'create'|'update'|'clear',
//        goal:{ id, revision, objective, phase } }（无 name/state 字段！）
//      - todo/write   { todos: [{ content, status }] }
//      - turn/end     { turn, reason: { kind:'completed'|'max-tokens'|'error'|
//        'aborted'|'blocked', ... } }  ← 轨迹状态源
//      还有 llm/retry、llm/retry-started（模型端重试，不代表阶段失败，忽略）。
//   3. 同一 runtime 会承载多个 session（firehose 全量广播），轨迹按 sessionId
//      隔离缓冲，阶段边界以 agent/inbox/spliced 注入的 prompt 命中阶段命令为准。
//
// 本插件职责（薄胶水，官方层只读消费）：
//   - 订阅 session/event，从 agent/inbox/spliced 提取注入 prompt，命中阶段命令
//     （复用网关 stages.mjs 权威表）即开新轨迹记录 —— 阶段边界切分；
//   - 聚合 turn/tool/assistant 事件为 append-only JSONL：
//       gateway/runtime-data/trajectory/<stage>/<stage>-<seq>.jsonl
//     （运行时数据 .gitignore 排除；每条 = 一次阶段执行，seq 单调递增）
//   - 网关侧 lib/trajectory.mjs 提供读取/门控判定（gateStage 三态）。
//
// 红线：不动 harness 主仓源码；不读 baselines/_monitor；轨迹 JSONL 不入库。
// =============================================================================
// 坑 5（2026-08-27 实测）：ctx.effect 的清理函数必须作为返回值返回，写在回调
//   体内会在激活瞬间（mount 后 ~2ms）立刻 unsubscribe，轨迹从此收不到事件。
//   正确形态见文件底部 effect 块（body=激活日志，return=dispose 清理）。
// =============================================================================

import { mkdirSync, appendFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ----------------------------------------------------------------------------
// 轨迹落盘根：gateway/runtime-data/trajectory/（gitignore 掉运行时数据）
// 可经环境变量 YXSPEC_TRAJECTORY_ROOT 覆盖（副本网关 8789 冒烟用，互不串写）。
// ----------------------------------------------------------------------------
const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'runtime-data', 'trajectory')

export const name = 'aspice-trajectory'
export const inject = ['sessions']

/** 关键事件类型（其余忽略）：与 lib/trajectory.mjs 的轨迹 schema 对齐。 */
const TRACKED = new Set([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'assistant/message',
  'tool/call',
  'tool/result',
  'goal/change',
  'todo/write',
])

// 阶段命令 → token 权威表（复用网关 stages.mjs；harness 外运行/加载失败 → 空表，
// 此时不切轨迹，插件只做事件缓冲兜底，不抛错）。
let CMD_TOKENS = null
try {
  const mod = await import('../../../../lib/stages.mjs')
  const map = new Map()
  for (const [token, st] of Object.entries(mod?.STAGES ?? {})) {
    if (st?.command) map.set(st.command, token)
  }
  if (map.size > 0) CMD_TOKENS = map
} catch {
  CMD_TOKENS = null
}

/** 边界感知匹配（与 stages.mjs resolveStage 同规则：命令后必须跟 空白/标点/结尾）。 */
function stageOfPrompt(prompt) {
  if (!CMD_TOKENS) return null
  const text = String(prompt ?? '')
  for (const [cmd, token] of CMD_TOKENS) {
    const esc = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?:^|[^\\w-])${esc}(?:$|[\\s.,;:!?，。；：！？、)）]|(?:[^\\w-]))`)
    if (re.test(text)) return token
  }
  return null
}

/** 从 agent/inbox/spliced 提取注入的文本（user 角色 content 拼接）。 */
function promptFromInbox(data) {
  const inserted = Array.isArray(data?.inserted) ? data.inserted : []
  const parts = []
  for (const ins of inserted) {
    if (!ins || typeof ins !== 'object') continue
    if (ins.source?.kind === 'system' && !ins.role) continue // 系统注入跳过（非用户 prompt）
    for (const block of ins.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/** 某阶段现有最大 seq + 1（scan 目录，无则 1）。 */
function nextSeqFor(root, stage) {
  try {
    const dir = join(root, stage)
    let max = 0
    for (const it of readdirSync(dir)) {
      const m = it.match(new RegExp(`^${stage}-(\\d+)\\.jsonl$`))
      if (m) max = Math.max(max, Number(m[1]))
    }
    return max + 1
  } catch {
    return 1
  }
}

/** 轨迹记录 → JSONL 行（schema 与 lib/trajectory.mjs 对齐）。
 *  reason → status 映射（2026-08-27 实跑修正）：
 *    error/max-tokens → failed（模型/流程失败，产物可能残缺）
 *    aborted/interrupted/blocked/stage-switch → blocked（未按预期完成，打回）
 *    completed → passed
 *    null（尚未 turn/end）→ unverified */
function toRecord(rec) {
  const status =
    rec.reason === 'error' || rec.reason === 'max-tokens' ? 'failed'
      : rec.reason === 'aborted' || rec.reason === 'interrupted' || rec.reason === 'blocked' || rec.reason === 'stage-switch' ? 'blocked'
        : rec.reason === 'completed' ? 'passed'
          : 'unverified'
  return {
    stage: rec.stage,
    seq: rec.seq,
    sessionId: rec.sessionId,
    status,
    startedAt: rec.startedAt,
    finishedAt: rec.finishedAt,
    turnCount: rec.turnCount,
    stepCount: rec.stepCount,
    events: [...rec.eventTypes],
    tools: rec.tools,
    cost: {
      tokens: rec.tokens.input + rec.tokens.output,
      inputTokens: rec.tokens.input,
      outputTokens: rec.tokens.output,
      cacheReadTokens: rec.tokens.cacheRead,
      cacheWriteTokens: rec.tokens.cacheWrite,
    },
    reason: rec.reason ?? null,
  }
}

/** tool/result 是否成功：content[] 的 tool-result 块 isError 非真 且 无 data.error。
 *  POC 实测：工具 runtime 成功 → content:[{type:'tool-result', isError:false}]；
 *  deny/失败 → data.error = { message } 或 content[].isError === true。 */
function toolResultOk(data) {
  if (data?.error) return false
  const blocks = Array.isArray(data?.message?.content) ? data.message.content : []
  for (const b of blocks) {
    if (b && typeof b === 'object' && b.type === 'tool-result' && b.isError === true) return false
  }
  return true
}

export function apply(ctx, input = {}) {
  const root = process.env.YXSPEC_TRAJECTORY_ROOT || DEFAULT_ROOT
  let logDir = null
  try {
    logDir = join(root, '.plugin')
    mkdirSync(logDir, { recursive: true })
  } catch {
    logDir = null
  }
  const log = (msg) => {
    if (!logDir) return
    try { appendFileSync(join(logDir, 'aspice-trajectory.log'), `${new Date().toISOString()} ${msg}\n`, 'utf8') } catch {}
  }
  log(`apply() invoked; root=${root}; stages=${CMD_TOKENS ? CMD_TOKENS.size : '(unavailable)'}`)

  // sessionId -> 当前活动轨迹记录（open）；turn/end 落盘后置 done 并清空。
  const sessions = new Map()

  const openStage = (sessionId, stage) => {
    const seq = nextSeqFor(root, stage)
    const rec = {
      sessionId,
      stage,
      seq,
      file: join(root, stage, `${stage}-${String(seq).padStart(3, '0')}.jsonl`),
      state: 'open',
      startedAt: Date.now(),
      finishedAt: null,
      turnCount: 0,
      stepCount: 0,
      eventTypes: new Set(),
      tools: [],
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reason: null,
    }
    sessions.set(sessionId, rec)
    return rec
  }

  const finishStage = (rec, reason) => {
    if (!rec || rec.state !== 'open') return
    rec.state = 'done'
    rec.finishedAt = Date.now()
    rec.reason = reason
    try {
      mkdirSync(dirname(rec.file), { recursive: true })
      appendFileSync(rec.file, JSON.stringify(toRecord(rec)) + '\n', 'utf8')
      log(`append ${rec.stage}/${rec.stage}-${String(rec.seq).padStart(3, '0')}.jsonl events=${rec.eventTypes.size} tools=${rec.tools.length} reason=${reason ?? 'no-reason'}`)
    } catch (e) {
      log(`write fail: ${String(e?.message ?? e)}`)
    }
  }

  const off = ctx.on('session/event', (session, event) => {
    if (!event || typeof event.type !== 'string') return
    const sessionId = String(session.id)

    // ---- 阶段边界：注入 prompt 命中阶段命令 → 开新轨迹（同阶段续跑不重开）----
    if (event.type === 'agent/inbox/spliced') {
      const prompt = promptFromInbox(event.data)
      const token = stageOfPrompt(prompt)
      if (!token) return // 通用咨询/无阶段命令 → 不建轨迹
      const cur = sessions.get(sessionId)
      if (cur && cur.state === 'open' && cur.stage === token) return // 同阶段续跑
      if (cur && cur.state === 'open') finishStage(cur, 'stage-switch') // 换阶段 → 先封口
      openStage(sessionId, token)
      return
    }

    const rec = sessions.get(sessionId)
    if (!rec || rec.state !== 'open') return
    if (!TRACKED.has(event.type)) return

    if (event.type === 'turn/start') rec.turnCount++
    else if (event.type === 'step/start') rec.stepCount++
    else if (event.type === 'tool/call') {
      rec.tools.push({ type: 'tool/call', name: event.data?.name ?? null, callId: event.data?.callId ?? null, ts: Date.now() })
    } else if (event.type === 'tool/result') {
      // name 用 message.source.callId 关联到的调用名：向前匹配最近一次同名 callId
      const callId = event.data?.message?.source?.callId ?? event.data?.message?.callId ?? null
      let name = null
      for (let i = rec.tools.length - 1; i >= 0; i--) {
        const t = rec.tools[i]
        if (t.type === 'tool/call' && (t.callId ?? null) === callId) { name = t.name; break }
      }
      rec.tools.push({
        type: 'tool/result',
        name: name ?? (typeof callId === 'string' ? callId : null),
        ok: toolResultOk(event.data),
        error: event.data?.error?.code ?? event.data?.error?.message ?? null,
        ts: Date.now(),
      })
    } else if (event.type === 'assistant/message') {
      const u = event.data?.usage
      if (u && typeof u === 'object') {
        rec.tokens.input += u.inputTokens ?? 0
        rec.tokens.output += u.outputTokens ?? 0
        rec.tokens.cacheRead += u.cacheReadTokens ?? 0
        rec.tokens.cacheWrite += u.cacheWriteTokens ?? 0
      }
    } else if (event.type === 'turn/end') {
      rec.eventTypes.add(event.type)
      finishStage(rec, event.data?.reason?.kind ?? null)
      sessions.delete(sessionId)
      return
    }
    rec.eventTypes.add(event.type)
  })

  // Cordis ctx.effect 语义：回调体在插件激活时执行一次；返回的函数才是
  // dispose 时的清理。坑（2026-08-27 实测）：把清理逻辑写在回调体内会在
  // 激活瞬间（mount 后 ~2ms）立刻 unsubscribe，轨迹从此收不到任何事件。
  ctx.effect(() => {
    ctx.logger?.info?.(`[aspice-trajectory] active: 订阅 session/event（root ctx，${TRACKED.size} 类事件跟踪，${CMD_TOKENS ? CMD_TOKENS.size : 0} 阶段命令）`)
    return () => {
      log('dispose: unsubscribed')
      try { off?.() } catch {}
      // 残留 open 轨迹（abort/重启）落盘封口：reason=interrupted → 门控 blocked
      for (const rec of sessions.values()) finishStage(rec, 'interrupted')
      sessions.clear()
    }
  })
}
