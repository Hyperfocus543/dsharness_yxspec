// self-iteration 插件 parseSelfIterate 纯函数单测（mode 参数抽取 + 剥离正则）
// 运行：cd gateway/runtime-js/vendor/@yxspec/self-iteration && node --test index.test.mjs
// 说明：import './index.js' 无副作用（顶层仅 import + 常量 + try/catch 加载 stages.mjs
//      权威表；apply 是导出函数，不被调用就不执行）。parseSelfIterate 是导出纯函数，
//      只做参数抽取，不做 stage 权威 token 解析（后者在 apply() 内由 resolveStageToken 完成）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSelfIterate } from './index.js'

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
