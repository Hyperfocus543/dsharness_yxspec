// gateStage 门控判定单测（Phase 1 门禁要求 3 个用例：verified / unverified / blocked）
// 运行：cd gateway && node test/trajectory-gate.test.mjs
// 说明：lib/trajectory.mjs 读 runtime-data/trajectory（env YXSPEC_TRAJECTORY_ROOT
// 可覆盖）。测试用临时目录写三条轨迹 JSONL，分别断言三态：
//   - artifact 策略（无 review_gate 阶段，如 swe_coding_do）：产物命中即过
//   - artifact+trajectory 策略（有 review_gate 阶段，如 sys_analysis）：
//       verified  → turn/end + tool/result ok → passed
//       unverified → 轨迹缺 turn/end → 不 passed（警告）
//       blocked   → 轨迹 status=blocked → 不 passed（打回）
// 测试不依赖真实产物：用 spec_globs 恒空的阶段（swe_sdk_release 等）避产物扫描？
// 不行 —— 无 glob 阶段 globs.length===0 → artifactPassed=true 恒真，会污染三态。
// 因此选有 glob 的阶段，并临时造一个最小命中文件（env YXSPEC_PROJECT_ROOT 指向
// 测试临时项目根，glob 命中 `project/specs/sys/sys-req-*.md` 才算 artifact passed）。
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const TMP = join(tmpdir(), 'yxspec-traj-test-' + Date.now())
const TMP_PROJ = join(TMP, 'proj')
const TMP_TRAJ = join(TMP, 'trajectory')
process.env.YXSPEC_PROJECT_ROOT = TMP_PROJ
process.env.YXSPEC_TRAJECTORY_ROOT = TMP_TRAJ

// 造产物命中：sys_analysis 的 spec_globs 之一是 project/specs/sys/sys-req-*.md
mkdirSync(join(TMP_PROJ, 'project', 'specs', 'sys'), { recursive: true })
writeFileSync(join(TMP_PROJ, 'project', 'specs', 'sys', 'sys-req-01-测试.md'), '# SR-001', 'utf8')

const { gateStage, latestTrajectory, listTrajectories } = await import(
  pathToFileURL(join(process.cwd(), 'lib', 'trajectory.mjs')).href
)

let pass = 0
let fail = 0
const assert = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ok  ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name} ${extra}`)
  }
}

const writeTraj = (stage, seq, rec) => {
  const dir = join(TMP_TRAJ, stage)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${stage}-${String(seq).padStart(3, '0')}.jsonl`), JSON.stringify(rec) + '\n', 'utf8')
}

const mkRec = (stage, seq, over = {}) => ({
  stage,
  seq,
  sessionId: 'test-session',
  status: 'passed',
  startedAt: 1730000000000,
  finishedAt: 1730000005000,
  turnCount: 1,
  stepCount: 1,
  events: ['turn/start', 'step/start', 'tool/call', 'tool/result', 'turn/end'],
  tools: [
    { type: 'tool/call', name: 'create_goal', ts: 1730000000100 },
    { type: 'tool/result', name: 'call_0', ok: true, ts: 1730000000200 },
  ],
  cost: { tokens: 1234, inputTokens: 1000, outputTokens: 234 },
  reason: 'completed',
  ...over,
})

console.log('== 1) artifact 策略（swe_coding_do，无轨迹也过）==')
{
  const g = gateStage('swe_coding_do')
  assert('gate_policy 默认 artifact', g.gate_policy === 'artifact', JSON.stringify(g))
  assert('无轨迹 + 无产物 → 不 passed', g.passed === false, g.reason)
  // 产物造一个 coding-result 命中
  mkdirSync(join(TMP_PROJ, 'project', 'tasks', 'coding-do'), { recursive: true })
  writeFileSync(join(TMP_PROJ, 'project', 'tasks', 'coding-do', 'coding-result-MOD-01.md'), '# done', 'utf8')
  const g2 = gateStage('swe_coding_do')
  assert('产物命中 → passed（artifact 策略不看轨迹）', g2.passed === true, g2.reason)
}

console.log('== 2) artifact+trajectory：verified（sys_analysis）==')
{
  writeTraj('sys_analysis', 1, mkRec('sys_analysis', 1, { status: 'passed', reason: 'completed' }))
  const g = gateStage('sys_analysis')
  assert('gate_policy = artifact+trajectory', g.gate_policy === 'artifact+trajectory', g.gate_policy)
  assert('轨迹证据 verified', g.trajectory?.status === 'verified', JSON.stringify(g.trajectory))
  assert('产物命中 + 轨迹完整 → passed', g.passed === true, g.reason)
}

console.log('== 3) artifact+trajectory：unverified（缺 turn/end 或全工具失败）==')
{
  writeTraj('sys_analysis', 2, mkRec('sys_analysis', 2, {
    status: 'unverified',
    reason: null,
    events: ['turn/start', 'tool/call', 'tool/result'],
    tools: [{ type: 'tool/call', name: 'x', ts: 1 }, { type: 'tool/result', name: 'c1', ok: false, error: 'EACCES', ts: 2 }],
  }))
  const g = gateStage('sys_analysis')
  assert('轨迹证据 unverified（无 turn/end）', g.trajectory?.status === 'unverified', JSON.stringify(g.trajectory))
  assert('unverified → 不 passed（警告可配降级）', g.passed === false, g.reason)
}

console.log('== 4) artifact+trajectory：blocked（轨迹失败/中断）==')
{
  writeTraj('sys_analysis', 3, mkRec('sys_analysis', 3, { status: 'blocked', reason: 'interrupted' }))
  const g = gateStage('sys_analysis')
  assert('轨迹证据 blocked', g.trajectory?.status === 'blocked', JSON.stringify(g.trajectory))
  assert('blocked → 不 passed（打回）', g.passed === false, g.reason === 'trajectory-blocked', g.reason)
}

console.log('== 5) 无轨迹：no-trajectory → unverified ==')
{
  const g = gateStage('sys_elicitation') // 无轨迹记录
  assert('未执行过 → unverified + no-trajectory', g.status === 'unverified' && g.reason === 'no-trajectory', JSON.stringify(g))
}

console.log('== 6) 最近一次执行判定（latest 语义）==')
{
  const latest = latestTrajectory('sys_analysis')
  assert('latest = 最后写入的 seq=3（blocked）', latest?.seq === 3, JSON.stringify(latest?.seq))
  const all = listTrajectories('sys_analysis')
  assert('listTrajectories 时间升序 3 条', all.length === 3, String(all.length))
}

rmSync(TMP, { recursive: true, force: true })
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
