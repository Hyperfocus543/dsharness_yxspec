// =============================================================================
// cost.mjs — 执行成本统计（GET /api/cost 数据源）
// =============================================================================
// 数据源：既有审计账本（.dsh/gateway-log/<session>/turn-<n>.jsonl，见 harness.mjs
// auditWrite）。聚合口径：
//   · 阶段归属：从 turn/start 的 prompt 里正则取 `- token: <token>`；无 token 的
//     通用咨询/review 归属 _general（prompt 里无 token 时兜底同名）。
//   · runs       = 该阶段 turn/start 条数
//   · elapsedMs  = 每轮 (turn/end.ts − turn/start.ts) 累加；无 turn/end 的轮次
//                  （abort/超时/异常）按 turn/start → 账本扫到的最晚时间计，
//                  上限 TURN_TIMEOUT_MS（30min），避免中途杀掉的轮次虚高。
//   · toolCalls  = 该阶段在轮次内 tool/call 条数
//   · prompt/completionTokens = 从账本里 assistant/message 事件的 usage 累计
//     （harness.mjs 审计层补记；老账本无 usage → 该轮记 0，不报错）。
//   · hasTokenData = 账本里存在任意 usage 记录。
//
// 单价：每百万 token 美元价，可经环境变量覆盖（默认 0 = 不估金额）：
//   YXSPEC_COST_INPUT_PRICE  每百万 input token 单价
//   YXSPEC_COST_OUTPUT_PRICE 每百万 output token 单价
// =============================================================================
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUDIT_ROOT } from './harness.mjs'
import { STAGES } from './stages.mjs'

/** 单轮 agent turn 最长时限（与 harness.mjs TURN_TIMEOUT_MS 对齐）。 */
const TURN_TIMEOUT_MS = 30 * 60 * 1000

/** 阶段排序权重：按 STAGES 定义顺序；未知阶段排在最后。 */
function stageOrderWeight(token) {
  const keys = Object.keys(STAGES)
  const i = keys.indexOf(token)
  return i === -1 ? 9999 + (token.charCodeAt(0) || 0) : i
}

/** 从 turn/start 的 prompt 里提取阶段 token（review 命令也识别）。 */
function stageOfPrompt(prompt) {
  const p = String(prompt ?? '')
  const token = p.match(/- token:\s*([A-Za-z0-9_]+)/)
  if (token) return token[1]
  const review = p.match(/\/yxspec:review\s+([A-Za-z0-9_]+)/)
  if (review) return review[1]
  return null
}

