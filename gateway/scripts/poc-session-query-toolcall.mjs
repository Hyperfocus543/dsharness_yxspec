// POC: session-query 工具真实调用冒烟 — 让模型实际执行 session 查询工具。
// 验证 tool-session-query 的工具执行路径可达（execute → ctx.sessionQuery 后端调用）。
// 用法：node poc-session-query-toolcall.mjs
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
const CONFIG = 'D:/Work/01_Projects/Aima_X1_BCM/.dsh/gateway/runtime-js/config/cordis-poc-session-query.yml'
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
    '请调用 session_event_search 工具，在本次会话里搜索关键词“审计”。' +
    '如果 session_event_search 不可用，就调用 session_search 搜索“审计”。' +
    '调用完成后，用一句话告诉我工具返回了什么。不要省略工具调用这一步。',
    {
      sessionId: 'poc-session-query-toolcall',
      onNotification: (n) => {
        if (n.method !== 'session.event') return
        const e = n.params.event
        if (!e || typeof e.type !== 'string') return
        eventsSeen.push({ type: e.type, data: e.data })
        if (e.type === 'tool/call') {
          toolCalls.push({ name: e.data?.name, args: e.data?.arguments })
          console.log('  [tool/call]', e.data?.name, String(e.data?.arguments ?? '').slice(0, 300))
        }
        if (e.type === 'tool/result') {
          toolResults.push(e.data)
          const err = e.data?.error?.code
          console.log('  [tool/result]', err ? `ERROR:${err}` : `OK ${String(e.data?.message?.content ?? '').slice(0, 400)}`)
        }
      },
    },
  )
  console.log('--- RESULT ---')
  console.log('sessionId:', result.sessionId)
  console.log('finalResponse:', JSON.stringify(result.finalResponse?.slice(0, 800)))
  console.log('tool calls:', JSON.stringify(toolCalls.map((t) => t.name)))
  console.log('elapsedMs:', Date.now() - started)
} catch (err) {
  console.error('--- ERROR ---')
  console.error(String(err?.message ?? err))
  console.error('elapsedMs:', Date.now() - started)
  process.exitCode = 1
} finally {
  await harness.close?.().catch?.()
}
