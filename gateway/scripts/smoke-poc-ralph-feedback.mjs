// POC 冒烟：tool-ralph + feedback + schedule 装配与模型工具面验证（副本配置）
// 用法：node smoke-poc-ralph-feedback.mjs
// 不碰主 8787：runtime 是 stdio JSON-RPC 子进程，无 HTTP 端口。
import { pathToFileURL } from 'node:url'
const sdkClient = await import(pathToFileURL('D:/AI/deepseek-harness-master/packages/sdk/client/lib/index.js').href)
const { DeepSeekHarness } = sdkClient

const RUNTIME_BIN = 'D:/AI/deepseek-harness-master/packages/examples/jsonrpc-demo/lib/bin.js'
const CONFIG = 'D:/Work/01_Projects/Aima_X1_BCM/.dsh/gateway/runtime-js/config/cordis-poc-ralph-feedback.yml'
const CWD = 'D:/Work/01_Projects/Aima_X1_BCM'

const sessionId = `poc-ralph-fb-${Date.now()}`
const eventsSeen = []
const toolNamesSeen = new Set()

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
  maxTokens: 4096,
})

const started = Date.now()
try {
  const result = await harness.run(
    '请只做一件事：把你当前可以调用的所有工具名称列出来（用简短列表回复，不要真的调用任何工具）。',
    {
      sessionId,
      onNotification: (n) => {
        if (n.method === 'session.event') {
          const e = n.params.event
          if (!e || typeof e.type !== 'string') return
          eventsSeen.push({ type: e.type, data: e.data })
          if (e.type === 'tool/call') toolNamesSeen.add(e.data?.name)
        }
      },
    },
  )
  console.log('--- RESULT ---')
  console.log('sessionId:', result.sessionId)
  console.log('finalResponse:', JSON.stringify(result.finalResponse?.slice(0, 800)))
  console.log('--- EVENTS kinds ---')
  for (const ev of eventsSeen) {
    console.log(' ', ev.type, JSON.stringify(ev.data ?? {}).slice(0, 250))
  }
  console.log('--- tools actually called ---', [...toolNamesSeen].join(', ') || '(none)')
  console.log('elapsedMs:', Date.now() - started)
} finally {
  await harness.close()
}
