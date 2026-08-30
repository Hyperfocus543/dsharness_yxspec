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
import { mkdirSync, writeFileSync, rmSync, readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const TMP = join(tmpdir(), 'yxspec-traj-test-' + Date.now())
const TMP_PROJ = join(TMP, 'proj')
const TMP_TRAJ = join(TMP, 'trajectory')
process.env.YXSPEC_PROJECT_ROOT = TMP_PROJ
process.env.YXSPEC_TRAJECTORY_ROOT = TMP_TRAJ

// 造产物命中：sys_analysis 的 spec_globs 之一是 project/specs/sys/sys-req-*.md
mkdirSync(join(TMP_PROJ, 'project', 'specs', 'sys'), { recursive: true })
writeFileSync(join(TMP_PROJ, 'project', 'specs', 'sys', 'sys-req-01-测试.md'), '# SR-001', 'utf8')

const { gateStage, latestTrajectory, listTrajectories, rollbackTrajectory, exportOtelGenAi, isValidRollbackId, trajectoryAll } = await import(
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
  events: ['turn/start', 'step/start', 'assistant/message', 'tool/call', 'tool/result', 'turn/end'],
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
    events: ['turn/start', 'step/start', 'assistant/message', 'tool/call', 'tool/result', 'turn/end'],
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

// =============================================================================
// Phase 3：回滚协议 + OTel GenAI 导出（3.3 / 3.4 节）
// 用独立阶段 sqt_strategy 验证：不污染上面 Phase 2 的 latest=blocked 场景。
// 写两条轨迹（seq1 passed / seq2 passed 带 git 起始 commit），回滚最新 seq2。
// =============================================================================
console.log('== 15) 回滚协议：标记最新轨迹 rolled_back + 审计留档 ==')
{
  mkdirSync(join(TMP_TRAJ, 'sqt_strategy'), { recursive: true })
  writeFileSync(join(TMP_TRAJ, 'sqt_strategy', 'sqt_strategy-001.jsonl'), JSON.stringify(
    mkRec('sqt_strategy', 1, { sessionId: 's1' }),
  ) + '\n', 'utf8')
  writeFileSync(join(TMP_TRAJ, 'sqt_strategy', 'sqt_strategy-002.jsonl'), JSON.stringify(
    mkRec('sqt_strategy', 2, { sessionId: 's2', git: { commit: 'abc123def' } }),
  ) + '\n', 'utf8')

  const r = rollbackTrajectory('sqt_strategy', null, 'trajectory-blocked')
  assert('ok + rollbackId=<stage>-<seq>', r.ok === true && r.rollbackId === 'sqt_strategy-2', JSON.stringify(r))
  assert('seq 指向最新轨迹', r.seq === 2, String(r.seq))
  assert('回滚指令含 git reset（对齐 guard.sh 块起始）', Array.isArray(r.instructions) && r.instructions.some((i) => i.includes('git reset --hard abc123def')), JSON.stringify(r.instructions))
  assert('rollbackCommit 来自轨迹 git 起始 commit', r.rollbackCommit === 'abc123def', String(r.rollbackCommit))
  assert('降级指令含 re-run 命令', r.command === '/yxspec:sqt-strategy', String(r.command))

  // append-only 审计：JSONL 尾部追加 rollback 行，原行未被改写
  const lines = readFileSync(join(TMP_TRAJ, 'sqt_strategy', 'sqt_strategy-002.jsonl'), 'utf8').trim().split('\n')
  assert('JSONL 共 2 行（原记录 + rollback 审计行）', lines.length === 2, String(lines.length))
  const rb = JSON.parse(lines[1])
  assert('审计行 type=rollback + rollbackId + reason + at', rb.type === 'rollback' && rb.rollbackId === 'sqt_strategy-2' && rb.reason === 'trajectory-blocked' && typeof rb.at === 'number', JSON.stringify(rb))
  assert('原记录行未被改写（无 type 字段）', !JSON.parse(lines[0]).type, lines[0].slice(0, 80))

  // 合并语义：latest 记录带 rolled_back 标记
  const latest = latestTrajectory('sqt_strategy')
  assert('latest 合并 rolled_back=true + rollbackId', latest?.rolled_back === true && latest?.rollbackId === 'sqt_strategy-2', JSON.stringify(latest))
}

console.log('== 16) 回滚幂等：同一 rollbackId 重复 → already，不重复追加 ==')
{
  const r2 = rollbackTrajectory('sqt_strategy', 'sqt_strategy-2', 'again')
  assert('already=true + 同一 rollbackId', r2.ok === true && r2.already === true && r2.rollbackId === 'sqt_strategy-2', JSON.stringify(r2))
  const lines = readFileSync(join(TMP_TRAJ, 'sqt_strategy', 'sqt_strategy-002.jsonl'), 'utf8').trim().split('\n')
  assert('幂等不追加（仍 2 行）', lines.length === 2, String(lines.length))
  const r3 = rollbackTrajectory('sqt_strategy', 'sqt_strategy-1', 'rollback-older')
  assert('回滚旧轨迹也允许（id 显式指定）', r3.ok === true && r3.already === false && r3.seq === 1, JSON.stringify(r3))
  const lines3 = readFileSync(join(TMP_TRAJ, 'sqt_strategy', 'sqt_strategy-001.jsonl'), 'utf8').trim().split('\n')
  assert('旧轨迹文件追加 rollback 行', lines3.length === 2, String(lines3.length))
  // 回归：重复回滚同一条旧轨迹（显式 id）必须幂等，不得再追加审计行
  const r4 = rollbackTrajectory('sqt_strategy', 'sqt_strategy-1', 'again-2')
  assert('重复回滚同一旧轨迹 → already=true', r4.ok === true && r4.already === true, JSON.stringify(r4))
  const lines4 = readFileSync(join(TMP_TRAJ, 'sqt_strategy', 'sqt_strategy-001.jsonl'), 'utf8').trim().split('\n')
  assert('旧轨迹仍 2 行（幂等）', lines4.length === 2, String(lines4.length))
}

console.log('== 17) 回滚边界：未知阶段 / 无轨迹 / rollbackId 校验 ==')
{
  const bad = rollbackTrajectory('not-a-stage')
  assert('未知阶段 → error=unknown-stage', bad.ok === false && bad.error === 'unknown-stage', JSON.stringify(bad))
  const noTraj = rollbackTrajectory('sys_arch') // 从未执行过
  assert('无轨迹 → error=no-trajectory', noTraj.ok === false && noTraj.error === 'no-trajectory', JSON.stringify(noTraj))
  assert('rollbackId 形态校验通过', isValidRollbackId('swe_coding_do', 'swe_coding_do-7') === true)
  assert('rollbackId 形态校验拒绝错 stage', isValidRollbackId('swe_coding_do', 'sys_analysis-7') === false)
  assert('rollbackId 形态校验拒绝非法 seq', isValidRollbackId('swe_coding_do', 'swe_coding_do-x') === false)
}

console.log('== 18) 回滚 → 门控联动：rolled_back 后门控 blocked 打回 ==')
{
  // sqt_strategy 是 review_gate 阶段（artifact+trajectory），回滚后 latest 带 rolled_back。
  // 补产物命中（project/specs/sqt-tp/sqt-tp-*.md）——否则门控先报 artifact-missing，
  // 测不出轨迹维度打回。
  mkdirSync(join(TMP_PROJ, 'project', 'specs', 'sqt-tp'), { recursive: true })
  writeFileSync(join(TMP_PROJ, 'project', 'specs', 'sqt-tp', 'sqt-tp-01-测试.md'), '# TP-001', 'utf8')
  const g = gateStage('sqt_strategy')
  assert('rolled_back → 轨迹三态 blocked', g.trajectory?.status === 'blocked', JSON.stringify(g.trajectory))
  assert('门控 reason=trajectory-blocked（打回）', g.passed === false && g.reason === 'trajectory-blocked', g.reason)
  const dg = checkDispatchGate('sqt_strategy')
  assert('派活拦截 blocked=true', dg.blocked === true, JSON.stringify(dg))
}

console.log('== 19) 回滚后 re-run：新轨迹 seq3 通过 → 门控恢复放行 ==')
{
  writeFileSync(join(TMP_TRAJ, 'sqt_strategy', 'sqt_strategy-003.jsonl'), JSON.stringify(
    mkRec('sqt_strategy', 3, { sessionId: 's3', startedAt: 1730000100000 }),
  ) + '\n', 'utf8')
  const g = gateStage('sqt_strategy')
  assert('新轨迹最新（seq3）→ 门控恢复 verified 放行', g.passed === true && g.reason === 'artifact+trajectory-passed', JSON.stringify(g))
  assert('latest=seq3（回滚不阻塞后续执行）', latestTrajectory('sqt_strategy')?.seq === 3, String(latestTrajectory('sqt_strategy')?.seq))
}

console.log('== 20) 回滚降级指令：无 git 起始 commit → re-run 提示 ==')
{
  // swe_integration_verify 无产物、无 git 记录（回滚后 OTel 章节不再用它）
  mkdirSync(join(TMP_TRAJ, 'swe_integration_verify'), { recursive: true })
  writeFileSync(join(TMP_TRAJ, 'swe_integration_verify', 'swe_integration_verify-001.jsonl'), JSON.stringify(
    mkRec('swe_integration_verify', 1, { sessionId: 's4' }),
  ) + '\n', 'utf8')
  const r = rollbackTrajectory('swe_integration_verify', null, 'failed')
  assert('无 git commit → rollbackCommit=null', r.ok === true && r.rollbackCommit === null, JSON.stringify(r))
  assert('指令含 re-run 命令提示', r.instructions.some((i) => i.includes('/yxspec:swe-integration-verify')), JSON.stringify(r.instructions))
}

// =============================================================================
// OTel GenAI 导出（3.4 节）：Langfuse/LangSmith 可消费格式
// 用未回滚的 sqt_tr（verified）做干净样本：turn + assistant/message + 工具对
// =============================================================================
console.log('== 21) OTel 导出：spans 结构（gen_ai 语义约定）==')
{
  const out = exportOtelGenAi('sqt_tr')
  assert('导出非空 + trace_id=stage', out !== null && out.trace_id === 'sqt_tr', JSON.stringify(out?.trace_id))
  assert('resource.service.name=yxspec-studio', out.resource['service.name'] === 'yxspec-studio', JSON.stringify(out.resource))
  assert('span_count > 0', out.span_count > 0, String(out.span_count))
  const kinds = new Set(out.spans.map((s) => s.kind))
  assert('span kind ∈ {client}', [...kinds].every((k) => k === 'client'), JSON.stringify([...kinds]))
  const ids = out.spans.map((s) => s.span_id)
  assert('span_id 唯一', new Set(ids).size === ids.length, ids.join(','))
  const t0 = out.spans[0]
  assert('span 时间戳为 unix_nano', typeof t0.start_time_unix_nano === 'number' && Number.isFinite(t0.start_time_unix_nano), String(t0.start_time_unix_nano))
  // 必要字段断言（Langfuse 可消费）：name/kind/trace_id/span_id/attributes
  for (const s of out.spans) {
    assert(`span 必要字段（${s.name}）`, typeof s.name === 'string' && s.kind && s.trace_id === 'sqt_tr' && typeof s.span_id === 'string' && s.attributes && typeof s.attributes === 'object', JSON.stringify(s).slice(0, 120))
  }
}

console.log('== 22) OTel 导出：turn/start 含 token 用量 ==')
{
  const out = exportOtelGenAi('sqt_tr')
  const turn = out.spans.find((s) => s.name === 'turn/start')
  assert('turn/start span 存在', Boolean(turn), JSON.stringify(out.spans.map((s) => s.name)))
  assert('gen_ai.usage.input_tokens=80', turn.attributes['gen_ai.usage.input_tokens'] === 80, JSON.stringify(turn.attributes))
  assert('gen_ai.usage.output_tokens=20', turn.attributes['gen_ai.usage.output_tokens'] === 20, JSON.stringify(turn.attributes))
  assert('gen_ai.usage.total_tokens=100', turn.attributes['gen_ai.usage.total_tokens'] === 100, JSON.stringify(turn.attributes))
  assert('yxspec.trajectory.status=passed', turn.attributes['yxspec.trajectory.status'] === 'passed', JSON.stringify(turn.attributes))
  assert('turn span parent=null（根）', turn.parent_span_id === null, String(turn.parent_span_id))
}

console.log('== 23) OTel 导出：assistant/message span ==')
{
  const out = exportOtelGenAi('sqt_tr')
  const msg = out.spans.find((s) => s.name === 'assistant/message')
  assert('assistant/message span 存在', Boolean(msg), JSON.stringify(out.spans.map((s) => s.name)))
  assert('message span parent=turn/start', msg.parent_span_id === '1.turn1', String(msg.parent_span_id))
  assert('usage 属性在 message span', msg.attributes['gen_ai.usage.input_tokens'] === 80, JSON.stringify(msg.attributes))
}

console.log('== 24) OTel 导出：tool/call + tool/result 成对 ==')
{
  const out = exportOtelGenAi('sqt_tr')
  const tools = out.spans.filter((s) => s.name.startsWith('tool/'))
  assert('工具 span 存在（call + result 成对）', tools.length === 2, JSON.stringify(tools.map((s) => s.name)))
  const call = tools.find((s) => s.name === 'tool/create_goal')
  const result = tools.find((s) => s.name === 'tool/create_goal/result')
  assert('gen_ai.tool.name=create_goal', call?.attributes['gen_ai.tool.name'] === 'create_goal', JSON.stringify(call?.attributes))
  assert('result parent=tool call span', result?.parent_span_id === call?.span_id, `${result?.parent_span_id} vs ${call?.span_id}`)
  assert('result 属性带 yxspec.trajectory.ok=true', result?.attributes['yxspec.trajectory.ok'] === true, JSON.stringify(result?.attributes))
  assert('call 属性含 tool.input（arguments）', call?.attributes['gen_ai.tool.input'] !== undefined, JSON.stringify(call?.attributes))
}

console.log('== 25) OTel 导出：回滚轨迹标注 + 失败工具 + 多阶段隔离 ==')
{
  const out = exportOtelGenAi('sqt_strategy') // 该阶段回滚过（seq1/2 回滚 + seq3 通过）
  assert('rolled_back 轨迹 → resource 标注', out.resource['yxspec.trajectory.status'] === 'rolled_back', JSON.stringify(out.resource))
  const rows = out.spans.filter((s) => s.name.startsWith('turn/'))
  assert('每个执行记录一条 turn span（seq1/2 回滚 + seq3 通过 = 3）', rows.length === 3, String(rows.length))
  // 回滚记录的 turn span 属性带 rollback_id
  const rolledTurn = rows.find((s) => s.span_id === '2.turn1')
  assert('回滚 seq2 turn span 带 yxspec.trajectory.rollback_id', rolledTurn?.attributes['yxspec.trajectory.rollback_id'] === 'sqt_strategy-2', JSON.stringify(rolledTurn?.attributes))
  assert('回滚 seq2 turn span 状态标注 rolled_back', rolledTurn?.attributes['yxspec.trajectory.status'] === 'rolled_back', JSON.stringify(rolledTurn?.attributes))
  // 失败工具结果：构造一条 ok=false 的工具对 → gen_ai.tool.error 属性
  mkdirSync(join(TMP_TRAJ, 'swe_unit_verify'), { recursive: true })
  writeFileSync(join(TMP_TRAJ, 'swe_unit_verify', 'swe_unit_verify-001.jsonl'), JSON.stringify({
    stage: 'swe_unit_verify', seq: 1, sessionId: 't', status: 'failed', reason: 'error',
    startedAt: 1730000200000, finishedAt: 1730000205000, turnCount: 1, stepCount: 1,
    events: ['turn/start', 'assistant/message', 'tool/call', 'tool/result', 'turn/end'],
    tools: [
      { type: 'tool/call', name: 'bash', callId: 'c1', ts: 1730000200100 },
      { type: 'tool/result', name: 'bash', ok: false, error: 'EACCES', ts: 1730000200200 },
    ],
    cost: { tokens: 5, inputTokens: 3, outputTokens: 2 },
    reason: 'error',
  }) + '\n', 'utf8')
  const failed = exportOtelGenAi('swe_unit_verify')
  const res = failed.spans.find((s) => s.name === 'tool/bash/result')
  assert('失败工具 result 带 gen_ai.tool.error', res?.attributes['gen_ai.tool.error'] === 'EACCES', JSON.stringify(res?.attributes))
  const other = exportOtelGenAi('sys_analysis') // 未回滚阶段
  assert('未回滚阶段 resource 无 rolled_back 标注', other.resource['yxspec.trajectory.status'] === undefined, JSON.stringify(other.resource))
  assert('未知阶段 → null', exportOtelGenAi('not-a-stage') === null, String(exportOtelGenAi('not-a-stage')))
  assert('无轨迹阶段 → null', exportOtelGenAi('sys_arch') === null, String(exportOtelGenAi('sys_arch')))
}

// =============================================================================
// trajectoryAll ?root= 显式工作区（多工作区下轨迹 × git 按活动 root 拉）
// 复刻真实多仓库场景：本地临时 git 仓库 A（已打 yxspec tag）+ 显式 root 参数 →
// 轨迹流的 commit/tag 应解析自 A；缺省 root（本仓库非空 git 仓库）→ gitAvailable
// 且 commit 存在（但 tag 不指向 A 的 yxspec tag）。断言显式 root 被真正采用。
// =============================================================================
console.log('== 26) trajectoryAll 显式 root（?root= 解析工作区）==')
{
  const repoA = join(TMP, 'repoA')
  mkdirSync(repoA, { recursive: true })
  writeFileSync(join(repoA, 'init.txt'), 'init', 'utf8')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoA })
  execFileSync('git', ['add', '-A'], { cwd: repoA })
  execFileSync('git', ['-c', 'user.email=test@local', '-c', 'user.name=test', 'commit', '-q', '-m', 'probe'], { cwd: repoA })
  const commitA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoA }).toString().trim()
  execFileSync('git', ['tag', 'yxspec/sys_analysis/1', commitA], { cwd: repoA })
  const shortA = commitA.slice(0, 7)

  // 该阶段造一条轨迹（startedAt 用当前时间附近，保证能解析出 commit）
  const st = Date.now()
  writeTraj('sqt_strategy', 30, mkRec('sqt_strategy', 30, { sessionId: 't30', startedAt: st, status: 'passed' }))

  // 显式 root=repoA → 轨迹流按 A 解析 git 增强
  // （root 断言以 git 规范化为准：os.tmpdir() 可能返回 8.3 短路径如 ADMINI~1，
  //  而 git --show-toplevel 会展开成完整路径 → 期望值取自 git 本身）
  const repoANorm = execFileSync('git', ['-C', repoA, 'rev-parse', '--show-toplevel'], { cwd: repoA }).toString().trim().replace(/\\/g, '/')
  const allA = await trajectoryAll(200, repoANorm)
  const rowA = (allA.rows ?? []).find((r) => r.stage === 'sqt_strategy' && r.seq === 30)
  assert('显式 root → gitAvailable=true', allA.gitAvailable === true, JSON.stringify(allA.gitAvailable))
  assert('显式 root → root 指向 repoA', allA.root === repoANorm, JSON.stringify(allA.root))
  assert('显式 root → 该行 commit 解析自 repoA', rowA?.commit === shortA, JSON.stringify(rowA && { commit: rowA.commit, tag: rowA.tag }))
  assert('显式 root → tag 命中 repoA 的 yxspec tag', rowA?.tag === 'yxspec/sys_analysis/1', JSON.stringify(rowA?.tag))
  assert('显式 root → tagCommit 指向该 tag 的 commit', rowA?.tagCommit === commitA, JSON.stringify(rowA?.tagCommit))
  assert('显式 root → 该行 tag 精确对位（commit/tagCommit 前缀一致）', hasTagAt(rowA), JSON.stringify(rowA && { commit: rowA.commit, tagCommit: rowA.tagCommit }))

  // 缺省 root（本仓库：非空 git 仓库）→ gitAvailable 且该行 commit 存在，
  // 但 tag 不指向 repoA 的 yxspec tag（跨仓库隔离，不串 tag）
  const allDef = await trajectoryAll(200)
  const rowDef = (allDef.rows ?? []).find((r) => r.stage === 'sqt_strategy' && r.seq === 30)
  assert('缺省 root → gitAvailable=true（本仓库）', allDef.gitAvailable === true, JSON.stringify(allDef.gitAvailable))
  assert('缺省 root → 该行 commit 存在', typeof rowDef?.commit === 'string' && rowDef.commit.length >= 7, JSON.stringify(rowDef?.commit))
  assert('缺省 root → 不串 repoA 的 yxspec tag', (rowDef?.tag ?? null) !== 'yxspec/sys_analysis/1', JSON.stringify(rowDef?.tag))
}

function hasTagAt(r) {
  if (!r?.tag || !r?.tagCommit || !r?.commit) return false
  return r.tagCommit === r.commit || r.tagCommit.startsWith(r.commit) || r.commit.startsWith(r.tagCommit)
}

rmSync(TMP, { recursive: true, force: true })
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)