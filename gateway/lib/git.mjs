// =============================================================================
// git.mjs — 网关 git 工作区状态 API（只读执行 git + 追加审计 JSONL）
// =============================================================================
// 职责：
//   1. getStatus()            — 工作区 git 状态（分支/HEAD/脏文件/领先落后/最近提交）
//   2. getStageRecords(stage) — 阶段 ↔ commit ↔ tag 对照表（轨迹 JSONL × git log/tag）
//   3. recordRollback(...)    — 回滚审计留档（JSONL 尾部追加，只留档不执行 git reset）
//
// gitRoot 解析规则（优先级从高到低）：
//   1. process.env.YXSPEC_GIT_ROOT            —— 显式指定要查看的 git 仓库根
//   2. process.env.YXSPEC_PROJECT_ROOT || PROJECT_ROOT（lib/paths.mjs 缺省）
//   3. git rev-parse --show-toplevel 兜底     —— 在 cwd 下找仓库根
//   每个候选先用 `git -C <root> rev-parse --show-toplevel` 验证是否为仓库，
//   是则取其真实仓库根（候选指向子目录时也能归一）；全部失败 → git 不可用。
//
// 为什么只用 child_process.execFile('git', args, { cwd, timeoutMs })：
//   - execFile 不经过 shell，参数按数组原样透传。路径/参数里即使含 shell 元字符
//     （空格、引号、$、;、| 等）也不会被解释，彻底杜绝命令注入。
//   - 严禁用 shell 拼接字符串去 exec（如 `exec('git status ' + userInput)`）。
//
// 红线：本模块只做「只读 git + 追加审计 JSONL」；绝不执行 git reset / git push /
// 其他破坏性操作。所有函数优雅处理 git 不可用（不是仓库/没装 git → 返回
// gitAvailable:false + error 字段，不抛异常；路由照常 200，前端按 gitAvailable 降级）。
// =============================================================================
import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { STAGES } from './stages.mjs'
import { TRAJECTORY_ROOT, listTrajectories } from './trajectory.mjs'
import { PROJECT_ROOT } from './paths.mjs'

const GIT_TIMEOUT_MS = Number(process.env.YXSPEC_GIT_TIMEOUT_MS ?? 10000)

/** 单次 git 调用（execFile，无 shell）。任何失败都返回 ok:false，不抛。 */
function runGit(args, { cwd, timeoutMs = GIT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: timeoutMs, encoding: 'utf8', windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            error:
              err.code === 'ENOENT'
                ? 'git-not-installed'
                : String((stderr ?? '').trim() || err.message || 'git error'),
            code: err.code ?? null,
          })
          return
        }
        resolve({ ok: true, stdout: stdout ?? '', stderr: stderr ?? '' })
      },
    )
  })
}

/** 阶段 token 是否在权威表（与 trajectory.mjs 同规则）。 */
function isStageToken(token) {
  return typeof token === 'string' && Object.prototype.hasOwnProperty.call(STAGES, token)
}

/**
 * porcelain v1 XY → 语义化状态（前端 GitDirtyFile.status 契约：
 * added | modified | deleted | renamed | untracked | conflict）。
 * 优先级：暂存区 X 位冲突/重命名优先（'AA'/'DD' → conflict，'R' → renamed），
 * 否则暂存态；再否则工作区态（Y 位）。裸码（如 'M'、'D'）及未知码兜底为 modified。
 * 说明：git status --porcelain 短格式某些场景只输出单字符（如 rename/untracked 的
 * 'R'/'??' 只占首字符，Y 位为空），故单独判首字符；'??' 两个字符都算未跟踪。
 */
function porcelainStatus(xy) {
  const x = xy[0]
  const y = xy[1] ?? ''
  if (x === '?' && y === '?') return 'untracked'
  if (x === 'R' || y === 'R') return 'renamed'
  if ((x === 'A' && y === 'A') || (x === 'D' && y === 'D') || x === 'U' || y === 'U') return 'conflict'
  if (x === 'A') return 'added'
  if (x === 'D') return 'deleted'
  if (x === 'M' || x === 'T') return 'modified'
  if (y === 'A') return 'added'
  if (y === 'D') return 'deleted'
  if (y === 'M' || y === 'T') return 'modified'
  return 'modified'
}

