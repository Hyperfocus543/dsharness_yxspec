// POC: session-query 家族可达性冒烟 — 副本 runtime，不碰主 8787。
// 直驱 SDK runtime 子进程，指定 cordis-poc-session-query.yml。
// 验证：1) 副本配置能否正常装配（含 session-query-sqlite + tool-session-query）
//       2) 工具面出现 session_query 5 工具（session_search / session_event_search /
//          session_trace / session_event_trace / session_event_read）
// 用法：node poc-session-query-smoke.mjs
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { readFileSync, existsSync } from 'node:fs'

// 注入 credentials key（与 start-gateway.mjs 相同逻辑）
const credPath = 'C:/Users/Administrator/.dsh/.credentials.yaml'
let credRaw = ''
try { if (existsSync(credPath)) credRaw = readFileSync(credPath, 'utf8') } catch {}
const keyMatch = (name) => credRaw.match(new RegExp(`^${name}:\\s*(.+)`, 'm'))?.[1]?.trim()
const env = { ...process.env }
const MINIMAX = keyMatch('MINIMAX_CN_API_KEY')
if (MINIMAX) env.MINIMAX_CN_API_KEY = MINIMAX

const RUNTIME_BIN = 'D:/AI/deepseek-harness-master/packages/examples/jsonrpc-demo/lib/bin.js'
const CONFIG = 'D:/Work/01_Projects/Aima_X1_BCM/.dsh/gateway/runtime-js/config/cordis-poc-session-query.yml'

// session-query sqlite 派生库路径（副本专属，绝不影响生产）
const SQ_DB = 'D:/Work/01_Projects/Aima_X1_BCM/.dsh/gateway/runtime-js/poc-session-query/poc-session-query.db'
mkdirSync('D:/Work/01_Projects/Aima_X1_BCM/.dsh/gateway/runtime-js/poc-session-query', { recursive: true })
env.SESSION_QUERY_DB = SQ_DB

const sdkClient = await import(pathToFileURL('D:/AI/deepseek-harness-master/packages/sdk/client/lib/index.js').href)
const { DeepSeekHarness } = sdkClient

const eventsSeen = []
const toolCalls = []
const toolResults = []

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
  const result = await harness.run(
    '这是一次 session-query 可达性验证。请只用一句话回答：如果你需要回顾“之前会话里审计账本相关的检索或追踪”可以用哪些工具？（列出会话查询相关工具名即可，不要真正执行任何工具）',
    {
      sessionId: 'poc-session-query-smoke',
      onNotification: (n) => {
        if (n.method !== 'session.event') return
        const e = n.params.event
        if (!e || typeof e.type !== 'string') return
        eventsSeen.push({ type: e.type, data: e.data })
        if (e.type === 'tool/call') toolCalls.push(e.data?.name)
        if (e.type === 'tool/result') toolResults.push(e.data)
      },
    },
  )
  console.log('--- RESULT ---')
  console.log('sessionId:', result.sessionId)
  console.log('finalResponse:', JSON.stringify(result.finalResponse?.slice(0, 800)))
  console.log('--- EVENTS ---')
  for (const t of ['system/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/end']) {
    const n = eventsSeen.filter((e) => e.type === t).length
    console.log(`  ${t}: ${n}`)
  }
  console.log('tool calls:', JSON.stringify(toolCalls))
  console.log('elapsedMs:', Date.now() - started)
} catch (err) {
  console.error('--- ERROR ---')
  console.error(String(err?.message ?? err))
  console.error('elapsedMs:', Date.now() - started)
  process.exitCode = 1
} finally {
  await harness.close?.().catch?.()
}
