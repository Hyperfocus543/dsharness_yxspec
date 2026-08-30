// =============================================================================
// @yxspec/self-iteration — 自迭代轮次状态机 + 评分 + 基线护栏结构化
// =============================================================================
// 目标（把同事自迭代智能体从「Claude Code skill/提示词执行」升级为
//       「DSH harness 结构化的 Cordis 插件执行」，核心 = 上下文管控）：
//   轮次状态由插件维护（state/run-state.json 结构化读写），不靠 LLM 记忆
//   记得「跑到第几轮、这轮多少分、基线是多少」——本轮上下文里只放状态摘要。
//
// 职责（薄胶水，照 aspice-trajectory / git-workspace 的接线方式）：
//   1. 识别自迭代轮次会话：订阅 session/event，从 agent/inbox/spliced 注入的
//      prompt 命中 `/yxspec:self-iterate <stage> [--max-iter=N] [--goal=...]
//      [--resume]`（复用网关 stages.mjs 权威表解析 stage 名）→ 初始化 run-state
//      （{ stage, currentRound, maxIter, goal, rounds:[...], status, ... }）。
//   2. 轮次状态机（上下文管控核心）：在每轮自跑 `/yxspec:{stage}` 结束
//      （turn/end）时，插件更新状态机 —— 判定收敛/继续/降级由插件做（读评分
//      输出），LLM 不靠记忆；状态只含可确定性判定的摘要，模型每轮读到的
//      轮次/分数/基线来自插件状态，不是自述。
//   3. 评分 tool 注册：把同事的 score_aggregate.py 注册为 `self_iter_score`
//      tool，agent 可调用拿分数（Master/Stage/Total/等级/弱项/门禁）。tool
//      内部 child_process.execFile('python', ['score_aggregate.py', ...],
//      { cwd: 同事的 self-iteration 目录 })（无 shell 拼接），stdout 结构化
//      返回。这是「禁 LLM 自评」的落实——评分走确定性脚本，不是 LLM 手写。
//      tool 双模式：product（缺省）= 评阶段产物（上述路径）；framework = 评框架
//      效率——落盘本轮打分记录（runtime-data/self-iteration/framework-scores/round-{n}.json）
//      并与上一轮对比（score_core.py --eval-framework，同事 score-standard-v3 §9 效率判定），
//      返回 framework 子对象（decision/quadrant/效率增量）。框架判定同样走确定性
//      脚本，禁 LLM 手写；脚本不可用照降级范式返回 degraded，不抛错。
//   4. 留痕写轨迹：每轮打分/基线/轮次状态写进
//      gateway/runtime-data/trajectory/self_iteration/<stage>-<seq>.jsonl
//      （与 aspice-trajectory 同一根目录族；runtime-data gitignore 排除），
//      让门控/驾驶舱能拿到自迭代证据。
//   5. 优雅降级：同事的脚本不可用（路径不存在 / python 没装 / 脚本报错）→
//      不抛错，只记日志；tool 返回 degraded 状态；命令仍走「提示词引导」
//      旧路径（插件不拦截、不改 LLM 流程），自迭代照常以旧方式执行。
//
// 红线：不动 harness 主仓源码；不读 baselines/_monitor；不 git 操作；
//       只读消费同事的 self-iteration 目录（绝不写它）；不改 .dsh/vendor。
//
// 状态/留痕落盘（网关侧，非同事目录）：
//   - 状态根：gateway/runtime-js/runtime-data/self-iteration/run-state.json
//     （可经 env YXSPEC_SELF_ITERATION_STATE_ROOT 覆盖，副本网关冒烟用）
//   - 轨迹根：gateway/runtime-js/runtime-data/trajectory/self_iteration/
//     （可经 env YXSPEC_TRAJECTORY_ROOT 覆盖，与 aspice-trajectory 同源）
//
// 事件形状（2026-08-27 aspice-trajectory POC 实测，root ctx 直达）：
//   - agent/inbox/spliced → 注入 prompt（阶段/自迭代命令边界判定源）
//   - turn/end { turn, reason:{ kind: completed|error|max-tokens|aborted|... } }
//   - 详见 @yxspec/aspice-trajectory/index.js 头注释 §2（同一订阅范式）。
// =============================================================================
// 坑（aspice-trajectory 2026-08-27 实测）：ctx.effect 的清理函数必须作为
//   返回值 return，写在回调体内会在激活瞬间（mount 后 ~2ms）立刻 unsubscribe。
//   正确形态见文件底部 effect 块（body=激活日志，return=dispose 清理）。
// =============================================================================

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

// ----------------------------------------------------------------------------
// 路径常量
// ----------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url))
// 网关侧状态根：gateway/runtime-js/runtime-data/self-iteration/
const DEFAULT_STATE_ROOT = join(__dirname, '..', '..', '..', 'runtime-data', 'self-iteration')
// 轨迹根：与 aspice-trajectory 同源（env YXSPEC_TRAJECTORY_ROOT 覆盖）
const DEFAULT_TRAJ_ROOT = join(__dirname, '..', '..', '..', 'runtime-data', 'trajectory')
// 同事自迭代 scripts 目录（只读参考，score_aggregate.py 等确定性脚本所在）：
// 可经 env YXSPEC_SELF_ITERATION_SCRIPTS 覆盖
const DEFAULT_PEER_SELF_ITER_SCRIPTS = 'D:/Work/04_Temp/03_Peers/aima_x1_bcm/汇报资料/self-iteration/scripts'

export const name = 'self-iteration'
// 需要 sessions 订阅事件（aspice-trajectory 实测：root ctx 直达须声明 inject）
export const inject = ['sessions', 'tools']

// 纯函数导出（单测/驾驶舱诊断复用；与 yxspec-tool-guard 导出判定的范式一致）
export { parseSelfIterate, resolveStageToken, decide }

/** 阶段命令 → token 权威表（复用网关 stages.mjs；harness 外运行/加载失败 → 空表，
 *  此时不解析阶段，只做事件兜底，不抛错）。 */
let CMD_TOKENS = null
try {
  const mod = await import('../../../../lib/stages.mjs')
  const map = new Map()
  for (const [token, st] of Object.entries(mod?.STAGES ?? {})) {
    if (st?.command) map.set(st.command, token)
  }
  if (map.size > 0) CMD_TOKENS = map
} catch {
  CMD_TOKENS = null
}