/**
 * 解析 git 仓库根（候选优先级见文件头）。全部失败 → null。
 * @returns {Promise<{root: string, source: string} | null>}
 */
async function resolveGitRoot() {
  const candidates = []
  if (process.env.YXSPEC_GIT_ROOT) candidates.push({ root: process.env.YXSPEC_GIT_ROOT, source: 'YXSPEC_GIT_ROOT' })
  const projectRoot = process.env.YXSPEC_PROJECT_ROOT || PROJECT_ROOT
  if (projectRoot) candidates.push({ root: projectRoot, source: 'YXSPEC_PROJECT_ROOT/PROJECT_ROOT' })
  for (const c of candidates) {
    const r = await runGit(['-C', c.root, 'rev-parse', '--show-toplevel'])
    if (r.ok && r.stdout.trim()) return { root: r.stdout.trim(), source: c.source }
  }
  // 兜底：在 cwd 下找仓库根（未设 env / PROJECT_ROOT 不是仓库时）
  const r = await runGit(['rev-parse', '--show-toplevel'])
  if (r.ok && r.stdout.trim()) return { root: r.stdout.trim(), source: 'rev-parse-fallback' }
  return null
}

/**
 * GET /api/git/status 数据源。
 * 返回工作区 git 全貌：分支 / HEAD / 脏文件 / 领先落后 / 最近 5 条提交。
 * git 不可用（不是仓库/未安装）→ gitAvailable:false + error，不抛。
 * @returns {Promise<object>}
 */
export async function getStatus() {
  const base = {
    gitAvailable: false,
    branch: null,
    detached: false,
    head: null,
    dirtyFiles: [],
    ahead: 0,
    behind: 0,
    recentCommits: [],
    tags: [],
    root: null,
    error: null,
  }
  const gr = await resolveGitRoot()
  if (!gr) {
    base.error = 'not-a-git-repo：未找到仓库根（可设 YXSPEC_GIT_ROOT 指向 git 仓库）'
    return base
  }
  base.root = gr.root
  const cwd = gr.root
  const [statusR, headR, logR, tagR] = await Promise.all([
    // -c core.quotepath=false：含非 ASCII（中文）的文件路径以原始 UTF-8 输出，
    // 而不是 `"docs/\345\271\263..."` 这类 octal 转义（前端直接可读/可直接拼接路径）。
    runGit(['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-b'], { cwd }),
    runGit(['rev-parse', '--short', 'HEAD'], { cwd }),
    // 富格式 log：hash + unix 时间戳 + subject（与 getStageRecords 同款 format，
    // 便于前端展示提交时间；subject 不换行，message 兜底取 subject）
    runGit(['log', '-5', '--date=unix', '--format=%h%x09%ct%x09%s'], { cwd }),
    // tag 清单：refname:short（普通/注解/远端 tag 均显示，按字母序）
    runGit(['for-each-ref', 'refs/tags', '--sort=-creatordate', '--format=%(refname:short)'], { cwd }),
  ])
  if (!statusR.ok) {
    base.error =
      statusR.error === 'git-not-installed' ? 'git-not-installed：未安装 git' : `git 不可用：${statusR.error}`
    return base
  }
  // 第一行：## <branch>...<upstream> [ahead N, behind M]（或 HEAD (no branch) / No commits yet on <branch>）
  const lines = statusR.stdout.split('\n').filter((l) => l.length > 0)
  const first = lines[0] ?? ''
  if (first.startsWith('## ')) {
    const headPart = first.slice(3)
    const bracket = headPart.match(/\[([^\]]*)\]$/)
    const branchInfo = bracket ? headPart.slice(0, bracket.index).trim() : headPart.trim()
    if (branchInfo.startsWith('No commits yet on ')) {
      base.branch = branchInfo.slice('No commits yet on '.length) || null
    } else if (branchInfo.startsWith('HEAD (no branch)') || branchInfo.startsWith('HEAD (detached')) {
      base.detached = true
      base.branch = null
    } else {
      base.branch = branchInfo.split('...')[0] || null
    }
    if (bracket) {
      const inner = bracket[1]
      const ahead = inner.match(/ahead (\d+)/)
      const behind = inner.match(/behind (\d+)/)
      base.ahead = ahead ? Number(ahead[1]) : 0
      base.behind = behind ? Number(behind[1]) : 0
    }
  }
  // 其余行 = 脏文件（porcelain v1：前两字符 XY，X=暂存态，Y=工作区态；untracked = ??）
  for (const line of lines.slice(1)) {
    if (line.length < 3) continue
    const xy = line.slice(0, 2)
    if (xy[0] === ' ' && xy[1] === ' ') continue
    base.dirtyFiles.push({
      path: line.slice(3),
      status: porcelainStatus(xy), // 语义化（前端 DIRTY_STYLE 契约），staged 单独判定
      staged: xy[0] !== ' ' && xy[0] !== '?',
    })
  }
  base.head = headR.ok && headR.stdout.trim() ? headR.stdout.trim() : null
  if (logR.ok) {
    for (const line of logR.stdout.split('\n')) {
      if (!line.trim()) continue
      const [hash, ct, ...subjectParts] = line.split('\t')
      const sec = Number(ct)
      const subject = subjectParts.join('\t') || ''
      base.recentCommits.push({
        hash: hash || line.trim(),
        subject,
        message: subject, // 与前端 GitRecentCommit.message 对齐
        at: Number.isFinite(sec) && sec > 0 ? new Date(sec * 1000).toISOString() : null,
      })
    }
  }
  base.tags = tagR.ok
    ? tagR.stdout.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20)
    : []
  base.gitAvailable = true
  base.error = null
  return base
}

