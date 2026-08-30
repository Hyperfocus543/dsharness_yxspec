// @yxspec/git-workspace stageOfPrompt 单测（阶段命令 → 权威 token 映射）
// 运行：cd gateway && node --test runtime-js/vendor/@yxspec/git-workspace/stage-of-prompt.test.mjs
// 覆盖：
//   - 命令名（`/yxspec:sys-analysis`，token≠命令名！）命中 prompt → 返回权威 token
//     `sys_analysis`，而非命令名（修复前：返回命令名 'sys-analysis'，tag/审计/轨迹目录
//     错位、与前端 STAGE_ORDER 对不上）
//   - token 本身（下划线形态）命中 → 兜底返回
//   - 非阶段注入 / 无命令 → null
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

// 模块路径基于本文件位置解析（不再依赖 cwd——从仓库根或 gateway/ 下跑都正确）
const mod = await import(
  pathToFileURL(join(process.cwd(), 'runtime-js', 'vendor', '@yxspec', 'git-workspace', 'index.js')).href,
)
const { stageOfPrompt } = mod

test('命令名命中 prompt → 返回权威 token（token≠命令名 的阶段）', () => {
  // token `sys_analysis` 的命令是 `/yxspec:sys-analysis`——修复前返回命令名 'sys-analysis'，
  // 修复后必须反查回 token
  assert.equal(stageOfPrompt('请执行 /yxspec:sys-analysis'), 'sys_analysis')
  assert.equal(stageOfPrompt('run /yxspec:sys-analysis 并输出结果'), 'sys_analysis')
  assert.equal(stageOfPrompt('/yxspec:swe-coding-plan-v2'), 'swe_coding_plan')
  assert.equal(stageOfPrompt('执行 /yxspec:sqt-tr-analysis'), 'sqt_tr')
  // 命令名后接标点/句尾边界
  assert.equal(stageOfPrompt('执行 /yxspec:swe-arch-v2。'), 'swe_arch')
  assert.equal(stageOfPrompt('阶段命令 /yxspec:hwe-analysis'), 'hwe_analysis')
})

test('token 本身（下划线形态）命中 → 兜底返回', () => {
  assert.equal(stageOfPrompt('进入 sys_analysis 阶段'), 'sys_analysis')
  assert.equal(stageOfPrompt('开始 swe_coding_do'), 'swe_coding_do')
})

test('token 兜底必须整词边界：变体/接口/过渡阶段不被前缀阶段吞掉', () => {
  // 回归：旧实现 `text.includes(token)` 把 `swe_coding_verify_pc` 误标成
  // `swe_coding_verify`、`swe_arch_if` → `swe_arch`、`swe_release_promote` →
  // `swe_release`（表顺序前缀在前 → 变体恒错）。修复后长 token 内的前缀 token
  // 因尾随 `_`（词字符）不命中 \b 边界 → 精准回落。
  assert.equal(stageOfPrompt('进入 swe_coding_verify_pc 阶段'), 'swe_coding_verify_pc')
  assert.equal(stageOfPrompt('swe_arch_if 阶段开始'), 'swe_arch_if')
  assert.equal(stageOfPrompt('推进 swe_release_promote'), 'swe_release_promote')
  // 前缀 token 本体（独立词）仍照常命中
  assert.equal(stageOfPrompt('进入 swe_coding_verify 阶段'), 'swe_coding_verify')
  assert.equal(stageOfPrompt('swe_arch'), 'swe_arch')
  assert.equal(stageOfPrompt('推进 swe_release'), 'swe_release')
  // 下划线形态拼接的其他 token 不受影响
  assert.equal(stageOfPrompt('开始 swe_coding_plan'), 'swe_coding_plan')
})

test('非阶段注入 / 无命令 → null', () => {
  assert.equal(stageOfPrompt('通用咨询：帮我看看这段代码'), null)
  assert.equal(stageOfPrompt(''), null)
  assert.equal(stageOfPrompt(null), null)
  assert.equal(stageOfPrompt(undefined), null)
  assert.equal(stageOfPrompt(42), null)
})
