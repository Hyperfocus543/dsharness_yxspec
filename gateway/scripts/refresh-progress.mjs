// refresh-progress.mjs — 轻量刷新 PROGRESS.md（只读统计，不执行任何阶段）
// 用法: cd gateway && node scripts/refresh-progress.mjs
// 数据：scanStageArtifacts + gateStage（复用 stages/trajectory 权威逻辑），
// 只重写进度统计，不触碰 dsh_state.json / 产物 / 基线。
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STAGES, scanStageArtifacts, stageGlobHit } from '../lib/stages.mjs'
import { gateStage } from '../lib/trajectory.mjs'

const PROJ = process.env.YXSPEC_PROJECT_ROOT || 'D:/Work/01_Projects/Aima_X1_BCM'
const OUT = join(PROJ, 'PROGRESS.md')

const tokens = Object.keys(STAGES)
let done = 0
const lines = []
for (const token of tokens) {
  const s = STAGES[token]
  const arts = scanStageArtifacts(s)
  const hit = stageGlobHit(s)
  const g = gateStage(token)
  const st = g?.status ?? (hit ? 'verified' : 'pending')
  const isDone = hit && (g?.passed || s.gate_policy !== 'artifact+trajectory') ? true : hit
  if (isDone) done++
  const statusLabel = !hit ? 'pending' : st === 'blocked' ? 'blocked' : st === 'unverified' ? 'unverified' : 'done'
  lines.push(`- ${token}: **${statusLabel}**（产物 ${arts.length}）`)
}
const pct = Math.round((done / tokens.length) * 100)

const md = `# YXSpec 25 阶段全流程验证进度

> 更新时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')} ｜ 由 refresh-progress.mjs 维护（只读统计）

- 整体进度：**${done}/${tokens.length}**（${pct}%）
- 当前阶段：（见 dsh_state.json current）

## 各阶段状态
${lines.join('\n')}

## 说明
- 状态判定：产物命中（stageGlobHit）+ 门控（gateStage 三态）；blocked = 轨迹/门控打回，unverified = 产物在但轨迹缺失
- 本文件由只读统计生成，不反映"是否真实执行过"——执行证据见轨迹 JSONL（runtime-data/trajectory/）
`
writeFileSync(OUT, md, 'utf8')
console.log(`PROGRESS.md refreshed: ${done}/${tokens.length} (${pct}%), -> ${OUT}`)