/** 轨迹记录 → git 对照行（git 相关字段默认 null）。 */
function toStageRow(r) {
  return {
    seq: r.seq ?? 0,
    commit: null, // 7 位短 hash
    commitFull: null, // 完整 hash
    subject: null, // commit 提交说明
    tag: null, // 指向该 commit 的 tag（无 → null）
    status: r.status ?? null,
    startedAt: r.startedAt ?? null,
    finishedAt: r.finishedAt ?? null,
    sessionId: r.sessionId ?? null,
    rolled_back: r.rolled_back ?? false,
    rollbackId: r.rollbackId ?? null,
  }
}

/**
 * GET /api/git/commits?stage=<token> 数据源。
 * 读 `runtime-data/trajectory/<stage>/*.jsonl` 该阶段轨迹，与 git log/tag 交叉，
 * 返回「阶段 ↔ commit ↔ tag」对照表：每条轨迹记录 → 其 startedAt 时刻的最新提交
 * （git commit 时间戳 <= startedAt）及其 tag。
 * git 不可用 → gitAvailable:false，记录照常返回（commit/tag 为 null）。
 * 未知阶段 → { ok:false, error:'unknown-stage' }。
 * @param {string} stage 阶段 token
 * @returns {Promise<object>} { ok, stage, gitAvailable, root, total, records, error? }
 */
export async function getStageRecords(stage) {
  if (!isStageToken(stage)) return { ok: false, error: 'unknown-stage', stage }
  const records = listTrajectories(stage) // 复用 trajectory.mjs 解析（含 rollback 合并、时间升序）
  const out = {
    ok: true,
    stage,
    gitAvailable: false,
    root: null,
    total: records.length,
    records: [],
    error: null,
  }
  const gr = await resolveGitRoot()
  if (!gr) {
    out.error = 'not-a-git-repo：未找到仓库根（可设 YXSPEC_GIT_ROOT 指向 git 仓库）'
    out.records = records.map((r) => toStageRow(r))
    return out
  }
  out.root = gr.root
  const cwd = gr.root
  // 批量拉取：所有提交（hash + 时间戳 + subject）+ tag→commit 映射（各一次 git 调用）
  const [logR, tagR] = await Promise.all([
    runGit(['log', '--all', '--date=unix', '--format=%H%x09%ct%x09%s'], { cwd }),
    runGit(['for-each-ref', 'refs/tags', '--format=%(objectname)%x09%(*objectname)%x09%(refname:short)'], { cwd }),
  ])
  const commits = [] // { hash, sec, subject }，时间降序
  if (logR.ok) {
    for (const line of logR.stdout.split('\n')) {
      if (!line.trim()) continue
      const [hash, secStr, ...subjectParts] = line.split('\t')
      const sec = Number(secStr)
      if (hash && Number.isFinite(sec)) commits.push({ hash, sec, subject: subjectParts.join('\t') })
    }
    commits.sort((a, b) => b.sec - a.sec)
  }
  const tagByCommit = new Map()
  if (tagR.ok) {
    for (const line of tagR.stdout.split('\n')) {
      if (!line.trim()) continue
      const [obj, peeled, name] = line.split('\t')
      const commitHash = peeled || obj // 轻量 tag：obj=commit；注解 tag：peeled=commit
      if (commitHash && name) tagByCommit.set(commitHash, name)
    }
  }
  const gitOk = logR.ok && tagR.ok
  out.gitAvailable = gitOk
  if (!gitOk) out.error = 'git 不可用：无法读取提交历史'
  out.records = records.map((r) => {
    const row = toStageRow(r)
    const started = r.startedAt ? Math.floor(r.startedAt / 1000) : null
    if (started != null && logR.ok) {
      const at = commits.find((c) => c.sec <= started) // 数组已降序 → 第一个即最新 ≤ startedAt
      if (at) {
        row.commit = at.hash.slice(0, 7)
        row.commitFull = at.hash
        row.subject = at.subject
        row.tag = tagByCommit.get(at.hash) ?? null
      }
    }
    return row
  })
  return out
}

