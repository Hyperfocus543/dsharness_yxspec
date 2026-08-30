// =============================================================================
// @yxspec/git-workspace — 阶段收尾 git tag 留痕 + 审计 JSONL（薄胶水，只读工作树）
// =============================================================================
// 职责（对齐 aspice-trajectory 的接线方式，POC 结构照抄）：
//   - 订阅 session/event（root ctx 直达，前提：声明 `inject: ['sessions']`，
//     见 aspice-trajectory 头注释 2026-08-27 实测）；
//   - 从 agent/inbox/spliced 注入 prompt 命中阶段命令（复用网关 stages.mjs
//     权威表）即开"本次阶段执行"；seq 在命中时按轨迹权威目录（YXSPEC_TRAJECTORY_ROOT，
//     同 aspice-trajectory）scan 同名目录最大 seq + 1 预分配并存入 session 记录。
//     必须在 inbox/spliced 预分配、不能在 turn/end 现算：turn/end 时 aspice-trajectory
//     （装配在 git-workspace 之前）已同步落盘本次轨迹文件，此时 scan 返回 max+1
//     = 本次 seq+1，打的 tag 恒比轨迹 seq 大 1（前端「阶段↔commit/tag」按 seq
//     对齐会错位）。inbox/spliced 在 turn/end 之前且本次文件未落盘 → 拿到正确 seq；
//   - 阶段结束判定：turn/end 事件，且 reason.kind 属于阶段命令收尾
//     （completed=正常收尾，打 tag + 审计；max-tokens/error/aborted/
//     interrupted/blocked/stage-switch 均为异常，不满足收尾条件，不打 tag
//     不写审计，仅清 session 记录 + log）。注意 turn/end 在
//     aspice-trajectory 里对 open 轨迹负责，本插件只关心"本次执行是否有
//     seq"，无记录则纯 log 降级；
//   - 收尾动作（只读，不动工作树）：
//       1. gitRoot：优先 YXSPEC_GIT_ROOT env（显式给了但非仓库 → 直接降级
//          git-unavailable，绝不当漏网标签打到别处）；缺省取自身仓库根
//          （`git rev-parse --show-toplevel` 真根）；
//       2. git rev-parse HEAD → commit（无 HEAD → 新仓库未提交 → 降级）；
//       3. git rev-parse --verify --quiet refs/tags/yxspec/<stage>/<seq> →
//          已存在 → status:'skip'，不覆盖；
//       4. git tag yxspec/<stage>/<seq> <commit>（annotated 不必要，轻量 tag，
//          纯留痕，不改任何工作树/历史）；
//       5. autoCommit（默认 false）为 true 时才 git add -A && git commit
//          -m "yxspec: <stage> #<seq>" —— 红线一，默认绝不碰工作树；
//       6. 审计 JSONL 追加到：
//          gateway/runtime-data/git-workspace/<stage>/<stage>-<seq>.jsonl
//          （runtime-data 已被根 .gitignore 排除，不入库）。
//
// 红线：
//   - 绝不动 D:/AI/deepseek-harness-master（harness 主仓）；
//   - 默认行为（autoCommit:false）绝不 git add / git commit / 改任何工作树，
//     只读 commit + 打 tag + 写审计 JSONL；
//   - git 命令一律 execFile（无 shell 拼接，防注入）；git 不可用 / 非仓库 /
//     命令失败 → 不抛错，审计 status:'git-unavailable'，继续不干扰 agent。
//
// 配置（cordis.yml 装配块 config 传入 apply 的 input）：
//   - autoCommit: false（默认关；env YXSPEC_GIT_AUTOCOMMIT=true 可全局开）
//   - gitRoot:    可显式给；缺省 env YXSPEC_GIT_ROOT，再缺省自身仓库根
//   - root:       审计落盘根；缺省 env YXSPEC_GIT_WORKSPACE_ROOT，
//                 再缺省 runtime-js/runtime-data/git-workspace
// 轨迹 seq 对齐根：env YXSPEC_TRAJECTORY_ROOT（start-gateway.mjs 已注入），
// 缺省回落到与 aspice-trajectory 相同的 DEFAULT_ROOT 解析。
// =============================================================================
// 坑（2026-08-27 aspice-trajectory 实测）：ctx.effect 的清理函数必须作为
// 返回值 return，写在回调体内会在激活瞬间（mount 后 ~2ms）立刻 unsubscribe。
// 正确形态见文件底部 effect 块（body=激活日志，return=dispose 清理）。
// =============================================================================

