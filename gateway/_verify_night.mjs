// 夜间回归临时验证脚本（验证完即删）
// 覆盖：git.mjs porcelainStatus / self-iteration emptyState+advanceState 内部纯函数
// 用源码提取方式执行（函数无外部模块依赖；emptyState 需要 DEFAULT_MAX_ITER）
import { readFileSync } from 'node:fs'

const GIT = readFileSync(new URL('./lib/git.mjs', import.meta.url), 'utf8')
const SI = readFileSync(new URL('./runtime-js/vendor/@yxspec/self-iteration/index.js', import.meta.url), 'utf8')

function extractFn(src, fname) {
  const start = src.indexOf(`function ${fname}(`)
  if (start < 0) throw new Error(`function ${fname} not found`)
  let i = src.indexOf('{', start)
  let depth = 0
  for (let j = i; j < src.length; j++) {
    const ch = src[j]
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) }
  }
  throw new Error(`unbalanced in ${fname}`)
}

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} => got ${JSON.stringify(got)}${ok ? '' : ` want ${JSON.stringify(want)}`}`)
}

// ---- 1) porcelainStatus（git.mjs）----
const porcelainStatus = eval('(' + extractFn(GIT, 'porcelainStatus') + ')')
const xyCases = [
  ['??', 'untracked'], ['M ', 'modified'], [' M', 'modified'], ['A ', 'added'],
  ['D ', 'deleted'], ['R ', 'renamed'], ['AA', 'conflict'], ['DD', 'conflict'],
  ['UU', 'conflict'], ['U ', 'conflict'], ['T ', 'modified'], ['AM', 'added'],
  ['AD', 'added'], ['DA', 'deleted'], ['RM', 'renamed'], ['??', 'untracked'],
]
for (const [xy, want] of xyCases) check(`porcelainStatus(${JSON.stringify(xy)})`, porcelainStatus(xy), want)

// ---- 2) emptyState（self-iteration）schema 与 lib/self-iteration.mjs 读取契约对齐 ----
const emptyState = eval('(function(){ const DEFAULT_MAX_ITER = 3;\nreturn ' + extractFn(SI, 'emptyState') + '})()')
const st0 = emptyState('sqt_strategy')
const expectedKeys = ['schema', 'stage', 'maxIter', 'goal', 'sessionId', 'sessionStartedAt',
  'currentRound', 'rounds', 'converged', 'status', 'stopPoint', 'baselineTotal', 'bestTotal',
  'lastScore', 'updatedAt']
for (const k of expectedKeys) check(`emptyState has ${k}`, Object.prototype.hasOwnProperty.call(st0, k), true)
check('emptyState.schema', st0.schema, 'self-iteration/run-state/v1')
check('emptyState.stage', st0.stage, 'sqt_strategy')
check('emptyState.status', st0.status, 'running')
check('emptyState.currentRound', st0.currentRound, 0)
check('emptyState.rounds', st0.rounds, [])
check('emptyState.baselineTotal', st0.baselineTotal, null)
check('emptyState.lastScore', st0.lastScore, null)

// ---- 3) advanceState 状态机推进（continue / degrade / converge / baseline 锚定）----
const advanceState = eval('(' + extractFn(SI, 'advanceState') + ')')
const mkScore = (total, level, weak, gateOk) => ({ level, weak, gateOk })

// 3a) continue：r1 分数未达 goal → status running，bestTotal=total，baseline 锚定（首轮冻结）
const s1 = emptyState('sqt_strategy')
s1.goal = 'Total>=80'
advanceState(s1, 1, 70, mkScore(70, 'C', ['SYS.1'], true), 'continue')
check('continue status', s1.status, 'running')
check('continue currentRound', s1.currentRound, 1)
check('continue bestTotal', s1.bestTotal, 70)
check('continue baseline anchored on r1', s1.baselineTotal, 70)
check('continue lastScore cleared', s1.lastScore, null)
check('continue rounds len', s1.rounds.length, 1)

// 3b) degrade：r2 total <= baseline → 本轮丢弃，stopPoint 记录，status running
advanceState(s1, 2, 65, mkScore(65, 'C', ['SYS.1'], true), 'degrade')
check('degrade status', s1.status, 'running')
check('degrade stopPoint', s1.stopPoint, 'degrade_round_2')
check('degrade bestTotal preserved', s1.bestTotal, 70)
check('degrade rounds includes r2', s1.rounds.some((r) => r.round === 2 && r.verdict === 'degrade'), true)

// 3c) converge：r3 total 达 goal → converged + stopPoint null
advanceState(s1, 3, 85, mkScore(85, 'A', [], true), 'converge')
check('converge status', s1.status, 'converged')
check('converge converged flag', s1.converged, true)
check('converge stopPoint', s1.stopPoint, null)
check('converge bestTotal', s1.bestTotal, 85)

// 3d) converge_by_maxiter：满轮未达 goal → converged + stopPoint maxiter_round_N
const s2 = emptyState('sqt_script_gen')
s2.goal = 'Total>=80'
s2.maxIter = 3
advanceState(s2, 1, 70, mkScore(70, 'C', ['SYS.1'], false), 'continue')
advanceState(s2, 2, 75, mkScore(75, 'C', ['SYS.1'], false), 'continue')
advanceState(s2, 3, 78, mkScore(78, 'C', ['SYS.1'], false), 'converge_by_maxiter')
check('maxiter status', s2.status, 'converged')
check('maxiter stopPoint', s2.stopPoint, 'maxiter_round_3')
check('maxiter rounds sorted', s2.rounds.map((r) => r.round), [1, 2, 3])

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
