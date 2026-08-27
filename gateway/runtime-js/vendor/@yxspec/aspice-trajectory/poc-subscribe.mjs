// POC: session/event 可达性验证（最小探针，不写仓库）
// 用法（在仓库根运行）：
//   HARNESS_HOME=D:/AI/deepseek-harness-master \
//   YXSPEC_WORKSPACE_CWD=D:/Work/01_Projects/Aima_X1_BCM \
//   node gateway/runtime-js/vendor/@yxspec/aspice-trajectory/poc-subscribe.mjs
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'

const HARNESS_HOME = process.env.HARNESS_HOME ?? 'D:/AI/deepseek-harness-master'
const WORKSPACE = process.env.YXSPEC_WORKSPACE_CWD ?? 'D:/Work/01_Projects/Aima_X1_BCM'
const sdkClient = await import(pathToFileURL(`${HARNESS_HOME}/packages/sdk/client/lib/index.js`).href)
const { DeepSeekHarness } = sdkClient

// 注入与 start-gateway.mjs 相同的环境（DSH_HOME + credentials key）
const { readFileSync } = await import('node:fs')
const credRaw = (() => { try { return readFileSync('C:/Users/Administrator/.dsh/.credentials.yaml', 'utf8') } catch { return '' } })()
const keyMatch = (name) => credRaw.match(new RegExp(`^${name}:\s*(.+)`, 'm'))?.[1]?.trim()
const RUN_ENV = {
  ...process.env,
  DSH_HOME: 'C:/Users/Administrator/.dsh',
  ...(keyMatch('DEEPSEEK_API_KEY') ? { DEEPSEEK_API_KEY: keyMatch('DEEPSEEK_API_KEY') } : {}),
  ...(keyMatch('MINIMAX_CN_API_KEY') ? { MINIMAX_CN_API_KEY: keyMatch('MINIMAX_CN_API_KEY') } : {}),
}

const RUNTIME_BIN = `${HARNESS_HOME}/packages/examples/jsonrpc-demo/lib/bin.js`

// 合成装配：主 cordis.yml + 本探针插件（根 ctx 订阅 session/event + 落盘）
const VENDOR = fileURLToPath(new URL('..', import.meta.url))
const POC_PLUGIN = `${VENDOR}/poc-listener.mjs`
const POC_YML = `${VENDOR}/cordis-poc-trajectory.yml`
const MAIN_YML = fileURLToPath(new URL('../../../config/cordis.yml', import.meta.url))
let main = readFileSync(MAIN_YML, 'utf8')
main += `
# ---- POC: trajectory 订阅探针（临时）----
- id: poc-trajectory-listener
  name: '${pathToFileURL(POC_PLUGIN).href}'
`
mkdirSync(VENDOR, { recursive: true })
writeFileSync(POC_YML, main, 'utf8')

const harness = new DeepSeekHarness({
  launch: {
    command: process.execPath,
    args: [RUNTIME_BIN, POC_YML],
    cwd: HARNESS_HOME,
    env: RUN_ENV,
  },
  cwd: WORKSPACE,
  provider: 'minimax-cn',
  model: 'MiniMax-M3',
  maxTokens: 4096,
})

const eventsSeen = []
const started = Date.now()
try {
  const result = await harness.run('一句话回答：1+1=？（不需要写任何文件）', {
    sessionId: 'poc-trajectory',
    onNotification: (n) => {
      if (n.method === 'session.event') {
        const e = n.params.event
        if (e && e.type) eventsSeen.push({ type: e.type, seq: e.seq, data: e.data })
      }
    },
  })
  const kinds = [...new Set(eventsSeen.map((e) => e.type))]
  console.log('--- SDK 侧收到 event kinds:', kinds.join(', '))
  console.log('--- 总数:', eventsSeen.length)
  for (const ev of eventsSeen.slice(0, 12)) {
    console.log(' ', ev.type, JSON.stringify(ev.data ?? {}).slice(0, 240))
  }
  console.log('--- RESULT sessionId:', result.sessionId, 'finalResponse:', JSON.stringify(result.finalResponse?.slice(0, 120)))
  console.log('--- 插件落盘文件（探针写）：')
  console.log('--- elapsedMs:', Date.now() - started)
} finally {
  await harness.close()
}
