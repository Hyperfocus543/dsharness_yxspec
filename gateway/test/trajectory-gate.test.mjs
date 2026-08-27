// gateStage 门控判定单测（Phase 1 门禁要求 3 个用例：verified / unverified / blocked）
// Phase 2 追加：派活前门控强制执行（lib/gate-enforce.mjs）——打回/放行/警告三路径
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
const { checkDispatchGate, gateAction, gateEnforceEnabled } = await import(
  pathToFileURL(join(process.cwd(), 'lib', 'gate-enforce.mjs')).href
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

console.log('== 5b) 无轨迹但产物已命中：放行不误打（产物先行场景）==')
{
  // sys_elicitation 的 spec_globs：project/specs/prd/prd-*.md → 造一个产物命中
  mkdirSync(join(TMP_PROJ, 'project', 'specs', 'prd'), { recursive: true })
  writeFileSync(join(TMP_PROJ, 'project', 'specs', 'prd', 'prd-001-需求.md'), '# PRD-001', 'utf8')
  const g = gateStage('sys_elicitation')
  assert('产物命中 + 无轨迹 → passed + 明确 reason', g.passed === true && g.reason === 'artifact-passed-no-trajectory', JSON.stringify(g))
}

console.log('== 5c) 未知阶段/原型属性 → unknown-stage（不是误放行）==')
{
  const g = gateStage('__proto__')
  assert('unknown-stage + passed=false（属性污染防护）', g.reason === 'unknown-stage' && g.passed === false, JSON.stringify(g))
  const g2 = gateStage('not-a-stage')
  assert('乱 token → unknown-stage', g2.reason === 'unknown-stage', JSON.stringify(g2))
}

console.log('== 6) 最近一次执行判定（latest 语义）==')
{
  const latest = latestTrajectory('sys_analysis')
  assert('latest = 最后写入的 seq=3（blocked）', latest?.seq === 3, JSON.stringify(latest?.seq))
  const all = listTrajectories('sys_analysis')
  assert('listTrajectories 时间升序 3 条', all.length === 3, String(all.length))
}

// =============================================================================
// Phase 2：派活前门控强制执行（gate-enforce.mjs）
// 场景顺序依赖：上面已写 sys_analysis 轨迹 seq1(verified)/seq2(unverified)/seq3(blocked)，
// latest=seq3(blocked) → gateStage 恒 blocked，因此打回路径直接复用 sys_analysis；
// 放行/警告路径用从未执行过的阶段（sys_elicitation / sys_arch）。
// =============================================================================
console.log('== 7) 派活前门控：强制开启（默认）==')
{
  const en = gateEnforceEnabled()
  assert('YXSPEC_GATE_ENFORCE 未设 → 默认开', en === true, String(en))
}

console.log('== 8) 打回：trajectory-blocked（latest=seq3 blocked）==')
{
  const g = gateStage('sys_analysis')
  assert('前置：sys_analysis 门控 = trajectory-blocked', g.reason === 'trajectory-blocked', g.reason)
  const dg = checkDispatchGate('sys_analysis')
  assert('applies（artifact+trajectory）', dg.applies === true, JSON.stringify(dg))
  assert('blocked=true → 拒绝派活', dg.blocked === true, JSON.stringify(dg))
  assert('reason=trajectory-blocked', dg.reason === 'trajectory-blocked', dg.reason)
  assert('无 warning', dg.warning === null, String(dg.warning))
}

console.log('== 9) 打回：no-trajectory（从未执行过 + 无产物）==')
{
  // sys_arch 无轨迹、无产物（spec_globs 未命中）→ gateStage reason=no-trajectory
  const g = gateStage('sys_arch')
  assert('前置：sys_arch = no-trajectory', g.reason === 'no-trajectory', g.reason)
  const dg = checkDispatchGate('sys_arch')
  assert('blocked=true → 拒绝派活', dg.blocked === true, JSON.stringify(dg))
  assert('reason=no-trajectory', dg.reason === 'no-trajectory', dg.reason)
}

console.log('== 10) 打回：artifact-passed-no-trajectory（产物在但无轨迹）==')
{
  // sys_elicitation 产物已命中（5b 造的 prd-*.md）且无轨迹 → 展示层 passed=true，
  // 但派活拦截（不开新 turn 盲跑）
  const g = gateStage('sys_elicitation')
  assert('前置：sys_elicitation = artifact-passed-no-trajectory', g.reason === 'artifact-passed-no-trajectory', g.reason)
  const dg = checkDispatchGate('sys_elicitation')
  assert('展示层 passed=true 但派活打回', dg.blocked === true, JSON.stringify(dg))
  assert('reason=artifact-passed-no-trajectory', dg.reason === 'artifact-passed-no-trajectory', dg.reason)
}

console.log('== 11) 警告：trajectory-unverified（轨迹缺关键证据）==')
{
  // swe_arch 造产物命中 + 一条 unverified 轨迹（无 turn/end + 全工具失败）
  mkdirSync(join(TMP_PROJ, 'project', 'specs', 'sw-arch'), { recursive: true })
  writeFileSync(join(TMP_PROJ, 'project', 'specs', 'sw-arch', 'sw-arch-01-测试.md'), '# SW-ARCH-001', 'utf8')
  mkdirSync(join(TMP_TRAJ, 'swe_arch'), { recursive: true })
  writeFileSync(join(TMP_TRAJ, 'swe_arch', 'swe_arch-001.jsonl'), JSON.stringify({
    stage: 'swe_arch', seq: 1, sessionId: 't', status: 'unverified', reason: null,
    startedAt: 1730000000000, finishedAt: 1730000005000, turnCount: 1, stepCount: 1,
    events: ['turn/start', 'tool/call', 'tool/result'],
    tools: [{ type: 'tool/call', name: 'x', ts: 1 }, { type: 'tool/result', name: 'c1', ok: false, error: 'EACCES', ts: 2 }],
    cost: { tokens: 1, inputTokens: 1, outputTokens: 0 },
  }) + '\n', 'utf8')
  const g = gateStage('swe_arch')
  assert('前置：swe_arch = trajectory-unverified', g.reason === 'trajectory-unverified', JSON.stringify(g))
  const dg = checkDispatchGate('swe_arch')
  assert('不拦截（blocked=false）', dg.blocked === false, JSON.stringify(dg))
  assert('warning 带原因', typeof dg.warning === 'string' && dg.warning.includes('trajectory-unverified'), String(dg.warning))
  // gateAction 纯判定（不依赖 env）
  const act = gateAction(g)
  assert('gateAction: warn=true', act.warn === true && act.block === false, JSON.stringify(act))
}

console.log('== 12) 放行：verified（产物 + 轨迹完整）==')
{
  // sqt_tr 造 verified 轨迹（turn/end + tool ok）；产物未命中（无 sqt-tr-*.md）？
  // 不行——产物必须命中才 verified。给 sqt_tr 造产物 + 轨迹。
  mkdirSync(join(TMP_PROJ, 'project', 'specs', 'sqt-tr'), { recursive: true })
  writeFileSync(join(TMP_PROJ, 'project', 'specs', 'sqt-tr', 'sqt-tr-01-测试.md'), '# TR-001', 'utf8')
  mkdirSync(join(TMP_TRAJ, 'sqt_tr'), { recursive: true })
  writeFileSync(join(TMP_TRAJ, 'sqt_tr', 'sqt_tr-001.jsonl'), JSON.stringify({
    stage: 'sqt_tr', seq: 1, sessionId: 't', status: 'passed', reason: 'completed',
    startedAt: 1730000000000, finishedAt: 1730000005000, turnCount: 1, stepCount: 1,
    events: ['turn/start', 'step/start', 'tool/call', 'tool/result', 'turn/end'],
    tools: [{ type: 'tool/call', name: 'create_goal', ts: 1 }, { type: 'tool/result', name: 'call_0', ok: true, ts: 2 }],
    cost: { tokens: 100, inputTokens: 80, outputTokens: 20 },
  }) + '\n', 'utf8')
  const g = gateStage('sqt_tr')
  assert('前置：sqt_tr = 门控通过', g.passed === true && g.reason === 'artifact+trajectory-passed', JSON.stringify(g))
  const dg = checkDispatchGate('sqt_tr')
  assert('放行（blocked=false）', dg.blocked === false, JSON.stringify(dg))
  assert('无 warning', dg.warning === null, String(dg.warning))
}

console.log('== 13) 不适用：artifact 策略阶段不受轨迹门控拦截 ==')
{
  // swe_coding_do gate_policy='artifact' → applies=false，直接放行（不查轨迹）
  const dg = checkDispatchGate('swe_coding_do')
  assert('applies=false（artifact 策略）', dg.applies === false, JSON.stringify(dg))
  assert('blocked=false', dg.blocked === false, JSON.stringify(dg))
}

console.log('== 14) 开关：YXSPEC_GATE_ENFORCE=0 → 强制关闭 ==')
{
  process.env.YXSPEC_GATE_ENFORCE = '0'
  assert('enforce=false（env=0）', gateEnforceEnabled() === false, String(gateEnforceEnabled()))
  const dg = checkDispatchGate('sys_analysis') // 即使门控 blocked 也不拦
  assert('applies=false（强制关闭）', dg.applies === false, JSON.stringify(dg))
  assert('blocked=false', dg.blocked === false, JSON.stringify(dg))
  process.env.YXSPEC_GATE_ENFORCE = 'false'
  assert('enforce=false（env=false）', gateEnforceEnabled() === false, String(gateEnforceEnabled()))
  process.env.YXSPEC_GATE_ENFORCE = '1'
  assert('enforce=true（env=1）', gateEnforceEnabled() === true, String(gateEnforceEnabled()))
  delete process.env.YXSPEC_GATE_ENFORCE
}

rmSync(TMP, { recursive: true, force: true })
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