/**
 * POST /api/git/rollback 数据源。
 * 回滚审计留档：往该阶段轨迹 JSONL 尾部追加一条 rollback 审计行
 * （append-only，与 trajectory.mjs rollbackTrajectory 同款落盘形态，额外记 commit）。
 * 只留档，绝不执行 git reset / 任何 git 操作。
 * 幂等：同一 rollbackId（`<stage>-<seq>`）已标记 → 返回 already:true，不重复追加。
 * @param {object} param0 { stage, seq, commit, reason }
 * @returns {Promise<object>}
 */
export async function recordRollback({ stage, seq, commit, reason } = {}) {
  if (!isStageToken(stage)) return { ok: false, error: 'unknown-stage', stage }
  const seqNum = typeof seq === 'number' ? seq : Number(seq)
  if (!Number.isInteger(seqNum) || seqNum < 1) {
    return { ok: false, error: 'bad-request', message: 'seq 必须为正整数', stage }
  }
  const commitStr = typeof commit === 'string' && commit.trim() ? commit.trim() : null
  if (commit != null && commitStr === null) {
    return { ok: false, error: 'bad-request', message: 'commit 必须为非空字符串', stage }
  }
  if (commitStr && !/^[0-9a-fA-F]{7,40}$/.test(commitStr)) {
    return { ok: false, error: 'bad-request', message: 'commit 格式非法（需 7-40 位 hex）', stage }
  }
  const all = listTrajectories(stage)
  if (!all.some((r) => r.seq === seqNum)) {
    return { ok: false, error: 'no-trajectory', message: `阶段 ${stage} 无 seq=${seqNum} 的执行记录`, stage }
  }
  const id = `${stage}-${seqNum}`
  // 幂等：该 rollbackId 已标记过 → 不重复追加（审计留档唯一）
  if (all.some((r) => r.rollbackId === id)) {
    return { ok: true, already: true, rollbackId: id, seq: seqNum, commit: commitStr, at: null }
  }
  const reasonStr = typeof reason === 'string' && reason.trim() ? reason.trim() : 'manual-rollback'
  const entry = {
    type: 'rollback',
    stage,
    seq: seqNum,
    rollbackId: id,
    commit: commitStr,
    reason: reasonStr,
    at: Date.now(),
  }
  const dir = join(TRAJECTORY_ROOT, stage)
  const file = join(dir, `${stage}-${String(seqNum).padStart(3, '0')}.jsonl`)
  try {
    mkdirSync(dir, { recursive: true })
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
  } catch (e) {
    return { ok: false, error: 'write-failed', message: String(e?.message ?? e), stage }
  }
  console.log(`[gateway] git rollback 留档: ${id} commit=${commitStr ?? '(none)'} reason=${reasonStr}`)
  return {
    ok: true,
    already: false,
    rollbackId: id,
    seq: seqNum,
    commit: commitStr,
    reason: reasonStr,
    at: entry.at,
    note: '已追加 rollback 审计行（只留档，未执行 git 操作）',
  }
}
