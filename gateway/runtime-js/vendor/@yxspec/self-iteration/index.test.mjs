// self-iteration 插件 parseSelfIterate 纯函数单测（mode 参数抽取 + 剥离正则）
// 运行：cd gateway/runtime-js/vendor/@yxspec/self-iteration && node --test index.test.mjs
// 说明：import './index.js' 无副作用（顶层仅 import + 常量 + try/catch 加载 stages.mjs
//      权威表；apply 是导出函数，不被调用就不执行）。parseSelfIterate 是导出纯函数，
//      只做参数抽取，不做 stage 权威 token 解析（后者在 apply() 内由 resolveStageToken 完成）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSelfIterate, resolveStageToken } from './index.js'

test('mode 显式 --mode=framework 命中 → mode=framework，stageRaw 正常抽取', () => {
  const p = parseSelfIterate('/yxspec:self-iterate sqt_script_gen --mode=framework')
  assert.ok(p, '应命中自迭代命令')
  assert.equal(p.mode, 'framework')
  assert.equal(p.stageRaw, 'sqt_script_gen')
})

test('mode 缺省 → product（评阶段产物，向后兼容）', () => {
  const p = parseSelfIterate('/yxspec:self-iterate sqt_script_gen')
  assert.ok(p, '应命中自迭代命令')
  assert.equal(p.mode, 'product')
  assert.equal(p.stageRaw, 'sqt_script_gen')
})

test('--mode=bogus（非法值）→ 回退 product，不报错', () => {
  const p = parseSelfIterate('/yxspec:self-iterate sqt_script_gen --mode=bogus')
  assert.ok(p, '应命中自迭代命令')
  assert.equal(p.mode, 'product')
  assert.equal(p.stageRaw, 'sqt_script_gen')
})

test('--mode=framework 在 stage 前 → 不被当阶段裸词（剥离正则生效）', () => {
  // 回归：若剥离正则漏掉 mode，--mode=framework 会被当成第一个非 flag 裸词
  // （stageRaw='framework'）→ resolveStageToken 失败 → 静默降级不开 run。
  const p = parseSelfIterate('/yxspec:self-iterate --mode=framework sqt_script_gen')
  assert.ok(p, '应命中自迭代命令')
  assert.equal(p.mode, 'framework')
  assert.equal(p.stageRaw, 'sqt_script_gen')
})

test('--mode=framework 在 stage 后（无其它 flag）→ stageRaw 仍为阶段名', () => {
  const p = parseSelfIterate('/yxspec:self-iterate sqt_script_gen --mode=framework')
  assert.ok(p, '应命中自迭代命令')
  assert.equal(p.stageRaw, 'sqt_script_gen')
  assert.equal(p.mode, 'framework')
})

test('--mode 空格分隔形态（--mode framework）也抽取', () => {
  const p = parseSelfIterate('/yxspec:self-iterate sqt_script_gen --mode framework')
  assert.ok(p, '应命中自迭代命令')
  assert.equal(p.mode, 'framework')
  assert.equal(p.stageRaw, 'sqt_script_gen')
})

test('product 显式 --mode=product → product', () => {
  const p = parseSelfIterate('/yxspec:self-iterate --mode=product sqt_script_gen')
  assert.ok(p, '应命中自迭代命令')
  assert.equal(p.mode, 'product')
  assert.equal(p.stageRaw, 'sqt_script_gen')
})

test('maxIter 钳制 [1,10]：越界值就地归一（与前端 buildSelfIterateCommand 派活钳制同口径）', () => {
  // 轮数是状态机收敛边界（roundNo >= maxIter 收束），越界必须钳制——
  // 999 → 10（失控轮数封顶）；0 → 1（首轮即 converge_by_maxiter 的形同虚设拦截）
  assert.equal(parseSelfIterate('/yxspec:self-iterate sqt_script_gen --max-iter=999').maxIter, 10)
  assert.equal(parseSelfIterate('/yxspec:self-iterate sqt_script_gen --max-iter=10').maxIter, 10)
  assert.equal(parseSelfIterate('/yxspec:self-iterate sqt_script_gen --max-iter=5').maxIter, 5)
  assert.equal(parseSelfIterate('/yxspec:self-iterate sqt_script_gen --max-iter=1').maxIter, 1)
  assert.equal(parseSelfIterate('/yxspec:self-iterate sqt_script_gen --max-iter=0').maxIter, 1)
  // 空格分隔形态同样钳制
  assert.equal(parseSelfIterate('/yxspec:self-iterate sqt_script_gen --max-iter 999').maxIter, 10)
  // 非数字/缺省 → null（不落钳制，回落插件默认 DEFAULT_MAX_ITER=3）
  assert.equal(parseSelfIterate('/yxspec:self-iterate sqt_script_gen --max-iter=abc').maxIter, null)
  assert.equal(parseSelfIterate('/yxspec:self-iterate sqt_script_gen').maxIter, null)
})

test('resolveStageToken：下划线 token 原样 → 权威 token', () => {
  assert.equal(resolveStageToken('swe_arch'), 'swe_arch')
  assert.equal(resolveStageToken('sqt_script_gen'), 'sqt_script_gen')
  assert.equal(resolveStageToken('swe_unit_verify'), 'swe_unit_verify')
})

test('resolveStageToken：完整命令名（连字符 + 版本后缀）→ 权威 token', () => {
  // 回归：此前完整命令名（swe-arch-v2）走 `cmd === /yxspec:${kebab}` 精确匹配才命中；
  // 而 buildSelfIterateCommand 派活传的是 token（swe_arch），agent 手写命令才可能
  // 写全命令名——两者都不能漏。swe-arch-v2 / swe-coding-verify-pc-v2 是命令名形态。
  assert.equal(resolveStageToken('swe-arch-v2'), 'swe_arch')
  assert.equal(resolveStageToken('swe-coding-verify-pc-v2'), 'swe_coding_verify_pc')
  assert.equal(resolveStageToken('swe-coding-plan-v2'), 'swe_coding_plan')
})

test('resolveStageToken：连字符表单 token（无版本后缀）→ 权威 token', () => {
  // 回归：`swe-arch`（用户/agent 手写的无版本连字符名）此前恒 null → 命令命中但
  // resolveStageToken 失败 → 静默不开 run（自迭代轮次状态机形同虚设）。兜底归一
  // 为下划线 token 后反查命中。含下划线的连字符（swe_arch_if 的 kebab=swe-arch-if）
  // 是另一类形态：raw 已含下划线，under 归一不动，但 kebab 撞命令表失败后仍须经
  // 下划线反查命中（token 表键即下划线 token）。
  assert.equal(resolveStageToken('swe-arch'), 'swe_arch')
  assert.equal(resolveStageToken('swe-coding-plan'), 'swe_coding_plan')
  assert.equal(resolveStageToken('swe-unit-verify'), 'swe_unit_verify')
  assert.equal(resolveStageToken('swe-arch-if'), 'swe_arch_if')
  assert.equal(resolveStageToken('swe_arch_if'), 'swe_arch_if')
})

test('resolveStageToken：空 / 未知阶段 → null（不误建 run）', () => {
  assert.equal(resolveStageToken(''), null)
  assert.equal(resolveStageToken(null), null)
  assert.equal(resolveStageToken(undefined), null)
  assert.equal(resolveStageToken('not-a-real-stage'), null)
})
