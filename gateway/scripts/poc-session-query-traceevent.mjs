// POC: session-query 跨会话检索 + traceEvent 直接调用（ASPICE 追溯场景最接近验证）。
// 1) 会话A 植入含"审计"关键词的内容（含一个事件）
// 2) 会话B 跨会话调用 session_search 搜"审计" → 应命中会话A
// 3) 会话B 对命中事件的 seq 调用 session_event_trace → 验证 traceEvent 可达
// 4) 会话B 调用 session_trace 追踪会话A → 验证 traceSession 对任意会话
// 用法：node poc-session-query-traceevent.mjs
import { pathToFileURL } from 'node:url'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'

const credPath = 'C:/Users/Administrator/.dsh/.credentials.yaml'
let credRaw = ''
try { if (existsSync(credPath)) credRaw = readFileSync(credPath, 'utf8') } catch {}
const keyMatch = (name) => credRaw.match(new RegExp(`^${name}:\\s*(.+)`, 'm'))?.[1]?.trim()
const env = { ...process.env }
const MINIMAX = keyMatch('MINIMAX_CN_API_KEY')
if (MINIMAX) env.MINIMAX_CN_API_KEY = MINIMAX

const RUNTIME_BIN = 'D:/AI/deepseek-harness-master/packages/examples/jsonrpc-demo/lib/bin.js'
const CONFIG = 'D:/Work/01_Projects/Aima_X1_BCM/.dsh/gateway/runtime-js/config/cordis-poc-session-query-min.yml'
const SQ_DB = 'D:/Work/01_Projects/Aima_X1_BCM/.dsh/gateway/runtime-js/poc-session-query/poc-session-query.db'
mkdirSync('D:/Work/01_Projects/Aima_X1_BCM/.dsh/gateway/runtime-js/poc-session-query', { recursive: true })
env.SESSION_QUERY_DB = SQ_DB

const sdkClient = await import(pathToFileURL('D:/AI/deepseek-harness-master/packages/sdk/client/lib/index.js').href)
const { DeepSeekHarness } = sdkClient

const toolCalls = []
function makeHandler(label) {
  return (n) => {
    if (n.method !== 'session.event') return
    const e = n.params.event
    if (!e || typeof e.type !== 'string') return
    if (e.type === 'tool/call') {
      toolCalls.push({ label, name: e.data?.name, args: e.data?.arguments })
      console.log(`  [${label}][tool/call]`, e.data?.name, String(e.data?.arguments ?? '').slice(0, 300))
    }
    if (e.type === 'tool/result') {
      const err = e.data?.error?.code
      console.log(`  [${label}][tool/result]`, err ? `ERROR:${err}` : `OK ${String(e.data?.message?.content ?? '').slice(0, 600)}`)
    }
  }
}

const harness = new DeepSeekHarness({
  launch: {
    command: process.execPath,
    args: [RUNTIME_BIN, CONFIG],
    cwd: 'D:/AI/deepseek-harness-master',
    env,
  },
  cwd: 'D:/Work/01_Projects/Aima_X1_BCM',
  provider: 'minimax-cn',
  model: 'MiniMax-M3',
  maxTokens: 4096,
})

const started = Date.now()
try {
  // 1) 会话A：植入内容（仅陈述，不执行工具）
  const a = await harness.run(
    '请记住下面这条审计记录：BCM 硬件需求基线 V1.5 于 2026-08-20 冻结，共 288 条需求，责任人是欧工。' +
    '你只需用一句话确认你已记住。',
    { sessionId: 'poc-audit-a', onNotification: makeHandler('A') },
  )
  console.log('--- 会话A finalResponse:', String(a.finalResponse ?? '').slice(0, 200))

  // 2) 会话B：跨会话检索 + 追踪（先让模型搜，命中后自己决定 trace 哪个）
  const b = await harness.run(
    '请执行以下三步工具调用，务必真实调用：\n' +
    '1. 调用 session_search 搜索关键词"审计"（跨会话检索先前会话）。\n' +
    '2. 如果命中某个会话，对它调用 session_trace 查看其谱系。\n' +
    '3. 再调用 session_event_trace 追踪命中最强事件的来源（参数 session 填命中会话 id，seq 填命中最强事件的 seq）。\n' +
    '最后用一句话总结你追踪到了什么。',
    { sessionId: 'poc-audit-b', onNotification: makeHandler('B') },
  )
  console.log('--- 会话B finalResponse:', String(b.finalResponse ?? '').slice(0, 600))
  console.log('--- 工具调用清单 ---')
  for (const t of toolCalls) console.log(`  ${t.label}: ${t.name} ${JSON.stringify(t.args)}`)
  console.log('elapsedMs:', Date.now() - started)
} catch (err) {
  console.error('--- ERROR ---')
  console.error(String(err?.message ?? err))
  process.exitCode = 1
} finally {
  await harness.close?.().catch?.()
}