/** 从 agent/inbox/spliced 提取注入的文本（user 角色 content 拼接）。 */
function promptFromInbox(data) {
  const inserted = Array.isArray(data?.inserted) ? data.inserted : []
  const parts = []
  for (const ins of inserted) {
    if (!ins || typeof ins !== 'object') continue
    if (ins.source?.kind === 'system' && !ins.role) continue // 系统注入跳过（非用户 prompt）
    for (const block of ins.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/**
 * 边界感知匹配（与 stages.mjs resolveStage 同规则：命令后必须跟 空白/标点/结尾）。
 * 返回 { stageRaw, maxIter, goal, resume, mode } 或 null（非自迭代命令）。
 * 只做参数抽取（纯函数）：stage 的权威 token 解析由 resolveStageToken 在
 * apply() 内完成（需要 stateRoot 做 --resume 回落 + CMD_TOKENS 归一）。
 */
function parseSelfIterate(prompt) {
  const text = String(prompt ?? '')
  // 命令必须独立成词：前导不能是词字符（防 "axyxspec:self-iterate"），
  // 命令名内连字符非词字符，故用 [^\w] 而非 \b 做前导边界。
  const m = /(?:^|[^\w])yxspec:self-iterate\b/.exec(text)
  if (!m) return null
  const rest = text.slice(m.index + m[0].length)
  // 命令后必须边界（空白/标点/结尾）。原写法 `/^[边界]|$/` 因 `|` 优先级问题：
  // `$` 分支未锚定 → 该检查恒真（死代码），命令后接任意字符（如 `-swe`）也放行。
  // 修正为 `/^(?:[边界]|$)/`，与 stages.mjs resolveStage 边界规则对齐。
  if (!/^(?:[\s.,;:!?，。；：！？、)）]|$)/.test(rest)) return null

  // 参数提取：--key=value / --key "value with space" / --key 'single' / --key value / --flag
  const flagVal = (key) => {
    const eq = new RegExp(`--${key}\\s*=\\s*(?:"([^"]*)"|(\\S+))`).exec(rest)
    if (eq) return eq[1] ?? eq[2]
    // 空格分隔形态支持引号包裹值（与注释声明的 `--key "value with space"` 对齐）：
    // 此前 `([^\s"']+)` 只取引号内第一段，`--goal "Total>=80 且门禁全绿"` 会截断成 "Total>=80"。
    const sp = new RegExp(`--${key}\\s+(?:"([^"]*)"|'([^']*)'|(\\S+))`).exec(rest)
    if (sp) return sp[1] ?? sp[2] ?? sp[3]
    return null
  }
  const maxIterRaw = flagVal('max-iter')
  const goal = flagVal('goal')
  const stageRaw0 = flagVal('stage')
  const resume = /(?:^|\s)--resume(?:\s|$)/.test(rest)
  // mode：显式 --mode=product|framework 命中取之；未指定 → null（延续 run-state 既有 mode，
  // 由 openRun 覆盖逻辑决定——新 run 回落 product，续跑保持 run 原模式）。
  // 非法值（--mode=bogus）→ null 同未指定（不误覆盖）；execSelfIterScore 侧 `?? 'product'` 归一兜底。
  const modeRaw = flagVal('mode')
  const mode = /^(product|framework)$/.test(String(modeRaw ?? '')) ? modeRaw : null

  // stage：优先显式 --stage=，否则取命令后第一个非 flag 裸词（阶段命令名/token）。
  // 剥离带值 flag 时须与 flagVal 支持的形态对称（`--key=val` / `--key "带空格值"` /
  // `--key '单引号'` / `--key val`）。此前只剥 `=` 连写与裸 flag，导致
  // `--goal "Total>=80 且门禁全绿" sqt-script-gen` 这类 flag 在前的写法把引号值
  // `"Total>=80` 当成本阶段（resolveStageToken 失败 → 静默降级不开 run）。
  // 只剥已知带值 flag（与 flagVal 取值口径一致）；布尔 flag --resume 不带值，单独剥。
  let stageRaw = stageRaw0
  if (!stageRaw) {
    const after = rest
      .replace(
        /--(?:max-iter|goal|stage|round|repo-root|run-dir|session|mode|time-min)(?:\s*=\s*(?:"[^"]*"|'[^']*'|\S+)|(?:\s+(?:"[^"]*"|'[^']*'|\S+)))?/g,
        ' ',
      )
      .replace(/--resume(?:\s|$)/g, ' ')
      .trim()
    const first = after.split(/\s+/)[0] || ''
    if (first) stageRaw = first
  }
  // maxIter 钳制 [1,10]（与前端 buildSelfIterateCommand 派活钳制同口径）：轮数是
  // 状态机收敛边界（roundNo >= maxIter 收束），越界值必须就地归一——`--max-iter=999`
  // 会让自迭代最多跑 999 轮（无成本约束的失控循环），`--max-iter=0` 则首轮即
  // converge_by_maxiter（roundNo 1 >= 0 恒真，run 形同虚设）。解析出数字后钳进
  // 合法域再返回，LLM 手写/前端直传命令都落在同一安全边界内。
  const maxIterNum = maxIterRaw != null && /^\d+$/.test(maxIterRaw) ? Number(maxIterRaw) : null
  const maxIter = maxIterNum != null ? Math.min(10, Math.max(1, maxIterNum)) : null
  return {
    stageRaw: stageRaw || null,
    maxIter,
    goal: goal || null,
    resume,
    mode,
  }
}

/** 阶段串（下划线 token 或连字符命令名）→ 权威 token；解析失败 → null。
 *  解析顺序（由具体到兜底）：
 *   1. 下划线 token 原样（`swe_arch` → `swe_arch`）
 *   2. 完整命令名（连字符形态，`swe-arch-v2` → `swe_arch`）
 *   3. 反查 token 表：连字符表单（`swe-arch` → `swe_arch`）
 *   4. 兜底归一：下划线表单再查一次（`swe_arch_if` 这类**含下划线的连字符**原样
 *      撞 CMD_TOKENS 值失败时，归一为连字符 `swe-arch-if` 才可能命中）。
 *      注意不可用裸 `kebab` 替代表值去兜底：kebab 是**命令名**形态，不是 token 形态
 *      （`swe-arch` 撞命令表只会因前缀/后缀关系误命中——权威表命令名是
 *      `/yxspec:swe-arch-v2`，`swe-arch` 与其无任何精确匹配，取 `t===kebab` 恒 null），
 *      而 token 表的键都是下划线 token（`swe_arch_if`），与 `swe-arch-if` 也无一字相等。
 *      此前 `if (!CMD_TOKENS) return kebab` 对 harness 外（无表）运行是合理的命令名
 *      兜底；表存在时用它反查却恒落空 → 命令命中但 resolveStageToken 失败 → 静默不开
 *      run（自迭代轮次状态机形同虚设）。 */
function resolveStageToken(raw) {
  if (!raw) return null
  const kebab = String(raw).replace(/_/g, '-')
  if (!CMD_TOKENS) return kebab // 权威表不可用 → 用连字符形式兜底（阶段名即命令名）
  for (const [cmd, t] of CMD_TOKENS) {
    if (cmd === `/yxspec:${kebab}` || t === raw || t === kebab) return t
  }
  // 兜底：把用户输入当成 token 的下划线归一形态再查（token 表键即下划线 token）。
  // 覆盖「连字符命令名」与「含下划线的命令名」两类输入，保证任何能写出合法阶段的
  // 拼写（前端 buildSelfIterateCommand 派活、agent 手写命令）都落回权威 token。
  const under = String(raw).replace(/-/g, '_')
  if (under !== raw) {
    for (const t of CMD_TOKENS.values()) {
      if (t === under) return t
    }
  }
  return null
}

// ----------------------------------------------------------------------------
// run-state 读写（网关侧结构化状态，上下文管控核心）
// ----------------------------------------------------------------------------
const DEFAULT_MAX_ITER = 3

/** 空 run-state 模板（与同事 loop_engine.load_state 语义对齐；lastScore 为
 *  本轮打分暂存，finishRound 消费后清空）。 */
function emptyState(stage) {
  const now = new Date().toISOString()
  const session = now.slice(0, 13).replace(/[-:T]/g, '') // 20260828T14（会话标识）
  return {
    schema: 'self-iteration/run-state/v1',
    stage,
    maxIter: DEFAULT_MAX_ITER,
    goal: '',
    mode: 'product', // 评估模式（product=评阶段产物 / framework=评框架效率），openRun 覆盖
    sessionId: session,
    sessionStartedAt: now,
    currentRound: 0,
    rounds: [],
    converged: false,
    status: 'running', // running | converged | dropped | stopped
    stopPoint: null,
    baselineTotal: null, // 比较基线（首轮打分冻结，advanceState 锚定 / decide 降级判定）
    bestTotal: null,
    lastScore: null, // { total, level, weak, gateOk }（本轮打分暂存）
    updatedAt: now,
  }
}

/** 读 run-state.json（网关侧）；无 → null。 */
function readRunState(stateRoot) {
  try {
    const p = join(stateRoot, 'run-state.json')
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/** 写 run-state.json（UTF-8）。 */
function writeRunState(stateRoot, st) {
  try {
    mkdirSync(stateRoot, { recursive: true })
    st.updatedAt = new Date().toISOString()
    writeFileSync(join(stateRoot, 'run-state.json'), JSON.stringify(st, null, 2) + '\n', 'utf8')
  } catch {
    // 写失败不抛（不干扰 agent）；仅日志
  }
}

// ----------------------------------------------------------------------------
// turn/end reason → 本轮结果状态（判定收敛/继续/降级由插件做）
// ----------------------------------------------------------------------------
/** turn/end reason 是否属于"一轮自跑正常收尾"（completed 才计入轮次判定；
 *  异常收尾 → 本轮作废，不消耗轮次上限，等待重跑）。 */
function isRoundEndReason(reason) {
  return reason === 'completed'
}

/**
 * 判定本轮 verdict（与同事 loop_engine.decide 语义对齐）：
 *   - 降级：总分 < 比较基线（严格小于；持平 = 未退化，不算降级）→ degrade
 *   - 收敛：goal 达（Total>=N / Total>N / 门禁全绿）→ converge
 *   - 用满：round >= maxIter → converge_by_maxiter
 *   - 否则 continue
 * 纯函数：读 state + 本轮分数，不靠 LLM 记忆。
 */
function decide(roundNo, total, baselineTotal, goal, gateOk, maxIter) {
  const g = String(goal ?? '').trim()
  // 封顶优先于降级：roundNo 已达 maxIter → 本轮无论 degrade/continue 都收束
  // （converge_by_maxiter，状态置 converged）。否则「末轮降级」会置 status='running'、
  // stopPoint='degrade_round_N'，而 advanceState 不递增 currentRound → roundNo 恒 1、
  // roundNo>=maxIter 永不触发，自迭代死循环。
  if (roundNo >= (maxIter || DEFAULT_MAX_ITER)) return 'converge_by_maxiter'
  // 降级判定只在"本轮确实有分"时才有意义：total 缺失（score tool 降级/未调用）时
  // `total < baselineTotal` 恒真（null<N），会无限 degrade、converge_by_maxiter
  // 永不触发 → 自迭代死循环。无分轮不判降级，交由下方 roundNo>=maxIter 兜底收束。
  // 严格小于（`<` 而非 `<=`）：持平 = 本轮与基线同分，不算退化。否则 baseline 冻结后
  // 首次改分仍与基线同分（如 baseline=80、goal "Total>=80"、本轮 80）会被误判 degrade，
  // goal 已达标也不 converge，白白回滚。
  if (total != null && baselineTotal != null && total < baselineTotal) return 'degrade'
  // 目标解析：正则提取 "Total>=80" / "Total>80" / "Total >= 80"（含小数），
  // 其余文本（如 "且门禁全绿"）视为附加条件。此前用 g.split('>=')[1] 硬切，
  // 复合目标会得到 Number('80 且门禁全绿')=NaN → total>=NaN 恒 false，
  // 复合 goal 永不收敛，且 gateOk 兜底对复合 goal 是死代码。
  const m = /Total\s*([>]=?)\s*(\d+(?:\.\d+)?)/.exec(g)
  let goalMet = false
  if (m) {
    const target = Number(m[2])
    goalMet = m[1] === '>=' ? total >= target : total > target
    // 复合目标（如 "Total>=80 且门禁全绿"）：分数达标后仍须门禁全绿
    if (goalMet && g.length > m[0].length) goalMet = gateOk === true
  } else {
    goalMet = gateOk === true // 未给 goal / strict/drift 全绿 → 门禁全绿即达
  }
  if (goalMet) return 'converge'
  return 'continue'
}

/** 判定后更新 run-state：推进轮次、写本轮记录、置 status/stopPoint。 */
function advanceState(st, roundNo, total, score, verdict) {
  const round = {
    round: roundNo,
    total: typeof total === 'number' ? Math.round(total * 100) / 100 : null,
    level: score?.level ?? null,
    weak: Array.isArray(score?.weak) ? score.weak : [],
    verdict,
    gateOk: score?.gateOk === true,
    scoredAt: new Date().toISOString(),
  }
  st.rounds = (Array.isArray(st.rounds) ? st.rounds : []).filter((r) => r.round !== roundNo)
  st.rounds.push(round)
  st.rounds.sort((a, b) => a.round - b.round)
  st.currentRound = roundNo

  if (verdict === 'degrade') {
    // 降级 → 本轮丢弃，下一轮基于最后的好架构重改
    st.stopPoint = `degrade_round_${roundNo}`
    st.status = 'running'
  } else if (verdict === 'converge' || verdict === 'converge_by_maxiter') {
    st.converged = true
    st.bestTotal = typeof total === 'number' ? Math.round(total * 100) / 100 : null
    st.stopPoint = verdict === 'converge' ? null : `maxiter_round_${roundNo}`
    st.status = 'converged'
  } else {
    // continue → 下一轮
    st.stopPoint = null
    st.status = 'running'
    if (typeof total === 'number') st.bestTotal = Math.round(total * 100) / 100
  }
  st.lastScore = null // 消费掉本轮打分暂存
  // 比较基线锚定（"改前冻结快照"）：首轮打分即原始架构分数，冻结为 baseline，
  // 后续轮次与之对比（decide 里 total <= baselineTotal → degrade 回滚）。
  // 此前 baselineTotal 从未被写入 → 降级护栏永远不触发。空 run-state 重启 /
  // 换阶段时 baseline 复位为 null，由新一轮首分重新锚定。
  if (st.baselineTotal == null && typeof total === 'number') {
    st.baselineTotal = Math.round(total * 100) / 100
  }
  return st
}

// ----------------------------------------------------------------------------
// 留痕：轨迹 JSONL（runtime-data/trajectory/self_iteration/<stage>-<seq>.jsonl）
// ----------------------------------------------------------------------------
/** 文件名段 → 归一化 stage 名（与 appendTrajectory 文件名 sanitize 同规则）。 */
function sanitizeStage(stage) {
  return String(stage ?? '').replace(/[^a-z0-9_]/g, '_')
}

/** 某阶段在自迭代轨迹目录现有最大 seq + 1（scan 目录，按阶段过滤，无则 1）。
 *  必须按阶段过滤：目录里混着多阶段的留痕文件，全局 max+1 会把后写阶段的
 *  seq 顶到 N+1，其文件名（只含 `<stage>-<seq>`，无阶段前缀）恰好复用已有
 *  文件的路径 → appendFileSync 追加进他人文件，自迭代留痕被污染。 */
function nextSeqFor(dir, stage) {
  const prefix = sanitizeStage(stage)
  try {
    let max = 0
    for (const it of readdirSync(dir)) {
      const m = new RegExp(`^${prefix}-(\\d+)\\.jsonl$`).exec(it)
      if (m) max = Math.max(max, Number(m[1]))
    }
    return max + 1
  } catch {
    return 1
  }
}

/** 追加一条自迭代留痕 JSONL（打分/基线/轮次状态）。返回文件路径或 null。 */
function appendTrajectory(trajRoot, stage, entry) {
  try {
    const dir = join(trajRoot, 'self_iteration')
    mkdirSync(dir, { recursive: true })
    const seq = nextSeqFor(dir, stage)
    const file = join(dir, `${sanitizeStage(stage)}-${String(seq).padStart(3, '0')}.jsonl`)
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
    return file
  } catch {
    return null
  }
}

// ----------------------------------------------------------------------------
// self_iter_score tool：确定性评分（禁 LLM 自评）
// ----------------------------------------------------------------------------
/** 解析 score_aggregate.py 的 stdout 里的 "Master=.. Stage=.. Total=.. 等级=.. 弱项=.."。 */
function parseScoreLine(out) {
  const m = /Master=([\d.]+)\s+Stage=([\d.]+)\s+Total=([\d.]+)\s+等级=([A-D])\s+弱项=([^\n]*)/.exec(out)
  if (!m) return null
  return {
    master: Number(m[1]),
    stage: Number(m[2]),
    total: Number(m[3]),
    level: m[4],
    weak: m[5].split(',').map((s) => s.trim()).filter(Boolean),
  }
}

/**
 * execFile 封装：无 shell 拼接（红线：防注入）。超时 120s（打分含机械扫描）。
 * 成功 → { ok:true, stdout, stderr }；失败/超时 → { ok:false, error }（不抛）。
 * env 必须注入 PYTHONUTF8=1 + PYTHONIOENCODING=utf-8（与同事 common.py run_cmd
 * 同策略）：Windows 下 python 默认按 locale（GBK）写 stdout，Node 按 utf8 读会
 * 乱码（实测 等级/弱项 变 U+FFFD）——注入后 python 以 UTF-8 输出，解析才可靠。
 */
function runPython(args, { cwd, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      'python',
      args,
      {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        encoding: 'utf8',
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: String(err?.message ?? err), stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
        } else {
          resolve({ ok: true, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
        }
      },
    )
  })
}

/** 门禁全绿推断（score_aggregate.py stdout 无显式门禁行；有 [gate fail] 行 → 非全绿）。 */
function inferGateOk(out) {
  return !/\[gate fail\]/.test(out)
}

/**
 * self_iter_score tool 执行体：调同事的 score_aggregate.py，结构化返回。
 * 双模式（args.mode）：
 *   - product（缺省）= 评阶段产物（现有路径）：返回 Master/Stage/Total/等级/弱项。
 *   - framework = 评框架效率：落盘本轮打分记录（framework-scores/round-{n}.json），
 *     与上一轮记录对比（score_core.py --eval-framework，同事 score-standard-v3 §9 效率判定），
 *     返回 framework 子对象；首轮（无上一轮）→ decision:'baseline'。
 * 任何不可用（脚本缺 / python 挂 / 脚本崩溃 / JSON 解析失败）→ 返回 degraded:true，不抛错。
 * @param {{ stage, round, repoRoot, runDir, session, mode, timeMin }} args 已校验的参数
 * @param {{ scriptsDir: string, defaultRepoRoot: string, stateRoot: string }} state 插件上下文
 */
async function execSelfIterScore(args, state) {
  const { stage, runDir, round } = args || {}
  const stageName = String(stage ?? '').trim() || null
  const roundNo = round == null ? null : Number(round)
  // mode：product（缺省，评阶段产物）/ framework（评框架效率）。非法值 → product（parseSelfIterate 同口径）。
  const mode = String(args?.mode ?? 'product') === 'framework' ? 'framework' : 'product'
  if (!stageName) {
    return { ok: false, degraded: false, error: 'missing-stage', message: '必须提供 stage（节点名，如 sqt-script-gen）' }
  }

  // 降级①：同事脚本目录/脚本不存在
  const scoreScript = join(state.scriptsDir, 'score_aggregate.py')
  if (!existsSync(scoreScript)) {
    return {
      ok: true,
      degraded: true,
      reason: 'peer-self-iteration-unavailable',
      message: `未找到同事的 score_aggregate.py（${scoreScript}）。评分 tool 降级：请走提示词引导路径或人工评分，禁止 LLM 手写分数。`,
      error: null,
      stdout: '', stderr: '',
    }
  }

  // repo-root 缺省 = 项目根（score_aggregate 的产物扫描基准；不落 scriptsDir，
  // 否则会把同事脚本目录当产物区）。execFile cwd=scriptsDir 让脚本的
  // SELF_ITER_DIR（配置 references/standard + reports 输出）落在同事目录。
  const repoRoot = String(args?.repoRoot || state.defaultRepoRoot || '')
  const pyArgs = ['score_aggregate.py', '--stage', stageName]
  if (repoRoot) pyArgs.push('--repo-root', repoRoot)
  if (runDir) pyArgs.push('--run-dir', String(runDir))
  if (roundNo && Number.isFinite(roundNo)) pyArgs.push('--round', String(roundNo))
  if (args?.session) pyArgs.push('--session', String(args.session))

  const res = await runPython(pyArgs, { cwd: state.scriptsDir })
  if (!res.ok) {
    // 降级②：python 没装 / 脚本崩溃 → 不抛给 agent
    return {
      ok: true,
      degraded: true,
      reason: 'score-script-failed',
      message: `score_aggregate.py 执行失败：${res.error || res.stderr || '未知错误'}。降级：请走提示词引导路径，禁止 LLM 手写分数。`,
      error: null,
      stdout: res.stdout, stderr: res.stderr,
    }
  }

  const parsed = parseScoreLine(res.stdout)
  // 降级③：脚本正常退出但 stdout 无法解析（版本/输出格式变化、非本阶段错误消息）。
  // 此时 parseScoreLine 返回 null，若把 `parsed:null` 当"成功打分"（degraded:false），
  // execute 会用哨兵 -1 当作分数回填 tool 结果 → decide() 把 -1 当真分参与降级
  // 判定（total<=baseline 恒真）→ 自迭代无限 degrade 死循环。无分可评必须显式降级，
  // 不向 agent 抛 -1；且不暂存 lastScore（下方 execute 仅 res.ok && !res.degraded
  // 才写盘），本轮按"无分轮"走 roundNo 兜底。
  if (!parsed) {
    return {
      ok: true,
      degraded: true,
      reason: 'score-parse-failed',
      message: `score_aggregate.py 输出无法解析（可能脚本版本/输出格式变化或非本阶段错误消息）。stdout: ${String(res.stdout).slice(0, 200)}。降级：请走提示词引导路径，禁止 LLM 手写分数。`,
      error: null,
      stdout: res.stdout, stderr: res.stderr,
    }
  }

  // ---- framework 模式：评框架效率（同事 score_core.py --eval-framework，§9）----
  // 分数（total）复用上面 score_aggregate 的结果；time_min 取 agent 显式观测或
  // run-state 会话时长折算。打分记录落 yxspec 侧 framework-scores/（不写同事目录）。
  // 与上一轮记录对比 → decision/quadrant/效率增量；首轮无上一轮 → baseline。
  // 任何不可用（score_core 缺失 / python 挂 / JSON 解析失败）→ degraded:true，不抛，
  // 不落 lastScore（框架判定非本轮产物分，不进轮次状态机）。
  if (mode === 'framework') {
    // 1) time_min：agent 显式观测（timeMin>0）优先；否则 run-state 会话时长折算
    //    （sessionStartedAt → now 分钟数，下限 0.1）；两者都没有 → 降级（无耗时算不了效率）。
    let timeMin = null
    const timeRaw = args?.timeMin
    if (typeof timeRaw === 'number' && Number.isFinite(timeRaw) && timeRaw > 0) {
      timeMin = timeRaw
    } else if (state.stateRoot) {
      const st = readRunState(state.stateRoot)
      const t0 = st?.sessionStartedAt ? Date.parse(st.sessionStartedAt) : NaN
      if (Number.isFinite(t0) && t0 > 0) {
        timeMin = Math.max(0.1, (Date.now() - t0) / 60000)
      }
    }
    if (timeMin == null) {
      // 降级：无 timeMin 且 run-state 无 sessionStartedAt → 照降级范式不抛
      return {
        ok: true,
        degraded: true,
        reason: 'framework-no-time',
        message: 'framework 模式缺少本轮耗时：未传 timeMin 且 run-state 无 sessionStartedAt。降级：无法算效率，请 agent 观测本轮耗时后以 timeMin 重试。',
        error: null,
        stdout: res.stdout, stderr: res.stderr,
      }
    }

    // 2) 本轮打分记录落盘（yxspec 侧 framework-scores/round-{n}.json，UTF-8）
    const fwRound = roundNo && Number.isFinite(roundNo) && roundNo > 0 ? roundNo : 1
    const fwRoot = join(state.stateRoot, 'framework-scores')
    const curPath = join(fwRoot, `round-${fwRound}.json`)
    const prevPath = join(fwRoot, `round-${fwRound - 1}.json`)
    try {
      mkdirSync(fwRoot, { recursive: true })
      writeFileSync(curPath, JSON.stringify({
        stage: stageName,
        round: fwRound,
        total: parsed.total,
        time_min: timeMin,
        at: new Date().toISOString(),
      }, null, 2) + '\n', 'utf8')
    } catch (e) {
      // 落盘失败（目录不可写等）→ 降级，不抛
      return {
        ok: true,
        degraded: true,
        reason: 'framework-eval-failed',
        message: `framework 打分记录落盘失败：${String(e?.message ?? e)}。降级：跳过框架判定。`,
        error: null,
        stdout: res.stdout, stderr: res.stderr,
      }
    }

    // 3) 首轮（无上一轮记录）→ baseline，不调 score_core；否则对比效率
    if (!existsSync(prevPath)) {
      return {
        ok: true,
        degraded: false,
        stage: stageName,
        round: roundNo,
        stdout: res.stdout,
        parsed,
        gateOk: inferGateOk(res.stdout),
        framework: { decision: 'baseline' },
        message: `framework 首轮 baseline：round-${fwRound} Total=${parsed.total} time_min=${timeMin}。下一轮起对比效率。`,
      }
    }

    // 4) 调 score_core.py --eval-framework（同事 §9 框架效率判定）
    const coreScript = process.env.YXSPEC_SELF_ITERATION_SCORE_CORE
      || join(state.scriptsDir, '..', 'references', 'standard', 'score', 'score_core.py')
    if (!existsSync(coreScript)) {
      return {
        ok: true,
        degraded: true,
        reason: 'framework-eval-failed',
        message: `未找到同事的 score_core.py（${coreScript}）。降级：跳过框架效率判定（打分记录已落盘 round-${fwRound}.json）。`,
        error: null,
        stdout: res.stdout, stderr: res.stderr,
      }
    }
    // cwd=score_core.py 所在目录（其内部 SELF_ITER_DIR / score_registry 相对该目录解析）。
    const coreRes = await runPython(
      ['score_core.py', '--eval-framework', '--before', prevPath, '--after', curPath],
      { cwd: dirname(coreScript) },
    )
    if (!coreRes.ok) {
      return {
        ok: true,
        degraded: true,
        reason: 'framework-eval-failed',
        message: `score_core.py --eval-framework 执行失败：${coreRes.error || coreRes.stderr || '未知错误'}。降级：跳过框架效率判定。`,
        error: null,
        stdout: coreRes.stdout, stderr: coreRes.stderr,
      }
    }
    let fw = null
    try {
      fw = JSON.parse(coreRes.stdout)
    } catch {
      return {
        ok: true,
        degraded: true,
        reason: 'framework-eval-failed',
        message: `score_core.py 输出 JSON 解析失败（stdout: ${String(coreRes.stdout).slice(0, 200)}）。降级：跳过框架效率判定。`,
        error: null,
        stdout: coreRes.stdout, stderr: coreRes.stderr,
      }
    }
    // 归一 framework 子对象：只带非空字段（决策/象限为字符串，效率为数值；
    // 缺失字段不落 null——schema 子集不支持 union，参照现有序字段哨兵纪律）。
    const framework = {}
    if (typeof fw?.decision === 'string' && fw.decision) framework.decision = fw.decision
    if (typeof fw?.quadrant === 'string' && fw.quadrant) framework.quadrant = fw.quadrant
    if (typeof fw?.efficiency_before === 'number') framework.efficiency_before = fw.efficiency_before
    if (typeof fw?.efficiency_after === 'number') framework.efficiency_after = fw.efficiency_after
    if (typeof fw?.efficiency_change_pct === 'number') framework.efficiency_change_pct = fw.efficiency_change_pct
    return {
      ok: true,
      degraded: false,
      stage: stageName,
      round: roundNo,
      stdout: res.stdout,
      parsed,
      gateOk: inferGateOk(res.stdout),
      framework,
      message: framework.decision
        ? `framework 效率对比：${framework.decision}（${framework.quadrant ?? '—'}）效率 ${framework.efficiency_before ?? '—'} → ${framework.efficiency_after ?? '—'}（${framework.efficiency_change_pct ?? '—'}%）`
        : 'framework 效率判定返回异常（无 decision 字段，见 stdout）。',
    }
  }

  return {
    ok: true,
    degraded: false,
    stage: stageName,
    round: roundNo,
    stdout: res.stdout,
    parsed,
    gateOk: inferGateOk(res.stdout),
    message: `Master=${parsed.master} Stage=${parsed.stage} Total=${parsed.total} 等级=${parsed.level} 弱项=${parsed.weak.join(',') || '—'}`,
  }
}

// ----------------------------------------------------------------------------
// apply：插件主体
// ----------------------------------------------------------------------------
export function apply(ctx, input = {}) {
  const stateRoot = process.env.YXSPEC_SELF_ITERATION_STATE_ROOT || DEFAULT_STATE_ROOT
  const trajRoot = process.env.YXSPEC_TRAJECTORY_ROOT || DEFAULT_TRAJ_ROOT
  const scriptsDir = process.env.YXSPEC_SELF_ITERATION_SCRIPTS
    || (input.scriptsDir ? String(input.scriptsDir) : DEFAULT_PEER_SELF_ITER_SCRIPTS)

  let logDir = null
  try {
    logDir = join(stateRoot, '.plugin')
    mkdirSync(logDir, { recursive: true })
  } catch {
    logDir = null
  }
  const log = (msg) => {
    if (!logDir) return
    try { appendFileSync(join(logDir, 'self-iteration.log'), `${new Date().toISOString()} ${msg}\n`, 'utf8') } catch {}
  }
  log(`apply() invoked; stateRoot=${stateRoot}; trajRoot=${trajRoot}; scriptsDir=${scriptsDir}; stages=${CMD_TOKENS ? CMD_TOKENS.size : '(unavailable)'}`)

  // ---- 注册 self_iter_score tool（确定性评分，禁 LLM 自评）----
  // 手写 ToolDefinition（vendor 插件不 import @deepseek-ai/*，符合现存插件纪律）。
  // register() 校验：output 必须声明 { schema, render }；parameters 为 JSON Schema。
  let disposeScoreTool = null
  try {
    disposeScoreTool = ctx.tools.register({
      name: 'self_iter_score',
      description:
        '对指定 yxspec 阶段（如 sqt-script-gen）执行确定性打分（调用同事的 score_aggregate.py，非 LLM 自评）。'
        + '输入 stage（节点名，下划线或连字符均可）+ 可选 round/repo-root/run-dir/session。'
        + '双模式：product（缺省）= 评阶段产物，返回 Master/Stage/Total 分 + 等级（A~D）+ 弱项（<60 维度）结构化结果；'
        + 'framework = 评框架效率（需先后两轮打分记录对比，返回 framework 子对象含 decision/quadrant/效率增量）。'
        + '脚本不可用时返回 degraded=true（此时禁止自行打分，改走提示词路径）。',
      parameters: {
        type: 'object',
        properties: {
          stage: { type: 'string', description: '节点名，如 sqt-script-gen 或 sqt_script_gen（必填）' },
          round: { type: 'integer', description: '轮次 r{N}（默认 1）' },
          repoRoot: { type: 'string', description: '项目根（--repo-root，默认脚本 cwd）' },
          runDir: { type: 'string', description: '本轮产物目录（--run-dir，优先评 rounds/r{N}/run/ 复制产物）' },
          session: { type: 'string', description: '会话标识（同一会话全部轮次写入同一个 score-{session}.json）' },
          mode: { type: 'string', enum: ['product', 'framework'], description: '打分模式：product=评阶段产物（默认）；framework=评框架效率（复用同事 score_core.py --eval-framework，需先后两轮打分记录对比）' },
          timeMin: { type: 'number', description: 'framework 模式本轮耗时分钟（agent 观测）；缺省用 run-state 会话时长折算' },
        },
        required: ['stage'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            degraded: { type: 'boolean' },
            stage: { type: 'string' },
            // null 表示缺失（未打分/脚本不可用）；schema 子集不支持 union type，
            // 用 number/string/array 单一类型 + 值域内处理（null 时给空字符串/空数组）
            round: { type: 'integer' },
            total: { type: 'number' },
            master: { type: 'number' },
            stageScore: { type: 'number' },
            level: { type: 'string' },
            weak: { type: 'array', items: { type: 'string' } },
            gateOk: { type: 'boolean' },
            message: { type: 'string' },
            error: { type: 'string' },
            stdout: { type: 'string' },
            stderr: { type: 'string' },
            framework: {
              type: 'object',
              // framework 模式成功判定才携带（decision 恒为 string；quadrant/效率
              // 为 string/number）；product 模式或缺省/降级时省略该键（可选属性）。
              additionalProperties: false,
              properties: {
                decision: { type: 'string' },
                quadrant: { type: 'string' },
                efficiency_before: { type: 'number' },
                efficiency_after: { type: 'number' },
                efficiency_change_pct: { type: 'number' },
              },
            },
          },
        },
        render: (a, v) => [{
          type: 'text',
          text: v.degraded
            ? `[self_iter_score] 降级：${v.message ?? ''}`
            : `[self_iter_score] ${v.message ?? ''}`,
        }],
      },
      execute: async (args) => {
        const res = await execSelfIterScore(args, {
          scriptsDir,
          defaultRepoRoot: input.repoRoot || process.env.YXSPEC_WORKSPACE_CWD || 'D:/Work/01_Projects/Aima_X1_BCM',
          stateRoot,
        })
        // 成功打分 → 暂存到 run-state（finishRound 消费，供轮次状态机判定）。
        // 仅 product 模式暂存：framework 判定是框架效率证据，非本轮产物分，
        // 进了 lastScore 会被 decide() 当产物分参与降级判定 → 污染轮次状态机。
        if (res.ok && !res.degraded && res.parsed && args?.mode !== 'framework') {
          const st = readRunState(stateRoot)
          if (st) {
            st.lastScore = {
              total: res.parsed.total,
              level: res.parsed.level,
              weak: res.parsed.weak,
              gateOk: res.gateOk,
            }
            writeRunState(stateRoot, st)
          }
          appendTrajectory(trajRoot, res.stage, {
            type: 'self-iteration/score/v1',
            stage: res.stage,
            round: res.round,
            master: res.parsed.master,
            stageScore: res.parsed.stage,
            total: res.parsed.total,
            level: res.parsed.level,
            weak: res.parsed.weak,
            gateOk: res.gateOk,
            at: new Date().toISOString(),
          })
        }
        // framework 成功判定 → 写轨迹（框架效率证据；降级不写，留痕只记有效判定）
        if (res.ok && !res.degraded && res.framework?.decision) {
          appendTrajectory(trajRoot, res.stage, {
            type: 'self-iteration/framework-eval/v1',
            stage: res.stage,
            round: res.round,
            decision: res.framework.decision,
            quadrant: res.framework.quadrant ?? null,
            efficiency_before: res.framework.efficiency_before ?? null,
            efficiency_after: res.framework.efficiency_after ?? null,
            efficiency_change_pct: res.framework.efficiency_change_pct ?? null,
            at: new Date().toISOString(),
          })
        }
        // 结构化返回（stdout 截断防爆；缺失字段用可判定哨兵，无 union type）。
        // framework 只在 framework 模式成功判定时携带（对象，见 schema）；product/
        // 降级时省略该键（schema additionalProperties:false 禁多余字段，缺省可选属性合法）。
        const p = res.parsed
        const out = {
          ok: res.ok,
          degraded: res.degraded ?? false,
          stage: res.stage ?? '',
          round: Number.isFinite(res.round) ? res.round : 0,
          total: typeof p?.total === 'number' ? p.total : -1,
          master: typeof p?.master === 'number' ? p.master : -1,
          stageScore: typeof p?.stage === 'number' ? p.stage : -1,
          level: p?.level ?? '',
          weak: Array.isArray(p?.weak) ? p.weak : [],
          gateOk: res.gateOk ?? false,
          message: res.message ?? '',
          error: res.error ?? '',
          stdout: String(res.stdout ?? '').slice(0, 4000),
          stderr: String(res.stderr ?? '').slice(0, 2000),
        }
        if (res.framework) out.framework = res.framework
        return out
      },
    })
    log('tool self_iter_score registered')
  } catch (e) {
    log(`tool register fail: ${String(e?.message ?? e)}`)
  }

  // ---- 事件订阅：识别自迭代会话 + 轮次状态机 ----
  // sessionId -> { stage, state:'open' }。状态权威在磁盘 run-state.json：
  // 任何判定（finishRound）都重新 readRunState（self_iter_score 打分后会把
  // lastScore 写盘），避免用 openRun 时捕获的陈旧 in-memory 快照。
  const sessions = new Map()

  const openRun = (sessionId, stage, opts) => {
    let st = readRunState(stateRoot)
    const sameRun = st && st.stage === stage && opts.resume
    if (!sameRun) {
      st = emptyState(stage) // 新会话/换阶段 → 重置 run-state（旧会话留痕在轨迹+reports，不丢）
      st.goal = opts.goal ?? ''
    } else if (opts.goal) {
      st.goal = opts.goal
    }
    if (opts.maxIter) st.maxIter = opts.maxIter
    // 评估模式持久化：命令显式 --mode= 才覆盖（opts.mode 非 null）。续跑命令未带
    // --mode → 保持 run 原模式（product 评阶段产物 / framework 评框架效率），
    // 避免续跑后模式静默回落默认；新 run（emptyState）已默认 product。
    if (opts.mode) st.mode = opts.mode
    st.lastScore = null // 开新轮次会话：清掉上一会话遗留的打分暂存（防跨会话泄漏）
    writeRunState(stateRoot, st)
    sessions.set(sessionId, { stage, state: 'open' })
    return st
  }

  const finishRound = (sessionId, reason) => {
    const run = sessions.get(sessionId)
    if (!run || run.state !== 'open') return
    run.state = 'done'
    sessions.delete(sessionId)

    const stage = run.stage
    const st = readRunState(stateRoot) || emptyState(stage)
    const roundNo = (Array.isArray(st.rounds) && st.rounds.length > 0
      ? Math.max(...st.rounds.map((r) => r.round)) + 1 : 1)

    // 本轮分数：取 run-state.lastScore（self_iter_score 成功打分暂存）；无 → 本轮按继续
    const last = st.lastScore ?? null
    const total = last?.total ?? null
    const baselineTotal = st.baselineTotal ?? null
    const gateOk = last?.gateOk ?? null
    // 无打分（score tool 降级/未调用）也走 decide：total 缺失时凭 roundNo 判
    // 继续 / 用满 —— roundNo 已含历史轮次计数，配合下面无条件 advanceState，
    // 无打分轮也推进轮次，防止 roundNo 永远停在 1、converge_by_maxiter 永不触发。
    const verdict = decide(roundNo, total, baselineTotal, st.goal, gateOk, st.maxIter)

    appendTrajectory(trajRoot, stage, {
      type: 'self-iteration/round/v1',
      stage,
      round: roundNo,
      verdict,
      total,
      baselineTotal,
      level: last?.level ?? null,
      weak: Array.isArray(last?.weak) ? last.weak : [],
      status: st.status,
      reason,
      at: new Date().toISOString(),
    })

    // 无条件推进轮次（含无打分轮）：roundNo 来自 st.rounds，未推进则下一轮复用
    // 同号（rounds 为空 → 恒 1），maxIter 永不达 → 自迭代死循环。total 缺失的
    // 轮次照常留痕（total:null），不加分不锚定基线，只推进计数与 status。
    advanceState(st, roundNo, total, last, verdict)
    st.lastScore = null // 无论如何清空本轮打分暂存（防泄漏到下一轮）
    writeRunState(stateRoot, st)
    log(`round ${roundNo} ${stage} verdict=${verdict} total=${total} baseline=${baselineTotal} -> ${st.status}`)
  }

  const off = ctx.on('session/event', (session, event) => {
    if (!event || typeof event.type !== 'string') return
    const sessionId = String(session.id)

    // ---- 自迭代会话识别：注入 prompt 命中 /yxspec:self-iterate ----
    if (event.type === 'agent/inbox/spliced') {
      const prompt = promptFromInbox(event.data)
      const parsed = parseSelfIterate(prompt)
      if (!parsed) return // 非自迭代命令
      const token = resolveStageToken(parsed.stageRaw)
      if (!token) {
        // 命中命令但阶段无法解析 → 不建 run（提示词路径兜底），仅记日志
        log(`self-iterate prompt hit but stage unresolvable: ${parsed.stageRaw}`)
        return
      }
      const cur = sessions.get(sessionId)
      if (cur && cur.state === 'open' && cur.stage === token) return // 同会话续跑
      if (cur && cur.state === 'open') finishRound(sessionId, 'stage-switch')
      const st = openRun(sessionId, token, {
        maxIter: parsed.maxIter, goal: parsed.goal, resume: parsed.resume, mode: parsed.mode,
      })
      log(`open self-iteration run: ${token} maxIter=${st.maxIter} goal=${st.goal} resume=${parsed.resume}`)
      return
    }

    // ---- 轮次结束：turn/end 且 reason 为自跑收尾 → 状态机推进 ----
    if (event.type === 'turn/end') {
      const reason = event.data?.reason?.kind ?? null
      if (isRoundEndReason(reason)) finishRound(sessionId, reason)
      return
    }
  })

  // Cordis ctx.effect 语义：回调体在插件激活时执行一次；返回的函数才是
  // dispose 时的清理（坑见文件头：写回调体内会在 ~2ms 后立刻 unsubscribe）。
  ctx.effect(() => {
    ctx.logger?.info?.(`[self-iteration] active: 订阅 session/event（root ctx；轮次状态机 + self_iter_score tool；${CMD_TOKENS ? CMD_TOKENS.size : 0} 阶段命令）`)
    return () => {
      log('dispose: unsubscribed')
      try { off?.() } catch {}
      try { disposeScoreTool?.() } catch {}
      sessions.clear()
    }
  })
}
