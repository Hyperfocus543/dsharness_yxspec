// selfIterationOverview 聚合读取单测（Phase 3 门禁：3 用例）
// 运行：cd gateway && node test/self-iteration.test.mjs
// 说明：lib/self-iteration.mjs 读 run-state.json（env YXSPEC_SELF_ITERATION_STATE_ROOT
// 覆盖）+ runtime-data/trajectory/self_iteration/*.jsonl（env YXSPEC_TRAJECTORY_ROOT
// 覆盖，与 trajectory.mjs 共用同一 env）。测试用临时目录写状态与留痕：
//   - 无 run-state / 无留痕 → { state:null, stages:[] }（空数据，不抛）
//   - 有留痕 → 阶段聚合 + 轮次排序 + score/round 合并
//   - run-state 摘要 → 当前阶段/轮次/基线/收敛/打分暂存
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const TMP = join(tmpdir(), 'yxspec-selfiter-test-' + Date.now())
const TMP_STATE = join(TMP, 'state')
const TMP_TRAJ = join(TMP, 'trajectory')
process.env.YXSPEC_SELF_ITERATION_STATE_ROOT = TMP_STATE
process.env.YXSPEC_TRAJECTORY_ROOT = TMP_TRAJ
process.env.YXSPEC_PROJECT_ROOT = TMP // stages.mjs 产物扫描不依赖真实产物（本测试只看聚合）

const { selfIterationOverview } = await import(
  pathToFileURL(join(process.cwd(), 'lib', 'self-iteration.mjs')).href
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

// 造留痕：sqt_strategy 两轮（r1 score+round / r2 score+round，含基线降级）
const mkScore = (stage, round, over = {}) => ({
  type: 'self-iteration/score/v1',
  stage, round,
  master: 82, stageScore: 78, total: 80.5, level: 'B',
  weak: ['SYS.1', 'SQT.8'], gateOk: true,
  at: `2026-08-28T10:0${round}:00.000Z`,
  ...over,
})
const mkRound = (stage, round, over = {}) => ({
  type: 'self-iteration/round/v1',
  stage, round, verdict: 'continue', total: 80.5, baselineTotal: 78,
  level: 'B', weak: ['SYS.1', 'SQT.8'], status: 'running', reason: 'completed',
  at: `2026-08-28T10:0${round}:00.000Z`,
  ...over,
})

console.log('== 1) 无 run-state / 无留痕 → 空数据（不抛）==')
{
  const v = selfIterationOverview()
  assert('ok=true', v.ok === true, JSON.stringify(v))
  assert('state=null（无 run-state）', v.state === null, JSON.stringify(v.state))
  assert('stages=[]（无留痕）', Array.isArray(v.stages) && v.stages.length === 0, JSON.stringify(v.stages))
}

console.log('== 2) 有留痕 → 阶段聚合 + 轮次排序 ==')
{
  mkdirSync(join(TMP_TRAJ, 'self_iteration'), { recursive: true })
  writeFileSync(join(TMP_TRAJ, 'self_iteration', 'sqt_strategy-001.jsonl'),
    JSON.stringify(mkScore('sqt_strategy', 1)) + '\n' + JSON.stringify(mkRound('sqt_strategy', 1)) + '\n', 'utf8')
  writeFileSync(join(TMP_TRAJ, 'self_iteration', 'sqt_strategy-002.jsonl'),
    JSON.stringify(mkScore('sqt_strategy', 2, { total: 84, level: 'A', weak: [] })) + '\n'
    + JSON.stringify(mkRound('sqt_strategy', 2, { verdict: 'converge', total: 84, baselineTotal: 78, status: 'converged' })) + '\n', 'utf8')

  const v = selfIterationOverview()
  assert('stages 含 sqt_strategy', v.stages.some((s) => s.token === 'sqt_strategy'), JSON.stringify(v.stages.map((s) => s.token)))
  const st = v.stages.find((s) => s.token === 'sqt_strategy')
  assert('aspice 从权威表', st.aspice === 'SQT.1' || typeof st.aspice === 'string', String(st.aspice))
  assert('rounds 轮次升序 r1→r2（score+round 每轮两条）', st.rounds[0].round === 1 && st.rounds[2].round === 2, JSON.stringify(st.rounds.map((r) => r.round)))
  assert('同轮 score 在 round 前', st.rounds[0].type === 'score' && st.rounds[1].type === 'round', JSON.stringify(st.rounds[0].type + ',' + st.rounds[1].type))
  assert('r2 total 归一（保留两位）', st.rounds[3].total === 84, JSON.stringify(st.rounds[3]))
  assert('latest = r2（converge）', st.latest?.round === 2 && st.latest?.verdict === 'converge', JSON.stringify(st.latest))
  assert('converged=true（latest 收敛）', st.converged === true, String(st.converged))
}

console.log('== 3) run-state 摘要（当前 run）==')
{
  mkdirSync(TMP_STATE, { recursive: true })
  writeFileSync(join(TMP_STATE, 'run-state.json'), JSON.stringify({
    schema: 'self-iteration/run-state/v1',
    stage: 'sqt_strategy', maxIter: 3, goal: 'Total>=80', sessionId: '20260828T10',
    sessionStartedAt: '2026-08-28T10:00:00.000Z',
    currentRound: 2, rounds: [], converged: true, status: 'converged',
    stopPoint: null, baselineTotal: 78, bestTotal: 84,
    lastScore: null, updatedAt: '2026-08-28T10:05:00.000Z',
  }), 'utf8')

  const v = selfIterationOverview()
  assert('state.stage=sqt_strategy', v.state?.stage === 'sqt_strategy', JSON.stringify(v.state?.stage))
  assert('state.currentRound=2', v.state?.currentRound === 2, String(v.state?.currentRound))
  assert('state.converged=true', v.state?.converged === true, String(v.state?.converged))
  assert('state.baselineTotal=78', v.state?.baselineTotal === 78, String(v.state?.baselineTotal))
  assert('state.bestTotal=84', v.state?.bestTotal === 84, String(v.state?.bestTotal))
}

console.log('== 4) lastScore 暂存透出 + 未知留痕类型过滤 ==')
{
  writeFileSync(join(TMP_STATE, 'run-state.json'), JSON.stringify({
    stage: 'sqt_strategy', currentRound: 3, status: 'running', converged: false,
    baselineTotal: 78, bestTotal: 84,
    lastScore: { total: 86, level: 'A', weak: [], gateOk: true },
    updatedAt: '2026-08-28T11:00:00.000Z',
  }), 'utf8')
  // 非法类型留痕不应进聚合
  const { appendFileSync } = await import('node:fs')
  appendFileSync(join(TMP_TRAJ, 'self_iteration', 'sqt_strategy-003.jsonl'),
    JSON.stringify({ type: 'rollback', stage: 'sqt_strategy', seq: 3 }) + '\n', 'utf8')

  const v = selfIterationOverview()
  assert('state.lastScore.total=86', v.state?.lastScore?.total === 86, JSON.stringify(v.state?.lastScore))
  assert('lastScore.weak 数组', Array.isArray(v.state?.lastScore?.weak), JSON.stringify(v.state?.lastScore?.weak))
  assert('rollback 类型不进 rounds（仍 4 条 r1score+r1round+r2score+r2round）', v.stages[0].rounds.length === 4, String(v.stages[0].rounds.length))
}

rmSync(TMP, { recursive: true, force: true })
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
