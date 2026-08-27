// Smoke 2: verify goal/change + todo/write + turn/end events stream.
// Prompt asks the agent to use todo_write and goal_create.
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
// 路径 env 化：HARNESS_HOME（harness 主仓根）/ YXSPEC_WORKSPACE_CWD（项目根）
const HARNESS_HOME = process.env.HARNESS_HOME ?? 'D:/AI/deepseek-harness-master'
const WORKSPACE = process.env.YXSPEC_WORKSPACE_CWD ?? 'D:/Work/01_Projects/Aima_X1_BCM'
const sdkClient = await import(pathToFileURL(`${HARNESS_HOME}/packages/sdk/client/lib/index.js`).href)
const { DeepSeekHarness } = sdkClient

const RUNTIME_BIN = `${HARNESS_HOME}/packages/examples/jsonrpc-demo/lib/bin.js`
const CONFIG = process.env.YXSPEC_CORDIS_CONFIG ? fileURLToPath(new URL(process.env.YXSPEC_CORDIS_CONFIG)) : `${WORKSPACE}/.dsh/gateway/runtime-js/config/cordis.yml`
const CWD = WORKSPACE

const eventsSeen = []
const harness = new DeepSeekHarness({
  launch: {
    command: process.execPath,
    args: [RUNTIME_BIN, CONFIG],
    cwd: HARNESS_HOME,
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
    '请用 todo_write 工具建立一个包含 2 个任务的计划，并用 goal_create 工具创建一个目标叫「验证SQT推进」。然后回复「已建好」。',
    {
      sessionId: 'smoke2',
      onNotification: (n) => {
        if (n.method === 'session.event') {
          const e = n.params.event
          if (e && e.type) eventsSeen.push({ type: e.type, data: e.data })
        }
      },
    },
  )
  console.log('--- RESULT ---')
  console.log('finalResponse:', JSON.stringify(result.finalResponse?.slice(0, 400)))
  console.log('--- EVENTS (%d) ---', eventsSeen.length)
  const interesting = eventsSeen.filter(e => ['goal/change', 'todo/write', 'turn/start', 'turn/end', 'assistant/message'].includes(e.type))
  for (const ev of interesting) {
    console.log(' ', ev.type, JSON.stringify(ev.data ?? {}).slice(0, 400))
  }
  console.log('--- goal/change count:', eventsSeen.filter(e => e.type === 'goal/change').length)
  console.log('--- todo/write count:', eventsSeen.filter(e => e.type === 'todo/write').length)
  console.log('elapsedMs:', Date.now() - started)
} finally {
  await harness.close()
}
