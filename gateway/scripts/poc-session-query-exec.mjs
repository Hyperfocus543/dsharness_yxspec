// POC: session-query 工具真实执行（最小组合，无 tool-guard 干扰）。
// 用 cordis-poc-session-query-min.yml，强制模型调用 session_event_search + session_trace。
// 用法：node poc-session-query-exec.mjs
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
    '请先调用 session_event_search 工具搜索关键词“审计”，然后调用 session_trace 工具追踪当前会话的谱系（session 参数填本次会话）。' +
    '务必真的执行这两个工具调用，不要在文本里描述。最后用一句话总结工具返回。',
    {
      sessionId: 'poc-session-query-exec',
      onNotification: (n) => {
        if (n.method !== 'session.event') return
        const e = n.params.event
        if (!e || typeof e.type !== 'string') return
        if (e.type === 'tool/call') {
          toolCalls.push({ name: e.data?.name, args: e.data?.arguments })
          console.log('  [tool/call]', e.data?.name, String(e.data?.arguments ?? '').slice(0, 300))
        }
        if (e.type === 'tool/result') {
          const err = e.data?.error?.code
          console.log('  [tool/result]', err ? `ERROR:${err}` : `OK ${String(e.data?.message?.content ?? '').slice(0, 500)}`)
        }
      },
    },
  )
  console.log('--- RESULT ---')
  console.log('finalResponse:', JSON.stringify(result.finalResponse?.slice(0, 800)))
  console.log('tool calls:', JSON.stringify(toolCalls.map((t) => t.name)))
  console.log('elapsedMs:', Date.now() - started)
} catch (err) {
  console.error('--- ERROR ---')
  console.error(String(err?.message ?? err))
  process.exitCode = 1
} finally {
  await harness.close?.().catch?.()
}
