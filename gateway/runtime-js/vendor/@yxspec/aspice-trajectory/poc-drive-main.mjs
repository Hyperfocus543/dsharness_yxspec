// POC 冒烟：主 cordis.yml（含 aspice-trajectory 插件）→ 一个真实 turn → 轨迹 JSONL 落盘
// 用法（仓库根）：
//   HARNESS_HOME=... YXSPEC_WORKSPACE_CWD=... node gateway/runtime-js/vendor/@yxspec/aspice-trajectory/poc-drive-main.mjs
import { pathToFileURL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const HARNESS_HOME = process.env.HARNESS_HOME ?? 'D:/AI/deepseek-harness-master'
const WORKSPACE = process.env.YXSPEC_WORKSPACE_CWD ?? 'D:/Work/01_Projects/Aima_X1_BCM'
const sdkClient = await import(pathToFileURL(`${HARNESS_HOME}/packages/sdk/client/lib/index.js`).href)
const { DeepSeekHarness } = sdkClient

const credRaw = (() => { try { return readFileSync('C:/Users/Administrator/.dsh/.credentials.yaml', 'utf8') } catch { return '' } })()
const keyMatch = (name) => credRaw.match(new RegExp(`^${name}:\s*(.+)`, 'm'))?.[1]?.trim()
const RUN_ENV = {
  ...process.env,
  DSH_HOME: 'C:/Users/Administrator/.dsh',
  ...(keyMatch('MINIMAX_CN_API_KEY') ? { MINIMAX_CN_API_KEY: keyMatch('MINIMAX_CN_API_KEY') } : {}),
  // 轨迹写临时目录，不污染仓库 runtime-data（冒烟专用）
  YXSPEC_TRAJECTORY_ROOT: join(process.cwd(), 'runtime-data-smoke'),
}

const MAIN_YML = join(process.cwd(), 'gateway', 'runtime-js', 'config', 'cordis.yml')
const RUNTIME_BIN = `${HARNESS_HOME}/packages/examples/jsonrpc-demo/lib/bin.js`

const harness = new DeepSeekHarness({
  launch: {
    command: process.execPath,
    args: [RUNTIME_BIN, MAIN_YML],
    cwd: HARNESS_HOME,
    env: RUN_ENV,
  },
  cwd: WORKSPACE,
  provider: 'minimax-cn',
  model: 'MiniMax-M3',
  maxTokens: 8192,
})

try {
  const result = await harness.run('请执行 /yxspec:swe-static-verify 阶段：一句话说明你会做什么，不需要真正生成文件。', {
    sessionId: `poc-traj-main-${Date.now()}`,
    onNotification: () => {},
  })
  console.log('--- finalResponse:', JSON.stringify(result.finalResponse?.slice(0, 100)))
  console.log('--- sessionId:', result.sessionId)
} finally {
  await harness.close()
}

// 检查轨迹落盘
const root = RUN_ENV.YXSPEC_TRAJECTORY_ROOT
const candidates = []
const scan = (dir) => {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir)) {
    const abs = join(dir, e)
    if (statSync(abs).isDirectory()) scan(abs)
    else if (e.endsWith('.jsonl')) candidates.push(abs)
  }
}
import { readdirSync, statSync } from 'node:fs'
scan(root)
console.log('--- 轨迹文件:')
for (const c of candidates) {
  console.log(' ', c.replace(root, ''), '->', readFileSync(c, 'utf8').trim().slice(0, 300))
}
if (candidates.length === 0) {
  console.log('  (无轨迹落盘)')
  process.exitCode = 1
}