import { mkdirSync, appendFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

// ----------------------------------------------------------------------------
// 审计落盘根：gateway/runtime-js/runtime-data/git-workspace/（gitignore 排除）
// 可经 env YXSPEC_GIT_WORKSPACE_ROOT 覆盖（副本网关冒烟用，互不串写）。
// 轨迹 seq 对齐根：与 aspice-trajectory 同源（env YXSPEC_TRAJECTORY_ROOT 或
// 同一 DEFAULT_ROOT 解析），scan 它的同名目录拿 seq。
// ----------------------------------------------------------------------------
const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'runtime-data', 'git-workspace')
const DEFAULT_TRAJ_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'runtime-data', 'trajectory')

export const name = 'git-workspace'
export const inject = ['sessions']

// 纯函数导出（单测/驾驶舱诊断复用；与 yxspec-tool-guard 导出判定的范式一致）
export { stageOfPrompt }

/** 阶段命令/token → 权威 token 表（复用网关 stages.mjs；harness 外运行/加载失败 → 空表，
 *  此时不判阶段，插件只做事件兜底，不抛错）。 */
let STAGE_TOKENS = null
try {
  const mod = await import('../../../../lib/stages.mjs')
  const map = new Map() // token → { command }（键为阶段权威 token）
  for (const [token, st] of Object.entries(mod?.STAGES ?? {})) {
    if (st?.command) map.set(token, { command: st.command })
  }
  if (map.size > 0) STAGE_TOKENS = map
} catch {
  STAGE_TOKENS = null
}

/** 边界感知匹配（与 stages.mjs resolveStage 同规则：命令后必须跟 空白/标点/结尾）。
 *  返回**权威阶段 token**（如 sys_analysis），而非命令名——命令名（`/yxspec:sys-analysis`）
 *  只做匹配锚点，命中后反查 token，否则 tag/审计/轨迹目录会写成命令名（错位、与前端
 *  STAGE_ORDER 的 token 对不上）。 */
