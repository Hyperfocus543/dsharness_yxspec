// =============================================================================
// self-iteration.mjs — 自迭代打分结果读取（驾驶舱「自迭代评分」卡数据源）
// =============================================================================
// 数据源（@yxspec/self-iteration 插件写、本模块只读）：
//   1. run-state.json      —— 当前 run 的状态机（阶段/轮次/基线/收敛/分数暂存）
//      路径：<YXSPEC_SELF_ITERATION_STATE_ROOT>/run-state.json
//      （与插件 DEFAULT_STATE_ROOT 同解析；start-gateway.mjs 未覆盖时回落仓库内）
//   2. 轨迹 JSONL          —— 每轮打分/轮次判定的追加留痕
//      路径：<YXSPEC_TRAJECTORY_ROOT>/self_iteration/<stage>-<seq>.jsonl
//      （与插件 trajRoot 同解析；经 YXSPEC_TRAJECTORY_ROOT 统一到 runtime-data）
//
// 职责：把这两份运行时数据聚合成分阶段视图，供 GET /api/self-iteration 返回。
//   · 阶段权威 = stages.mjs STAGES 全表（无 run 记录 → 该阶段不在结果里，前端
//     按「尚未执行自迭代」降级）。
//   · 每阶段 = run-state 摘要（若该阶段就是当前 run）+ 该阶段全部轮次留痕
//     （rounds = round/v1 + score/v1 合并，按轮次升序）。
//   · 前端契约：阶段无关纯展示，无打分/无状态 → 空数据，不抛错（网关未起/
//     从未跑自迭代 → 空态，不阻塞驾驶舱）。
//
// 红线：只读 runtime-data；绝不写状态文件；脚本/目录缺失 → 空数据（不抛）。
// =============================================================================
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STAGES } from './stages.mjs'

// 状态根：与插件 DEFAULT_STATE_ROOT 同解析（gateway/runtime-js/runtime-data/self-iteration）。
const DEFAULT_STATE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)), '..', 'runtime-js', 'runtime-data', 'self-iteration',
)
export const SELF_ITERATION_STATE_ROOT = process.env.YXSPEC_SELF_ITERATION_STATE_ROOT || DEFAULT_STATE_ROOT

// 轨迹根：与 lib/trajectory.mjs 同源（插件 trajRoot 经 start-gateway.mjs 统一 env）。
import { TRAJECTORY_ROOT } from './trajectory.mjs'
export { TRAJECTORY_ROOT }

/** 阶段 token 是否在权威表（与 trajectory.mjs 同规则）。 */
function isStageToken(token) {
  return typeof token === 'string' && Object.prototype.hasOwnProperty.call(STAGES, token)
}

