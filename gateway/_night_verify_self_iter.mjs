// 夜间回归：self-iteration 纯函数静态验证（parseSelfIterate / resolveStageToken / decide）
// 验证后删除
import { parseSelfIterate, resolveStageToken, decide } from './runtime-js/vendor/@yxspec/self-iteration/index.js'

let fail = 0
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`); if (!cond) fail++ }

// ---- parseSelfIterate ----
{
  const p = parseSelfIterate('请执行 /yxspec:self-iterate sqt-script-gen --max-iter=3 --goal "Total>=80 且门禁全绿"')
  ok(!!p, 'parse: hit self-iterate')
  ok(p.stageRaw === 'sqt-script-gen', `parse: stageRaw=${p.stageRaw}`)
  ok(p.maxIter === 3, `parse: maxIter=${p.maxIter}`)
  ok(p.goal === 'Total>=80 且门禁全绿', `parse: goal=${JSON.stringify(p.goal)}`)
  ok(p.resume === false, 'parse: resume=false')
}
{
  const p = parseSelfIterate('继续 /yxspec:self-iterate --goal "Total>=90" --stage swe-coding-plan --resume')
  ok(!!p, 'parse2: hit')
  ok(p.stageRaw === 'swe-coding-plan', `parse2: stageRaw=${p.stageRaw}`)
  ok(p.resume === true, 'parse2: resume=true')
}
{
  const p = parseSelfIterate('帮我看看文档')
  ok(p === null, 'parse: general prompt -> null')
}
{
  // 前导粘连词应不命中（xyxspec:self-iterate 前导 x 是词字符 → 无边界）
  const p = parseSelfIterate('axyxspec:self-iterate foo')
  ok(p === null, 'parse: glued prefix -> null')
}

// ---- resolveStageToken ----
ok(resolveStageToken('sqt-script-gen') === 'sqt_script_gen', 'resolve: kebab -> token')
ok(resolveStageToken('sqt_script_gen') === 'sqt_script_gen', 'resolve: underscore token')
ok(resolveStageToken('init') === 'init', 'resolve: init token')
ok(resolveStageToken('') === null, 'resolve: empty -> null')
ok(resolveStageToken('no-such-stage') === null, 'resolve: unknown -> null')

// ---- decide ----
// degrade: 严格小于；持平不算降级
ok(decide(2, 70, 80, 'Total>=80', true, 5) === 'degrade', 'decide: total<baseline -> degrade')
ok(decide(2, 80, 80, 'Total>=80', true, 5) === 'converge', 'decide: equal baseline + goal met -> converge')
// 复合 goal：总分达 + 门禁全绿
ok(decide(2, 85, 80, 'Total>=80 且门禁全绿', true, 5) === 'converge', 'decide: composite goal + gate ok -> converge')
ok(decide(2, 85, 80, 'Total>=80 且门禁全绿', false, 5) === 'continue', 'decide: composite goal + gate fail -> continue')
// 无 goal → 门禁全绿即达
ok(decide(2, 90, 80, '', true, 5) === 'converge', 'decide: no goal + gate ok -> converge')
// 无分轮（total null）不判 degrade（防死循环）
ok(decide(3, null, 80, 'Total>=80', null, 5) === 'continue', 'decide: no score -> continue')
// 用满兜底
ok(decide(5, null, 80, 'Total>=80', null, 5) === 'converge_by_maxiter', 'decide: maxIter reached -> converge_by_maxiter')
// 持平基线但 goal 未达 → continue（不是 degrade）
ok(decide(2, 80, 80, 'Total>=90', true, 5) === 'continue', 'decide: equal baseline, goal unmet -> continue')

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`)
process.exit(fail === 0 ? 0 : 1)
