// Harness 驱动封装：TS SDK（@deepseek-ai/dsh-sdk-client）编程驱动 Windows 本地
// runtime（MiniMax）。事件实时转发给总线；状态回写由调用方负责。
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const sdkClient = await import(pathToFileURL('D:/AI/deepseek-harness-master/packages/sdk/client/lib/index.js').href)
const { DeepSeekHarness } = sdkClient

// 顶层懒加载 models.mjs（其函数只在需要时调用）
const modelsModule = await import('./models.mjs')

export const RUNTIME_BIN = 'D:/AI/deepseek-harness-master/packages/examples/jsonrpc-demo/lib/bin.js'
// 运行时装配表：默认主 cordis.yml，可经 env YXSPEC_CORDIS_CONFIG 覆盖（副本网关验证用）
export const CONFIG_PATH = process.env.YXSPEC_CORDIS_CONFIG
  ? (process.env.YXSPEC_CORDIS_CONFIG.startsWith('file:') ? fileURLToPath(new URL(process.env.YXSPEC_CORDIS_CONFIG)) : process.env.YXSPEC_CORDIS_CONFIG)
  : fileURLToPath(new URL('../runtime-js/config/cordis.yml', import.meta.url))
export const HARNESS_CWD = 'D:/AI/deepseek-harness-master'
// 工作区（项目根）可经环境变量覆盖：runtime 的 fs/bash cwd + session 目录归属
export const WORKSPACE_CWD = process.env.YXSPEC_WORKSPACE_CWD || 'D:/Work/01_Projects/Aima_X1_BCM'

// 审计日志根：<project>/.dsh/gateway-log/<session>/turn-<n>.jsonl
// 记录每轮 agent 的 tool/call(name+arguments) + tool/result + turn/end(reason)，
// 形成"每步工具用了什么、产出什么"的离线事实账本（harness 架构增效）。
import { mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
export const AUDIT_ROOT = process.env.YXSPEC_AUDIT_ROOT || join(WORKSPACE_CWD, '.dsh', 'gateway-log')
const auditTurnCounters = new Map() // sessionId -> {n}
let auditStreamOpen = true

function auditWrite(sessionId, kind, payload) {
  if (!auditStreamOpen) return
  try {
    const counter = auditTurnCounters.get(sessionId) ?? { n: 0 }
    if (kind === 'turn/start') counter.n += 1
    auditTurnCounters.set(sessionId, counter)
    const dir = join(AUDIT_ROOT, sessionId || 'default')
    const file = join(dir, `turn-${String(counter.n).padStart(3, '0')}.jsonl`)
    mkdirSync(dir, { recursive: true })
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), kind, ...payload }) + '\n', 'utf8')
  } catch {
    /* 审计日志写失败不影响主流程 */
  }
}

function auditClose() {
  auditStreamOpen = false
}

// 单例 harness，跨请求复用（SDK 设计：一个 runtime 子进程跨多个 session）。
// 模型按 spec 缓存：请求的 provider/model 与当前不同时，先 closeHarness 再重建。
// （SDK 握手冻结 provider/model，切模型必须重建 runtime 子进程）
let harness = null
let currentSpec = null // { provider, model, maxTokens }

// 串行闸门：SDK harness 单例不支持并发 run()，并发请求会卡死 runtime
// （M2 压测发现：两个并发 /api/agent 打到一个 runtime → 空转不返回）。
// 这里用 promise 队列让 turn 排队执行，一次只有一个在跑。
let runQueue = Promise.resolve()
let queueGeneration = 0

// 用户中止标记：/api/agent/abort 置位后，当前在跑的 turn 抛 TurnAbortedError，
// 队列中尚未开始的 turn 因 queueGeneration 变化直接拒绝（不再用新建 runtime 继续跑）。
let abortRequested = false

/** 用户 abort / closeHarness 杀 runtime 导致的统一异常。 */
export class TurnAbortedError extends Error {
  constructor(message = 'turn aborted by user') {
    super(message)
    this.name = 'TurnAbortedError'
  }
}

/** turn 超时熔断：单轮 agent 最长时间，超过视为卡死（杀 runtime + 清队列，让编排器拿明确失败）。 */
const TURN_TIMEOUT_MS = 30 * 60 * 1000

/** 超时熔断异常：runTurn 超时未返回时抛出，调用方（runAndEmit）置 blocked。 */
export class TurnTimeoutError extends Error {
  constructor(message = `turn timeout after ${TURN_TIMEOUT_MS / 60000}min`) {
    super(message)
    this.name = 'TurnTimeoutError'
  }
}

export function getCurrentSpec() {
  return currentSpec ? { ...currentSpec } : null
}

