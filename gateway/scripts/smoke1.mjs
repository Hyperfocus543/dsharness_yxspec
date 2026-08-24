// Minimal TS SDK drive smoke test for YXSpec SQT gateway.
// Spawns the dsh-jsonrpc-agent runtime (MiniMax via llm-pi-ai), runs one prompt,
// collects goal/change + todo/write + turn/end events.
// Usage: node smoke1.mjs
import { pathToFileURL } from 'node:url'
const sdkClient = await import(pathToFileURL('D:/AI/deepseek-harness-master/packages/sdk/client/lib/index.js').href)
const { DeepSeekHarness } = sdkClient

const RUNTIME_BIN = 'D:/AI/deepseek-harness-master/packages/examples/jsonrpc-demo/lib/bin.js'
const CONFIG = 'D:/Work/01_Projects/Aima_X1_BCM/.dsh/gateway/runtime-js/config/cordis.yml'
const CWD = 'D:/Work/01_Projects/Aima_X1_BCM'

const eventsSeen = []
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
  const result = await harness.run('一句话回答：1+1=', {
    sessionId: 'smoke1',
    onNotification: (n) => {
      if (n.method === 'session.event') {
        const e = n.params.event
        if (e && e.type) eventsSeen.push({ type: e.type, data: e.data })
      }
    },
  })
  console.log('--- RESULT ---')
  console.log('sessionId:', result.sessionId)
  console.log('finalResponse:', JSON.stringify(result.finalResponse?.slice(0, 500)))
  console.log('--- EVENTS (%d) ---', eventsSeen.length)
  for (const ev of eventsSeen) {
    console.log(' ', ev.type, JSON.stringify(ev.data ?? {}).slice(0, 300))
  }
  const kinds = new Set(eventsSeen.map(e => e.type))
  console.log('--- event kinds:', [...kinds].join(', '))
  console.log('elapsedMs:', Date.now() - started)
} finally {
  await harness.close()
}
