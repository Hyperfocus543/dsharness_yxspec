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
 * 返回 { stageRaw, maxIter, goal, resume } 或 null（非自迭代命令）。
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

  // stage：优先显式 --stage=，否则取命令后第一个非 flag 裸词（阶段命令名/token）
  let stageRaw = stageRaw0
  if (!stageRaw) {
    const after = rest.replace(/--[\w-]+(?:\s*=\s*(?:"[^"]*"|\S+))?/g, ' ').trim()
    const first = after.split(/\s+/)[0] || ''
    if (first) stageRaw = first
  }
  return {
    stageRaw: stageRaw || null,
    maxIter: maxIterRaw != null && /^\d+$/.test(maxIterRaw) ? Number(maxIterRaw) : null,
    goal: goal || null,
    resume,
  }
}

/** 阶段串（下划线 token 或连字符命令名）→ 权威 token；解析失败 → null。 */
function resolveStageToken(raw) {
  if (!raw) return null
  const kebab = String(raw).replace(/_/g, '-')
  if (!CMD_TOKENS) return kebab // 权威表不可用 → 用连字符形式兜底（阶段名即命令名）
  for (const [cmd, t] of CMD_TOKENS) {
    if (cmd === `/yxspec:${kebab}` || t === raw || t === kebab) return t
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
    sessionId: session,
    sessionStartedAt: now,
    currentRound: 0,
    rounds: [],
    converged: false,
    status: 'running', // running | converged | dropped | stopped
    stopPoint: null,
    baselineSnapshot: null,
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
 *   - 降级：总分 < 比较基线，且 total <= baselineTotal → degrade
 *   - 收敛：goal 达（Total>=N / Total>N / 门禁全绿）→ converge
 *   - 用满：round >= maxIter → converge_by_maxiter
 *   - 否则 continue
 * 纯函数：读 state + 本轮分数，不靠 LLM 记忆。
 */
function decide(roundNo, total, baselineTotal, goal, gateOk, maxIter) {
  const g = String(goal ?? '').trim()
  if (baselineTotal != null && total <= baselineTotal) return 'degrade'
  let goalMet = false
  if (g.startsWith('Total>=')) goalMet = total >= Number(g.split('>=')[1])
  else if (g.startsWith('Total>')) goalMet = total > Number(g.split('>')[1])
  else goalMet = gateOk === true // 未给 goal / strict/drift 全绿 → 门禁全绿即达
  if (goalMet) return 'converge'
  if (roundNo >= (maxIter || DEFAULT_MAX_ITER)) return 'converge_by_maxiter'
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
/** 自迭代轨迹目录现有最大 seq + 1（scan 目录，无则 1）。 */
function nextSeqFor(dir) {
  try {
    let max = 0
    for (const it of readdirSync(dir)) {
      const m = /^[a-z0-9_]+-(\d+)\.jsonl$/.exec(it)
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
    const seq = nextSeqFor(dir)
    const file = join(dir, `${String(stage).replace(/[^a-z0-9_]/g, '_')}-${String(seq).padStart(3, '0')}.jsonl`)
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
 * 任何不可用（脚本缺 / python 挂 / 脚本崩溃）→ 返回 degraded:true，不抛错。
 * @param {{ stage, round, repoRoot, runDir, session }} args 已校验的参数
 * @param {{ scriptsDir: string, defaultRepoRoot: string }} state 插件上下文
 */
async function execSelfIterScore(args, state) {
  const { stage, runDir, round } = args || {}
  const stageName = String(stage ?? '').trim() || null
  const roundNo = round == null ? null : Number(round)
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
  return {
    ok: true,
    degraded: false,
    stage: stageName,
    round: roundNo,
    stdout: res.stdout,
    parsed,
    gateOk: inferGateOk(res.stdout),
    message: parsed
      ? `Master=${parsed.master} Stage=${parsed.stage} Total=${parsed.total} 等级=${parsed.level} 弱项=${parsed.weak.join(',') || '—'}`
      : res.stdout,
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
        + '返回 Master/Stage/Total 分 + 等级（A~D）+ 弱项（<60 维度）结构化结果；脚本不可用时返回 degraded=true（此时禁止自行打分，改走提示词路径）。',
      parameters: {
        type: 'object',
        properties: {
          stage: { type: 'string', description: '节点名，如 sqt-script-gen 或 sqt_script_gen（必填）' },
          round: { type: 'integer', description: '轮次 r{N}（默认 1）' },
          repoRoot: { type: 'string', description: '项目根（--repo-root，默认脚本 cwd）' },
          runDir: { type: 'string', description: '本轮产物目录（--run-dir，优先评 rounds/r{N}/run/ 复制产物）' },
          session: { type: 'string', description: '会话标识（同一会话全部轮次写入同一个 score-{session}.json）' },
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
        })
        // 成功打分 → 暂存到 run-state（finishRound 消费，供轮次状态机判定）
        if (res.ok && !res.degraded && res.parsed) {
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
        // 结构化返回（stdout 截断防爆；缺失字段用可判定哨兵，无 union type）
        const p = res.parsed
        return {
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
    const verdict = total == null
      ? (roundNo >= (st.maxIter || DEFAULT_MAX_ITER) ? 'converge_by_maxiter' : 'continue')
      : decide(roundNo, total, baselineTotal, st.goal, gateOk, st.maxIter)

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

    if (total != null) advanceState(st, roundNo, total, last, verdict)
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
        maxIter: parsed.maxIter, goal: parsed.goal, resume: parsed.resume,
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