/**
 * 获取当前单例 harness；spec 与当前不一致时摘除旧 runtime 并新建。
 * 并发安全约束：本函数是同步的，必须在串行闸门（withRunLock）内调用。
 * 摘除（先置空全局再异步关旧进程）保证并发 closeHarness 不会复杀新引用。
 */
export function getHarness({ provider, model, maxTokens } = {}) {
  // 默认从 model-config 解析当前默认模型
  if (!provider || !model) {
    try {
      const spec = modelsModule.resolveModel(modelsModule.getDefaultModelId())
      provider = spec.provider
      model = spec.model
      maxTokens = maxTokens ?? spec.maxTokens
    } catch {
      provider = provider ?? 'minimax-cn'
      model = model ?? 'MiniMax-M3'
      maxTokens = maxTokens ?? 49152
    }
  }
  maxTokens = maxTokens ?? 49152

  if (harness && currentSpec && currentSpec.provider === provider && currentSpec.model === model) {
    return harness
  }

  // 模型变了或 harness 已被 close → 摘除旧单例（同步置空，防止并发拿到/复杀旧引用）。
  // 旧的 runtime 进程异步关闭（不阻塞新建）；后续 turn 拿到的都是新单例。
  if (harness) {
    const old = harness
    const oldSpec = currentSpec
    harness = null
    currentSpec = null
    console.warn(`[harness] 模型切换: ${oldSpec?.provider}/${oldSpec?.model} -> ${provider}/${model}，重建 runtime`)
    old.close().catch(() => {})
  }

  harness = new DeepSeekHarness({
    launch: {
      command: process.execPath,
      args: [RUNTIME_BIN, CONFIG_PATH],
      cwd: HARNESS_CWD,
      env: { ...process.env },
    },
    cwd: WORKSPACE_CWD,
    provider,
    model,
    // SDK 默认 49152；8192 会让 agent 并行写多份产物时撞输出上限被截断（实测 max-tokens）
    maxTokens,
  })
  currentSpec = { provider, model, maxTokens }
  return harness
}

/**
 * 串行闸门：把 fn 排进队列，一次只执行一个。
 * queueGeneration 变化（abort）时，队列里尚未开始的 turn 直接抛 TurnAbortedError。
 */
function withRunLock(fn) {
  const gen = queueGeneration
  const run = runQueue.then(() => {
    if (gen !== queueGeneration) throw new TurnAbortedError('turn cancelled by abort')
    return fn()
  }, () => {
    if (gen !== queueGeneration) throw new TurnAbortedError('turn cancelled by abort')
    return fn()
  })
  // 保持队列链，即使本次失败也继续排下一个
  runQueue = run.catch(() => {})
  return run
}

/** 用户中止：置中止标记 + 清空等待队列（在跑的 turn 由 runtime 被杀触发失败）。 */
export function abortTurn() {
  abortRequested = true
  queueGeneration++
}

/**
 * 跑一轮 agent turn。
 * @param {object} opts { prompt, sessionId, onEvent }
 * @returns {Promise<{finalResponse, events, finishReason}>}
 *
 * 并发安全：spec 解析与 harness 获取都在串行闸门内完成——
 * 排队等待期间可能发生 closeHarness（abort/模型切换），
 * 必须取「执行时刻」的当前单例，而不是入队时刻的快照。
 */