/** 解析一行 JSON；解析失败返回 null。 */
function parseLine(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

/**
 * 聚合审计账本，返回按阶段统计的负载数据。
 * @returns {{
 *   perStage: Array<{token, runs, elapsedMs, promptTokens, completionTokens, toolCalls, lastRunAt}>,
 *   totals: {runs, elapsedMs, promptTokens, completionTokens, toolCalls},
 *   pricePerMillion: {input, output},
 *   hasTokenData: boolean,
 *   note: string
 * }}
 */
export function buildCostStats() {
  const perStage = new Map() // token -> stats
  let toolCallsTotal = 0
  let runsTotal = 0
  let elapsedTotal = 0
  let hasTokenData = false // 账本里出现过任意 usage 记录

  // 账本根不存在 → 空数据
  let sessionDirs = []
  try {
    sessionDirs = readdirSync(AUDIT_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    sessionDirs = []
  }

  for (const session of sessionDirs) {
    const dir = join(AUDIT_ROOT, session)
    let files = []
    try {
      files = readdirSync(dir)
        .filter((f) => /^turn-\d+\.jsonl$/.test(f))
        .sort()
    } catch {
      continue
    }
    if (files.length === 0) continue

    // 当前正在读的轮次：{token, startMs, endMs, tools, lastEventTs}
    let cur = null
    for (const file of files) {
      let lines = []
      try {
        lines = readFileSync(join(dir, file), 'utf8').split('\n')
      } catch {
        continue
      }
      for (const raw of lines) {
        if (!raw.trim()) continue
        const r = parseLine(raw)
        if (!r) continue
        const tsMs = Date.parse(r.ts)
        switch (r.kind) {
          case 'turn/start': {
            // 同一文件可能含多个 turn（轮次计数器未前进时后续事件并入旧文件），
            // 新 turn/start 出现即上一轮终结（或已被放弃）→ 先结清再开新轮。
            if (cur) settleTurn(perStage, cur)
            const stage = stageOfPrompt(r.prompt) ?? '_general'
            if (!perStage.has(stage)) {
              perStage.set(stage, {
                token: stage,
                runs: 0,
                elapsedMs: 0,
                promptTokens: 0,
                completionTokens: 0,
                toolCalls: 0,
                lastRunAt: null,
              })
            }
            perStage.get(stage).runs += 1
            runsTotal += 1
            cur = { stage, startMs: tsMs, endMs: null, tools: 0, lastEventTs: tsMs, promptTokens: 0, completionTokens: 0 }
            break
          }
          case 'tool/call': {
            if (cur) {
              cur.tools += 1
              toolCallsTotal += 1
              if (Number.isFinite(tsMs)) cur.lastEventTs = Math.max(cur.lastEventTs, tsMs)
            }
            break
          }
          case 'tool/result': {
            if (cur && Number.isFinite(tsMs)) cur.lastEventTs = Math.max(cur.lastEventTs, tsMs)
            break
          }
          case 'assistant/message': {
            // 本轮模型输出 token 摘要（harness.mjs 审计层补记）；老账本无此事件 → 记 0。
            if (cur && r.usage && typeof r.usage === 'object') {
              const inT = Number(r.usage.inputTokens) || 0
              const outT = Number(r.usage.outputTokens) || 0
              if (inT > 0 || outT > 0) {
                cur.promptTokens += inT
                cur.completionTokens += outT
                hasTokenData = true
              }
            }
            if (cur && Number.isFinite(tsMs)) cur.lastEventTs = Math.max(cur.lastEventTs, tsMs)
            break
          }
          case 'turn/end': {
            if (cur) {
              cur.endMs = Number.isFinite(tsMs) ? tsMs : null
              cur.lastEventTs = Math.max(cur.lastEventTs, Number.isFinite(tsMs) ? tsMs : cur.lastEventTs)
            }
            break
          }
          default:
            break
        }
      }
    }
    // session 扫完：结清最后打开的轮次
    if (cur) settleTurn(perStage, cur)
  }

  // 排序 + 汇总
  const perStageArr = [...perStage.values()]
    .sort((a, b) => stageOrderWeight(a.token) - stageOrderWeight(b.token))

  let promptTokensTotal = 0
  let completionTokensTotal = 0
  for (const s of perStageArr) {
    promptTokensTotal += s.promptTokens
    completionTokensTotal += s.completionTokens
    elapsedTotal += s.elapsedMs
  }

  return {
    perStage: perStageArr,
    totals: {
      runs: runsTotal,
      elapsedMs: elapsedTotal,
      promptTokens: promptTokensTotal,
      completionTokens: completionTokensTotal,
      toolCalls: toolCallsTotal,
    },
    pricePerMillion: {
      input: Number(process.env.YXSPEC_COST_INPUT_PRICE) || 0,
      output: Number(process.env.YXSPEC_COST_OUTPUT_PRICE) || 0,
    },
    hasTokenData,
    note: '数据源为审计账本（.dsh/gateway-log）。token usage 由 harness 审计层从 SDK 事件流补记；' +
      '老账本（改前执行）无 usage 记录，token 计 0。耗时/次数为真实执行负载。' +
      '单价未配置时为 0（仅显示 token 数，不估金额）。',
  }
}

/** 结清一轮：elapsed 上限 TURN_TIMEOUT_MS，归入 perStage。 */
function settleTurn(perStage, cur) {
  const s = perStage.get(cur.stage)
  if (!s) return
  let elapsed = 0
  if (cur.endMs && Number.isFinite(cur.endMs) && cur.endMs >= cur.startMs) {
    elapsed = cur.endMs - cur.startMs
  } else if (Number.isFinite(cur.startMs) && cur.lastEventTs >= cur.startMs) {
    elapsed = cur.lastEventTs - cur.startMs
  }
  s.elapsedMs += Math.max(0, Math.min(elapsed, TURN_TIMEOUT_MS))
  s.toolCalls += cur.tools
  s.promptTokens += cur.promptTokens
  s.completionTokens += cur.completionTokens
  const last = cur.endMs ?? cur.lastEventTs
  if (Number.isFinite(last)) {
    if (!s.lastRunAt || last > Date.parse(s.lastRunAt)) {
      s.lastRunAt = new Date(last).toISOString()
    }
  }
}
