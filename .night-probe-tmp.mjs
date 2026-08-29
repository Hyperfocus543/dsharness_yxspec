// 临时回归探针：self-iteration 纯函数（decide/parseSelfIterate）对抗性用例
import assert from 'node:assert/strict'
import { decide, parseSelfIterate } from './gateway/runtime-js/vendor/@yxspec/self-iteration/index.js'

const log = (label, v) => console.log(label, '=', JSON.stringify(v))

// ---- decide 判定 ----
log('no-score round<max', decide(1, null, 80, '', null, 3))        // continue
log('degrade', decide(2, 70, 80, '', false, 3))                    // degrade
log('cap-first', decide(3, 70, 80, '', false, 3))                  // converge_by_maxiter
log('goal met no gate', decide(2, 85, 80, 'Total>=80', false, 3))  // converge
log('composite gate fail', decide(2, 85, 80, 'Total>=80 且门禁全绿', false, 3)) // continue
log('composite gate ok', decide(2, 85, 80, 'Total>=80 且门禁全绿', true, 3))    // converge
log('equal no degrade', decide(2, 80, 80, 'Total>=80', false, 3))  // converge
log('Total>80', decide(2, 80, 80, 'Total>80', false, 3))           // continue
log('cap-first degrade-with-max', decide(3, 60, 80, '', false, 3)) // converge_by_maxiter
log('goal decimal', decide(2, 80.5, 80, 'Total>=80.5', false, 3))  // converge

// ---- parseSelfIterate 参数抽取 ----
const p1 = parseSelfIterate('/yxspec:self-iterate --goal "Total>=80 且门禁全绿" sqt-script-gen')
log('p1 stage', p1?.stageRaw); log('p1 goal', p1?.goal)
assert.equal(p1?.stageRaw, 'sqt-script-gen')
assert.equal(p1?.goal, 'Total>=80 且门禁全绿')

const p2 = parseSelfIterate('/yxspec:self-iterate sqt_script_gen --max-iter=5 --resume')
log('p2 stage', p2?.stageRaw); log('p2 maxIter', p2?.maxIter); log('p2 resume', p2?.resume)
assert.equal(p2?.stageRaw, 'sqt_script_gen')
assert.equal(p2?.maxIter, 5)
assert.equal(p2?.resume, true)

const p4 = parseSelfIterate('/yxspec:self-iterate --mode framework sqt_script_gen')
log('p4 stage', p4?.stageRaw); log('p4 mode', p4?.mode)
assert.equal(p4?.stageRaw, 'sqt_script_gen')
assert.equal(p4?.mode, 'framework')

const p5 = parseSelfIterate('随便聊聊')
log('p5 non-command', p5)
assert.equal(p5, null)

// 边界：命令后跟非边界字符（如 -swe 连写）→ 不命中
const p6 = parseSelfIterate('/yxspec:self-iterate-swe x')
log('p6 attached suffix', p6)
assert.equal(p6, null)

console.log('PROBE_DONE')