export async function runTurn({ prompt, sessionId, model, onEvent }) {
  const spec = model
    ? (() => { try { return modelsModule.resolveModel(model) } catch { return null } })()
    : null
  const specArgs = spec
    ? { provider: spec.provider, model: spec.model, maxTokens: spec.maxTokens }
    : null

  // 超时熔断：整轮（含排队 + 执行）带硬超时。SDK run() 卡住不返回时，
  // race 触发 → 杀 runtime + 清队列，让调用方拿 TurnTimeoutError 明确失败，
  // 而不是让后续所有 turn 在队列里永久等待（跑一晚上最怕的卡死）。
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TurnTimeoutError())
    }, TURN_TIMEOUT_MS)
  })

  try {
    return await Promise.race([
      withRunLock(async () => {
        // 上一轮 abort 标记只影响"被中止的那一轮"；新 turn 真正开始执行时清除。
        abortRequested = false
        const h = specArgs ? getHarness(specArgs) : getHarness()
        return executeTurn({ h, prompt, sessionId, onEvent })
      }),
      timeout,
    ])
  } catch (err) {
    if (err instanceof TurnTimeoutError) {
      console.error(`[harness] turn 超时熔断: session=${sessionId} 超过 ${TURN_TIMEOUT_MS / 60000}min，杀 runtime + 清队列`)
      // 清空等待队列：后续排队 turn 立即拒绝（防连锁卡死）
      queueGeneration++
      // 摘除死 harness + 关 runtime，下次 getHarness 重建
      const dead = harness
      harness = null
      currentSpec = null
      if (dead) dead.close().catch(() => {})
    } else if (!(err instanceof TurnAbortedError)) {
      // 非用户中止的运行时错误（runtime 崩溃/传输层错误）：摘除 harness 重建，
      // 避免 getHarness 复用死实例导致后续 turn 连续失败。
      const dead = harness
      harness = null
      currentSpec = null
      if (dead) dead.close().catch(() => {})
      console.warn(`[harness] 运行时错误，摘除 harness 重建: ${err?.message ?? err}`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

function auditStringify(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch { return String(v) }
}

async function runOnce({ h, prompt, sessionId, onEvent, events }) {
  auditWrite(sessionId, 'turn/start', { prompt: String(prompt).slice(0, 200) })
  const out = await h.run(prompt, {
    sessionId,
    onNotification: (n) => {
      if (n.method !== 'session.event') return
      const evt = n.params?.event
      if (!evt || typeof evt.type !== 'string') return
      events.push(evt)
      // 审计：工具调用 / 结果 / turn 终结
      if (evt.type === 'tool/call') {
        let args = evt.data?.arguments
        try { args = typeof args === 'string' ? JSON.parse(args) : args } catch { /* 保留原始 */ }
        auditWrite(sessionId, 'tool/call', { name: evt.data?.name, args: auditStringify(args).slice(0, 800) })
      } else if (evt.type === 'tool/result') {
        const content = evt.data?.message?.content
        auditWrite(sessionId, 'tool/result', {
          callId: evt.data?.message?.callId ?? evt.data?.callId ?? null,
          error: evt.data?.error?.code ?? null,
          content: auditStringify(content).slice(0, 800),
        })
      } else if (evt.type === 'assistant/message') {
        // 补记 token usage：SDK 事件流里 assistant/message 携带 data.usage
        // （DeepSeek 适配器从 prompt_tokens/completion_tokens 映射）。只记 usage 摘要，
        // 不落 message 正文，避免账本无限膨胀。
        const u = evt.data?.usage
        if (u && typeof u === 'object' && (typeof u.inputTokens === 'number' || typeof u.outputTokens === 'number')) {
          auditWrite(sessionId, 'assistant/message', {
            usage: {
              inputTokens: u.inputTokens ?? 0,
              outputTokens: u.outputTokens ?? 0,
              cacheReadTokens: u.cacheReadTokens ?? 0,
              cacheWriteTokens: u.cacheWriteTokens ?? 0,
            },
          })
        }
      } else if (evt.type === 'turn/end') {
        auditWrite(sessionId, 'turn/end', { reason: evt.data?.reason ?? null })
      } else if (evt.type === 'goal/change') {
        auditWrite(sessionId, 'goal/change', { name: evt.data?.name, state: evt.data?.state })
      } else if (evt.type === 'todo/write') {
        auditWrite(sessionId, 'todo/write', { todos: (evt.data?.todos ?? []).map((t) => ({ content: t?.content, status: t?.status })) })
      }
      onEvent?.(evt)
    },
  })
  // 透传 harness 实际使用的 sessionId（复用失败换新 session 时，返回新 id）
  return { ...out, sessionId: out.sessionId ?? sessionId }
}

async function executeTurn({ h, prompt, sessionId, onEvent }) {
  const events = []
  let result
  try {
    result = await runOnce({ h, prompt, sessionId, onEvent, events })
  } catch (err) {
    // abort 或 harness 被关闭导致 run() 抛错 → 统一转成 TurnAbortedError，方便上层优雅收尾
    if (abortRequested) throw new TurnAbortedError(String(err?.message ?? err))
    throw err
  }

  // 立即失败判定：finishReason 非空且 error，或 result 无 finalResponse
  let finishReason = null
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'turn/end') {
      finishReason = events[i].data?.reason?.kind ?? null
      break
    }
  }
  const failedFast = finishReason === 'error' && !result.finalResponse
  if (failedFast && sessionId) {
    console.warn(`[harness] 复用 session "${sessionId}" 立即失败，改用新 session 重试`)
    events.length = 0
    try {
      const retry = await runOnce({ h, prompt, sessionId: undefined, onEvent, events })
      finishReason = null
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'turn/end') {
          finishReason = events[i].data?.reason?.kind ?? null
          break
        }
      }
      // 透传实际使用的新 sessionId（复用失败重试后，前端需切到新频道订阅）
      return { finalResponse: retry.finalResponse, events, finishReason, sessionId: retry.sessionId }
    } catch (err) {
      if (abortRequested) throw new TurnAbortedError(String(err?.message ?? err))
      throw err
    }
  }

  return { finalResponse: result.finalResponse, events, finishReason, sessionId: result.sessionId }
}

export async function closeHarness() {
  const h = harness
  // 先摘除再关：让并发 getHarness 拿到空值新建 runtime，而不是复用正在关闭的旧引用
  harness = null
  currentSpec = null
  if (h) await h.close()
}