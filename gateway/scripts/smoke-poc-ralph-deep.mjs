// POC 深度验证：ralph 真实调用（fresh-agent 循环）+ schedule_create 真实执行
// 用法：node smoke-poc-ralph-deep.mjs
// 不碰主 8787：runtime 是 stdio JSON-RPC 子进程。
import { pathToFileURL } from 'node:url'
const sdkClient = await import(pathToFileURL('D:/AI/deepseek-harness-master/packages/sdk/client/lib/index.js').href)
const { DeepSeekHarness } = sdkClient

const RUNTIME_BIN = 'D:/AI/deepseek-harness-master/packages/examples/jsonrpc-demo/lib/bin.js'
const CONFIG = 'D:/Work/01_Projects/Aima_X1_BCM/.dsh/gateway/runtime-js/config/cordis-poc-ralph-feedback.yml'
const CWD = 'D:/Work/01_Projects/Aima_X1_BCM'

const sessionId = `poc-ralph-deep-${Date.now()}`
const eventsSeen = []
const toolCalls = [] // {name, arguments}

const harness = new DeepSeekHarness({
  launch: {
    command: process.execPath,
    args: [RUNTIME_BIN, CONFIG],
    cwd: 'D:/AI/deepseek-harness-master',
    env: { ...process.env },
  },
  cwd: CWD,
  provider: 'minimax-cn',
  model: 'MiniMax-M3',
  maxTokens: 16384,
})

const started = Date.now()
try {
  const prompt = `请完成下面三件事（按顺序）：
1) 调用 ralph 工具：objective 用「只用一句话说明 1+1 等于几」，maxRounds 用 1。这是验证工具可用性的最小测试。
2) 调用 schedule_create 工具：after_seconds 用 86400（一天后，不会真的触发），prompt 用「这是定时验证」。
3) 调用 schedule_list 工具列出当前定时器。

然后简要汇报每一步的结果。`
  const result = await harness.run(prompt, {
    sessionId,
    onNotification: (n) => {
      if (n.method === 'session.event') {
        const e = n.params.event
        if (!e || typeof e.type !== 'string') return
        eventsSeen.push({ type: e.type, data: e.data })
        if (e.type === 'tool/call') {
          let args = e.data?.arguments
          try { args = typeof args === 'string' ? JSON.parse(args) : args } catch {}
          toolCalls.push({ name: e.data?.name, args })
        }
        if (e.type === 'tool/result') {
          console.log(`[tool/result] callId=${e.data?.message?.callId}`, JSON.stringify(e.data?.message?.content ?? e.data?.error ?? {}).slice(0, 600))
        }
      }
    },
  })
  console.log('--- RESULT ---')
  console.log('sessionId:', result.sessionId)
  console.log('finalResponse:', JSON.stringify(result.finalResponse?.slice(0, 1500)))
  console.log('--- TOOL CALLS ---')
  for (const tc of toolCalls) console.log(' ', tc.name, JSON.stringify(tc.args ?? {}).slice(0, 300))
  const kinds = [...new Set(eventsSeen.map(e => e.type))]
  console.log('--- event kinds:', kinds.join(', '))
  console.log('--- ralph-related events ---')
  for (const ev of eventsSeen) {
    if (ev.type.startsWith('workflow') || ev.type.includes('subagent') || ev.type.includes('agent/')) {
      console.log(' ', ev.type, JSON.stringify(ev.data ?? {}).slice(0, 250))
    }
  }
  console.log('elapsedMs:', Date.now() - started)
} finally {
  await harness.close()
}
