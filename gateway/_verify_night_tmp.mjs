// 夜间回归：self-iteration 纯函数断言（parseSelfIterate / decide）
import { parseSelfIterate, resolveStageToken, decide } from './runtime-js/vendor/@yxspec/self-iteration/index.js'

let fails = 0
const ok = (cond, label) => { if (!cond) { fails++; console.log('FAIL:', label) } else { console.log('PASS:', label) } }

// ---- parseSelfIterate ----
const c1 = parseSelfIterate('请执行 /yxspec:self-iterate sqt-script-gen --max-iter=5 --goal "Total>=80 且门禁全绿"')
ok(c1?.stageRaw === 'sqt-script-gen', 'c1 stageRaw')
ok(c1?.maxIter === 5, 'c1 maxIter')
ok(c1?.goal === 'Total>=80 且门禁全绿', 'c1 goal with space+quotes')
ok(c1?.resume === false, 'c1 resume false')

const c2 = parseSelfIterate('/yxspec:self-iterate --goal "Total>=80 且门禁全绿" sqt-script-gen --resume')
ok(c2?.stageRaw === 'sqt-script-gen', 'c2 stageRaw (flag-before-positional)')
ok(c2?.resume === true, 'c2 resume true')
ok(c2?.goal === 'Total>=80 且门禁全绿', 'c2 goal')

const c3 = parseSelfIterate('再跑 /yxspec:self-iterate swe_unit_verify --max-iter 2 --resume 结束')
ok(c3?.stageRaw === 'swe_unit_verify', 'c3 stageRaw')
ok(c3?.maxIter === 2, 'c3 maxIter (space form)')
ok(c3?.resume === true, 'c3 resume')

const c4 = parseSelfIterate('普通咨询，没有命令')
ok(c4 === null, 'c4 non-command -> null')

const c5 = parseSelfIterate('/yxspec:self-iterate --max-iter=3')
ok(c5 !== null && c5.stageRaw === null, 'c5 stage-less command -> stageRaw null')

// ---- resolveStageToken ----
// 需要 CMD_TOKENS 加载成功（stages.mjs 可 import 时）；否则回落 kebab 形式
const r1 = resolveStageToken('sqt-script-gen')
ok(r1 === 'sqt_script_gen' || r1 === 'sqt-script-gen', `resolveStageToken sqt-script-gen -> ${r1}`)
const r2 = resolveStageToken('sqt_script_gen')
ok(r2 === 'sqt_script_gen', `resolveStageToken sqt_script_gen -> ${r2}`)

// ---- decide ----
const d = decide
ok(d(3, 85, 60, 'Total>=80 且门禁全绿', true, 5) === 'converge', 'decide converge (goal+gate)')
ok(d(3, 85, 60, 'Total>=80 且门禁全绿', false, 5) === 'continue', 'decide gate-blocked -> continue')
ok(d(3, 55, 60, 'Total>=80', true, 5) === 'degrade', 'decide degrade (total<=baseline)')
ok(d(3, 65, 60, 'Total>=80', true, 5) === 'continue', 'decide continue (below goal)')
ok(d(5, 55, null, 'Total>=80', true, 5) === 'converge_by_maxiter', 'decide maxiter')
ok(d(1, null, null, 'Total>=80', null, 3) === 'continue', 'decide no-score continue')
ok(d(3, null, null, 'Total>=80', null, 3) === 'converge_by_maxiter', 'decide no-score maxiter (anti-infinite-loop)')
ok(d(2, null, 60, 'Total>=80', null, 3) === 'continue', 'decide no-score degrade-guard')

console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILURES`)
process.exit(fails === 0 ? 0 : 1)