function stageOfPrompt(prompt) {
  if (!STAGE_TOKENS) return null
  const text = String(prompt ?? '')
  for (const [token, st] of STAGE_TOKENS) {
    const esc = st.command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?:^|[^\\w-])${esc}(?:$|[\\s.,;:!?，。；：！？、)）]|(?:[^\\w-]))`)
    if (re.test(text)) return token
    // token 本身（下划线形态）直接命中 → 兜底。必须整词边界（\b）而非子串 includes：
    // `swe_coding_verify_pc` / `swe_arch_if` / `swe_release_promote` 都以前缀阶段 token
    // 开头（表顺序里前缀在前），includes 会把变体/接口/过渡阶段误标成前缀阶段的 tag/审计
    // （实测复现）。token 全为 [a-z0-9_]（下划线是 \w 词字符），\b 让长 token 内的前缀
    // token 因尾随 `_`（词字符）不命中边界 → 精准回落。
    const tokenRe = new RegExp(`\\b${token}\\b`)
    if (tokenRe.test(text)) return token
  }
  return null
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

/** 某阶段现有最大 seq + 1（scan 轨迹权威目录，与 aspice-trajectory 同 seq 对齐）。
 *  必须在 inbox/spliced 预分配时调用（此时本次轨迹未落盘，返回正确 seq）；
 *  不得在 turn/end 调用——届时 aspice-trajectory 已同步落盘本次轨迹，scan
 *  返回 max+1 = 本次 seq+1，tag 序号会整体错位 +1。 */
function nextSeqFor(stage) {
  const root = process.env.YXSPEC_TRAJECTORY_ROOT || DEFAULT_TRAJ_ROOT
  try {
    const dir = join(root, stage)
    let max = 0
    for (const it of readdirSync(dir)) {
      const m = it.match(new RegExp(`^${stage}-(\\d+)\\.jsonl$`))
      if (m) max = Math.max(max, Number(m[1]))
    }
    return max + 1
  } catch {
    return 1
  }
}

/** turn/end reason 是否属于"阶段命令收尾"（打完 tag 才算阶段结束留痕）。
 *  completed  → 正常收尾 ✓
 *  max-tokens/error/aborted/interrupted/blocked/stage-switch → 异常收尾，不打 tag */
function isPhaseEndReason(reason) {
  return reason === 'completed'
}

/**
 * execFile 封装：无 shell 拼接（红线：防注入）。超时 10s。
 * 成功 → { ok:true, stdout, stderr }；失败/超时 → { ok:false, error }（不抛）。
 */
function runGit(args, { cwd, timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: timeoutMs, windowsHide: true, encoding: 'utf8' },
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

export function apply(ctx, input = {}) {
  const root = process.env.YXSPEC_GIT_WORKSPACE_ROOT || DEFAULT_ROOT
  const cfgAutoCommit = process.env.YXSPEC_GIT_AUTOCOMMIT === 'true' || input.autoCommit === true
  let logDir = null
  try {
    logDir = join(root, '.plugin')
    mkdirSync(logDir, { recursive: true })
  } catch {
    logDir = null
  }
  const log = (msg) => {
    if (!logDir) return
    try { appendFileSync(join(logDir, 'git-workspace.log'), `${new Date().toISOString()} ${msg}\n`, 'utf8') } catch {}
  }
  log(`apply() invoked; root=${root}; autoCommit=${cfgAutoCommit}; stages=${STAGE_TOKENS ? STAGE_TOKENS.size : '(unavailable)'}`)

  // sessionId -> 当前活动阶段记录（open；turn/end 后置 done 并清空，异常收尾也清）。
  // seq 在 inbox/spliced 命中阶段时预分配（与 aspice-trajectory 同策略：此刻本次
  // 轨迹未落盘，scan 拿正确 seq；turn/end 现算会因 aspice 已落盘而恒大 1，见头部注释）。
  const sessions = new Map()

  const finishStage = (sessionId, reason) => {
    const rec = sessions.get(sessionId)
    sessions.delete(sessionId)
    if (!rec) return // 没有对应记录（阶段命令未命中/轨迹插件未开）→ 纯 log 降级
    const stage = rec.stage
    const seq = rec.seq ?? nextSeqFor(stage)
    // 打 tag + 写审计：承诺 catch 全吞，绝不抛到事件回调。
    processPhaseEnd(stage, seq, reason, { root, autoCommit: cfgAutoCommit, input })
      .then((audit) => log(`audit ${stage}/${stage}-${String(seq).padStart(3, '0')}.jsonl ${audit.status}${audit.tag ? ' tag=' + audit.tag : ''}`))
      .catch((e) => log(`phase-end fail: ${String(e?.message ?? e)}`))
  }

  const off = ctx.on('session/event', (session, event) => {
    if (!event || typeof event.type !== 'string') return
    const sessionId = String(session.id)

    // ---- 阶段边界：注入 prompt 命中阶段命令 → 预分配 seq 并记录本次执行（同阶段续跑不重开）----
    if (event.type === 'agent/inbox/spliced') {
      const prompt = promptFromInbox(event.data)
      const token = stageOfPrompt(prompt)
      if (!token) return // 通用咨询/无阶段命令 → 不记录
      // 同阶段续跑（未 turn/end 不重开）→ 复用现有记录；换阶段 → 旧记录作废。
      // 换阶段时 aspice-trajectory 会在 inbox 里封口旧轨迹、按新阶段重开（stage-switch），
      // 而本插件若沿用旧记录，turn/end 会把 tag/审计打进旧阶段目录 —— 与轨迹错位、
      // 新阶段无 tag。与 aspice-trajectory 同口径：cur.stage 不同即作废重开。
      const cur = sessions.get(sessionId)
      if (cur) {
        if (cur.stage === token) return
        sessions.delete(sessionId) // 换阶段：作废旧记录，按新阶段预分配
      }
      sessions.set(sessionId, { stage: token, seq: nextSeqFor(token) })
      return
    }

    // ---- 阶段结束：turn/end 且 reason 为阶段命令收尾 → 打 tag + 审计 ----
    // 异常 reason（error/max-tokens/aborted/interrupted/blocked/stage-switch）
    // 也清 session 记录，防泄漏；但 isPhaseEndReason=false 不打 tag（无审计）。
    if (event.type === 'turn/end') {
      const reason = event.data?.reason?.kind ?? null
      if (isPhaseEndReason(reason)) finishStage(sessionId, reason)
      else sessions.delete(sessionId)
      return
    }
  })

  // Cordis ctx.effect 语义：回调体在插件激活时执行一次；返回的函数才是
  // dispose 时的清理（坑见文件头：写回调体内会在 ~2ms 后立刻 unsubscribe）。
  ctx.effect(() => {
    ctx.logger?.info?.(`[git-workspace] active: 订阅 session/event（root ctx；autoCommit=${cfgAutoCommit}；git 只读打 tag + 审计 JSONL）`)
    return () => {
      log('dispose: unsubscribed')
      try { off?.() } catch {}
      sessions.clear()
    }
  })
}

// =============================================================================
// 阶段收尾执行：git root 解析 → HEAD → tag 已存在 skip → [autoCommit] →
// 打 tag → 审计 JSONL。全程只读（autoCommit 关闭时）；任何 git 失败都降级
// 记录 status:'git-unavailable'，不抛、不干扰 agent。
// =============================================================================
async function processPhaseEnd(stage, seq, reason, { root, autoCommit, input = {} }) {
  const ts = Date.now()
  const tagName = `yxspec/${stage}/${seq}`
  const audit = {
    stage,
    seq,
    timestamp: new Date(ts).toISOString(),
    reason,
    status: 'unknown',
  }

  // ---- 1. gitRoot：显式 input > env YXSPEC_GIT_ROOT > 自身仓库根（真根由 git 判定）----
  // 注意：env 显式给了但非仓库 → 直接降级 git-unavailable，绝不当漏网标签打到别处。
  let gitRoot = null
  const explicitRoot = input.gitRoot || process.env.YXSPEC_GIT_ROOT
  try {
    if (explicitRoot) {
      const verify = await runGit(['rev-parse', '--show-toplevel'], { cwd: explicitRoot })
      if (verify.ok) {
        gitRoot = verify.stdout.trim()
      } else {
        audit.gitRootHint = `${explicitRoot} (not a repo: ${verify.error})`
      }
    }
    if (!gitRoot && !explicitRoot) {
      const selfRepo = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/')
      const probe = await runGit(['rev-parse', '--show-toplevel'], { cwd: selfRepo })
      if (probe.ok) gitRoot = probe.stdout.trim()
      else audit.gitRootHint = probe.error
    }
  } catch {
    gitRoot = null
  }

  if (!gitRoot) {
    audit.status = 'git-unavailable'
    audit.tag = tagName
    audit.tagCommit = null
    audit.branch = null
    audit.commit = null
    writeAudit(root, stage, seq, audit)
    return audit
  }
  audit.gitRoot = gitRoot

  // ---- 2. HEAD / branch ----
  const head = await runGit(['rev-parse', 'HEAD'], { cwd: gitRoot })
  if (!head.ok) {
    audit.status = 'git-unavailable' // 无 HEAD（新仓库无提交）→ 无法留痕
    audit.tag = tagName
    audit.tagCommit = null
    audit.commit = null
    audit.branch = null
    audit.gitError = head.error
    writeAudit(root, stage, seq, audit)
    return audit
  }
  const commit = head.stdout.trim()
  const branchRes = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: gitRoot })
  const branch = branchRes.ok ? branchRes.stdout.trim() : null
  audit.commit = commit
  audit.branch = branch
  audit.tagCommit = commit

  // ---- 3. tag 已存在则 skip（不覆盖、不动工作树）；否则继续收尾 ----
  const exists = await runGit(['rev-parse', '--verify', '--quiet', `refs/tags/${tagName}`], { cwd: gitRoot })
  if (exists.ok) {
    audit.status = 'skip'
    audit.tag = tagName
    audit.reason = `${audit.reason ?? 'completed'}; tag exists`
    writeAudit(root, stage, seq, audit)
    return audit
  }

  // ---- 4. autoCommit（默认 false；仅显式开启才 git add + commit，动工作树）----
  // 开启时先落 commit 再打 tag —— tag 指向包含本次阶段改动的那个 commit。
  if (autoCommit) {
    const add = await runGit(['add', '-A'], { cwd: gitRoot })
    if (!add.ok) {
      audit.status = 'git-unavailable'
      audit.gitError = `add: ${add.error}`
      audit.tag = tagName
      audit.tagCommit = null
      writeAudit(root, stage, seq, audit)
      return audit
    }
    const commitMsg = `yxspec: ${stage} #${seq}`
    const cm = await runGit(['commit', '-m', commitMsg], { cwd: gitRoot })
    if (!cm.ok) {
      audit.status = 'git-unavailable'
      audit.gitError = `commit: ${cm.error}`
      audit.tag = tagName
      audit.tagCommit = null
      writeAudit(root, stage, seq, audit)
      return audit
    }
    const headAfter = await runGit(['rev-parse', 'HEAD'], { cwd: gitRoot })
    const newCommit = headAfter.ok ? headAfter.stdout.trim() : commit
    audit.autoCommit = 'committed'
    audit.commit = newCommit
    audit.tagCommit = newCommit
  }

  // ---- 5. 打轻量 tag yxspec/<stage>/<seq>（指向当前留痕 commit）----
  const tagRes = await runGit(['tag', tagName, audit.tagCommit ?? commit], { cwd: gitRoot })
  if (!tagRes.ok) {
    audit.status = 'git-unavailable' // 打 tag 失败（permission/并发），降级不抛
    audit.tag = tagName // 与其他降级分支一致：审计记录自包含 tag 名
    audit.gitError = tagRes.error
    writeAudit(root, stage, seq, audit)
    return audit
  }
  audit.status = 'tagged'
  audit.tag = tagName // 与 skip/git-unavailable 分支一致：审计记录自包含 tag 名

  writeAudit(root, stage, seq, audit)
  return audit
}

/** 审计 JSONL 追加写（<stage>/<stage>-<seq>.jsonl，append-only，不入库）。 */
function writeAudit(root, stage, seq, audit) {
  const dir = join(root, stage)
  const file = join(dir, `${stage}-${String(seq).padStart(3, '0')}.jsonl`)
  try {
    mkdirSync(dir, { recursive: true })
    appendFileSync(file, JSON.stringify(audit) + '\n', 'utf8')
  } catch {
    // 落盘失败不抛（不干扰 agent）；仅日志
  }
}
