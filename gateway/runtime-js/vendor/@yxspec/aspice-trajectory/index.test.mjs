// aspice-trajectory 插件 toRecord / normalizeTodos 纯函数单测
// 运行：cd gateway/runtime-js/vendor/@yxspec/aspice-trajectory && node --test index.test.mjs
// 说明：import './index.js' 无副作用（顶层仅 import + 常量 + try/catch 加载 stages.mjs
//      权威表；apply 是导出函数，不被调用就不执行）。toRecord / normalizeTodos 为导出
//      纯函数，只做 schema 聚合，不依赖 runtime 事件流。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toRecord, normalizeTodos } from './index.js'

/** 构造一个"完整 rec"（openStage 初始化字段齐全）的辅助。 */
function fullRec(over = {}) {
  return {
    stage: 'swe_coding_do',
    seq: 1,
    sessionId: 'sess-1',
    startedAt: 1000,
    finishedAt: 2000,
    turnCount: 2,
    stepCount: 3,
    eventTypes: new Set(['turn/start', 'turn/end']),
    tools: [{ type: 'tool/call', name: 'bash', callId: 'c1', ts: 1100 }],
    tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 20, reasoning: 30 },
    reason: 'completed',
    model: { provider: 'minimax', name: 'MiniMax-M3', maxTokens: 4096 },
    goals: [{ operation: 'create', objective: 'x', phase: 'swe_coding_do', at: 1050 }],
    todos: [{ content: '写代码', status: 'in_progress' }],
    userInputs: [{ at: 1050, preview: '帮我写' }],
    reasoningDeltaCount: 4,
    hasReasoning: true,
    ...over,
  }
}

test('toRecord 透出 model/goals/todos/userInputs/reasoning 增强字段', () => {
  const r = toRecord(fullRec())
  assert.deepEqual(r.model, { provider: 'minimax', name: 'MiniMax-M3', maxTokens: 4096 })
  assert.equal(r.goals.length, 1)
  assert.equal(r.goals[0].objective, 'x')
  assert.equal(r.todos[0].content, '写代码')
  assert.equal(r.todos[0].status, 'in_progress')
  assert.equal(r.userInputs.length, 1)
  assert.equal(r.userInputs[0].preview, '帮我写')
  assert.equal(r.cost.reasoningTokens, 30)
  assert.equal(r.cost.hasReasoning, true)
  assert.equal(r.reasoningDeltaCount, 4)
})

test('旧记录（无新字段）→ 各新字段取默认值，不崩', () => {
  const r = toRecord({
    stage: 'swe_coding_do',
    seq: 1,
    sessionId: 'sess-0',
    startedAt: 1000,
    finishedAt: 1001,
    turnCount: 1,
    stepCount: 0,
    eventTypes: new Set(['turn/start']),
    tools: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reason: 'error',
  })
  assert.equal(r.status, 'failed')
  assert.equal(r.model, null)
  assert.deepEqual(r.goals, [])
  assert.deepEqual(r.todos, [])
  assert.deepEqual(r.userInputs, [])
  assert.equal(r.reasoningDeltaCount, 0)
  assert.equal(r.cost.reasoningTokens, 0)
  assert.equal(r.cost.hasReasoning, false)
})

test('status 映射不回归：completed→passed', () => {
  assert.equal(toRecord(fullRec({ reason: 'completed' })).status, 'passed')
})

test('status 映射不回归：error/max-tokens→failed', () => {
  assert.equal(toRecord(fullRec({ reason: 'error' })).status, 'failed')
  assert.equal(toRecord(fullRec({ reason: 'max-tokens' })).status, 'failed')
})

test('status 映射不回归：aborted/interrupted/blocked/stage-switch→blocked', () => {
  for (const reason of ['aborted', 'interrupted', 'blocked', 'stage-switch']) {
    assert.equal(toRecord(fullRec({ reason })).status, 'blocked')
  }
})

test('status 映射不回归：无 reason→unverified', () => {
  assert.equal(toRecord(fullRec({ reason: null })).status, 'unverified')
})

test('goals 上限 10：12 条 → toRecord 截为前 10 条', () => {
  const goals = Array.from({ length: 12 }, (_, i) => ({
    operation: 'update', objective: `目标${i}`, phase: 'swe_coding_do', at: i,
  }))
  const r = toRecord(fullRec({ goals }))
  assert.equal(r.goals.length, 10)
  assert.equal(r.goals[0].objective, '目标0')
  assert.equal(r.goals[9].objective, '目标9')
})

test('userInputs 上限 3：5 条 → toRecord 截为前 3 条', () => {
  const userInputs = Array.from({ length: 5 }, (_, i) => ({ at: i, preview: `输入${i}` }))
  const r = toRecord(fullRec({ userInputs }))
  assert.equal(r.userInputs.length, 3)
  assert.equal(r.userInputs[0].preview, '输入0')
  assert.equal(r.userInputs[2].preview, '输入2')
})

test('normalizeTodos：content 截断 80', () => {
  const long = 'x'.repeat(200)
  const out = normalizeTodos([{ content: long, status: 'pending' }])
  assert.equal(out[0].content.length, 80)
  assert.equal(out[0].content, long.slice(0, 80))
})

test('normalizeTodos：status 缺省 unknown，undefined content 安全', () => {
  const out = normalizeTodos([{ content: undefined }, { status: 'done' }])
  assert.equal(out[0].content, '')
  assert.equal(out[0].status, 'unknown')
  assert.equal(out[1].content, '')
  assert.equal(out[1].status, 'done')
})

test('normalizeTodos：非数组/空 → []', () => {
  assert.deepEqual(normalizeTodos(null), [])
  assert.deepEqual(normalizeTodos(undefined), [])
  assert.deepEqual(normalizeTodos({}), [])
  assert.deepEqual(normalizeTodos('nope'), [])
})
