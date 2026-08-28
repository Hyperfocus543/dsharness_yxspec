// 临时验证脚本（回归完即删）
import { decide, parseSelfIterate } from './runtime-js/vendor/@yxspec/self-iteration/index.js'

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} => got ${JSON.stringify(got)}${ok ? '' : ` want ${JSON.stringify(want)}`}`)
}

// decide：复合目标（分数 + 门禁双条件）
check('compound goal met, gateOk', decide(1, 90, null, 'Total>=80 且门禁全绿', true, 3), 'converge')
check('compound goal met, gateFail', decide(1, 90, null, 'Total>=80 且门禁全绿', false, 3), 'continue')
check('compound goal not met', decide(1, 70, null, 'Total>=80 且门禁全绿', true, 3), 'continue')
check('compound goal maxiter', decide(3, 70, null, 'Total>=80 且门禁全绿', true, 3), 'converge_by_maxiter')
// decide：简单目标
check('simple Total>=80 met', decide(1, 90, null, 'Total>=80', true, 3), 'converge')
check('simple Total>=80 below', decide(1, 70, null, 'Total>=80', true, 3), 'continue')
check('simple Total>80 met', decide(1, 90, null, 'Total>80', true, 3), 'converge')
check('spaced Total >= 80', decide(1, 85, null, 'Total >= 80', true, 3), 'converge')
check('decimal Total>=85.5', decide(1, 86, null, 'Total>=85.5', true, 3), 'converge')
check('decimal below', decide(1, 85, null, 'Total>=85.5', true, 3), 'continue')
// decide：降级护栏
check('tie total=baseline goal met -> converge', decide(2, 85, 85, 'Total>=80', true, 3), 'converge')
check('tie total=baseline goal not met -> continue', decide(2, 85, 85, 'Total>=90', true, 3), 'continue')
check('degrade total<baseline', decide(2, 80, 85, 'Total>=80', true, 3), 'degrade')
// decide：无 goal → 门禁全绿
check('no goal gateOk', decide(1, 70, null, '', true, 3), 'converge')
check('no goal gateFail', decide(1, 70, null, '', false, 3), 'continue')
// decide：用满 maxiter
check('maxiter', decide(3, 70, null, 'Total>=80', false, 3), 'converge_by_maxiter')

// parseSelfIterate
check('parse quoted goal', parseSelfIterate('/yxspec:self-iterate sqt-script-gen --goal "Total>=80 且门禁全绿" --max-iter=5'),
  { stageRaw: 'sqt-script-gen', maxIter: 5, goal: 'Total>=80 且门禁全绿', resume: false })
check('parse resume', parseSelfIterate('/yxspec:self-iterate --resume sqt_script_gen'),
  { stageRaw: 'sqt_script_gen', maxIter: null, goal: null, resume: true })
check('parse eq goal', parseSelfIterate('/yxspec:self-iterate --stage=sqt_script_gen --goal=Total>=80'),
  { stageRaw: 'sqt_script_gen', maxIter: null, goal: 'Total>=80', resume: false })
// 无 stage / 非法 stage：parseSelfIterate 只做参数抽取（松散），合法性由
// resolveStageToken 在下游判（apply() 里 resolve 失败 → log + 提示词路径降级）。
// 因此这里断言"返回对象 + stageRaw 原样"，而不是 parse 阶段就拒掉。
check('parse no stage', parseSelfIterate('/yxspec:self-iterate'),
  { stageRaw: null, maxIter: null, goal: null, resume: false })
check('parse leading junk', parseSelfIterate('axyxspec:self-iterate sqt_script_gen'), null)
check('parse trailing junk', parseSelfIterate('/yxspec:self-iterate sqt_script_gen-extra'),
  { stageRaw: 'sqt_script_gen-extra', maxIter: null, goal: null, resume: false })
// flag 值在 stage 前（空格分隔带值 flag）→ stage 提取不被 flag 值污染
check('parse goal before stage', parseSelfIterate('/yxspec:self-iterate --goal "Total>=80 且门禁全绿" sqt-script-gen'),
  { stageRaw: 'sqt-script-gen', maxIter: null, goal: 'Total>=80 且门禁全绿', resume: false })
check('parse maxiter before stage', parseSelfIterate('/yxspec:self-iterate --max-iter 5 sqt_script_gen'),
  { stageRaw: 'sqt_script_gen', maxIter: 5, goal: null, resume: false })
check('parse hyphen stage', parseSelfIterate('/yxspec:self-iterate sqt-script-gen'),
  { stageRaw: 'sqt-script-gen', maxIter: null, goal: null, resume: false })

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