/** 读 run-state.json；无/损坏 → null（不抛）。 */
function readRunState() {
  try {
    const p = join(SELF_ITERATION_STATE_ROOT, 'run-state.json')
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/** 读 self_iteration/ 目录下全部 JSONL 行（按文件名时间/序号顺序读，行内时间升序）。 */
function listSelfIterationEntries() {
  const dir = join(TRAJECTORY_ROOT, 'self_iteration')
  let files = []
  try {
    files = readdirSync(dir).filter((f) => /^[a-z0-9_]+-\d+\.jsonl$/.test(f)).sort()
  } catch {
    return [] // 目录不存在 = 从未跑过自迭代
  }
  const out = []
  for (const f of files) {
    const abs = join(dir, f)
    let lines = []
    try {
      lines = readFileSync(abs, 'utf8').split('\n').filter((l) => l.trim())
    } catch {
      continue // 单个文件损坏不影响其余
    }
    for (const line of lines) {
      try {
        const rec = JSON.parse(line)
        if (rec && typeof rec.type === 'string' && rec.type.startsWith('self-iteration/')) out.push(rec)
      } catch { /* 坏行跳过 */ }
    }
  }
  return out
}

/** 轮次记录归一：score/v1 与 round/v1 合并成一条「轮次评分」展示行。 */
function roundEntry(rec) {
  const round = Number.isInteger(rec.round) ? rec.round : null
  return {
    type: rec.type === 'self-iteration/score/v1' ? 'score' : 'round',
    round,
    total: typeof rec.total === 'number' ? rec.total : null,
    master: typeof rec.master === 'number' ? rec.master : null,
    stageScore: typeof rec.stageScore === 'number' ? rec.stageScore : null,
    level: typeof rec.level === 'string' ? rec.level : null,
    weak: Array.isArray(rec.weak) ? rec.weak : [],
    gateOk: rec.gateOk === true,
    verdict: typeof rec.verdict === 'string' ? rec.verdict : null,
    baselineTotal: typeof rec.baselineTotal === 'number' ? rec.baselineTotal : null,
    status: typeof rec.status === 'string' ? rec.status : null,
    reason: typeof rec.reason === 'string' ? rec.reason : null,
    at: typeof rec.at === 'string' ? rec.at : null,
  }
}

/** 该阶段全部轮次（score + round 按轮次升序合并；同一轮 score 在 round 前）。 */
function roundsOf(stage, entries) {
  const rows = entries
    .filter((r) => r.stage === stage)
    .map(roundEntry)
    .filter((r) => r.round != null)
  rows.sort((a, b) => a.round - b.round || (a.type === 'score' ? -1 : 1))
  return rows
}

/**
 * 自迭代打分结果聚合视图（GET /api/self-iteration 数据源）。
 * @returns {object} { ok, state, stages }
 *   state  —— run-state.json 摘要（无 → null）；lastScore 是本轮打分暂存（未消费）
 *   stages —— 按阶段聚合：{ token, label, aspice, rounds, latest, converged }
 *             只有存在轮次留痕的阶段才会出现；无留痕 → 空数组。
 * 纯只读；任何缺失 → 空数据（不抛）。
 */
export function selfIterationOverview() {
  const runState = readRunState()
  const entries = listSelfIterationEntries()

  const state = runState && typeof runState === 'object'
    ? {
        stage: runState.stage ?? null,
        currentRound: Number.isInteger(runState.currentRound) ? runState.currentRound : 0,
        maxIter: Number.isInteger(runState.maxIter) ? runState.maxIter : 3,
        goal: typeof runState.goal === 'string' ? runState.goal : '',
        status: typeof runState.status === 'string' ? runState.status : 'running',
        converged: runState.converged === true,
        baselineTotal: typeof runState.baselineTotal === 'number' ? runState.baselineTotal : null,
        bestTotal: typeof runState.bestTotal === 'number' ? runState.bestTotal : null,
        lastScore: runState.lastScore && typeof runState.lastScore === 'object'
          ? {
              total: typeof runState.lastScore.total === 'number' ? runState.lastScore.total : null,
              level: typeof runState.lastScore.level === 'string' ? runState.lastScore.level : null,
              weak: Array.isArray(runState.lastScore.weak) ? runState.lastScore.weak : [],
              gateOk: runState.lastScore.gateOk === true,
            }
          : null,
        updatedAt: typeof runState.updatedAt === 'string' ? runState.updatedAt : null,
      }
    : null

  // 有留痕的阶段才进列表（阶段权威 = STAGES 全表；未跑过 → 不在结果里）
  const withTraces = [...new Set(entries.map((r) => r.stage).filter(isStageToken))]
  const stages = withTraces.map((token) => {
    const meta = STAGES[token]
    const rounds = roundsOf(token, entries)
    const latest = rounds.length > 0 ? rounds[rounds.length - 1] : null
    return {
      token,
      label: meta?.label ?? token,
      aspice: meta?.aspice ?? '',
      command: meta?.command ?? '',
      rounds,
      latest,
      converged: latest?.verdict === 'converge' || latest?.verdict === 'converge_by_maxiter',
    }
  })
  stages.sort((a, b) => (STAGES[a.token]?.order ?? 0) - (STAGES[b.token]?.order ?? 0))

  return { ok: true, state, stages }
}
