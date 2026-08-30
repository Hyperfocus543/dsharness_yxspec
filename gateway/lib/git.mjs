// =============================================================================
// git.mjs — 网关 git 工作区状态 API（只读执行 git + 追加审计 JSONL）
// =============================================================================
// 职责：
//   1. getStatus()            — 工作区 git 状态（分支/HEAD/脏文件/领先落后/最近提交）
//   2. getStageRecords(stage) — 阶段 ↔ commit ↔ tag 对照表（轨迹 JSONL × git log/tag）
//   3. recordRollback(...)    — 回滚审计留档（JSONL 尾部追加，只留档不执行 git reset）
//
// gitRoot 解析规则（优先级从高到低）：
//   0. resolveGitRoot(root) 显式 root 参数（HTTP 层 ?root= 工作区切换）—— 只校验
//      该路径，成功 → source:'explicit'；失败 → 返回 null（不回落 env/默认根）
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
// 红线：本模块做「只读 git + 追加审计 JSONL」；写操作（clone/fetch/pull/push/
// checkout）集中在 lib/git-workspaces.mjs，全部走白名单 + 审计 JSONL，push 需
// 前端显式触发。所有函数优雅处理 git 不可用（不是仓库/没装 git → 返回
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
 * 反引号 porcelain 路径：git status --porcelain 对含 空格/制表符/引号/反斜杠 的路径，
 * 即使 `-c core.quotepath=false` 也仍按 C 风格加双引号包裹（core.quotepath 只关
 * 非 ASCII 转义，不含空格类）。即 `?? "with space.txt"`、`R "old a" -> "new b"`。
 * 而 getStatus / getFileDiff 的路径判定（untracked/deleted 匹配、diff -- <path>）
 * 需要的是「无引号的真实路径」，否则 dirtyFiles.path 会带字面引号、状态匹配恒失败。
 * 解析规则（对齐 git 的 C-style quoting）：
 *   - 整段以 `"` 开头才视为被引号包裹（纯空格内路径），逐个解析转义：
 *     `\"`→"、`\\`→\、`\n`→换行、`\t`→制表、`\NNN`（八进制）→ 该字节字符；
 *   - 未包裹（首尾无引号）→ 原样返回（`中文文件.txt`、`normal.txt`）。
 */
function unquoteGitPath(raw) {
  const s = String(raw ?? '')
  if (s.length < 2 || s[0] !== '"') return s
  let out = ''
  for (let i = 1; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      const n = s[i + 1]
      if (n === '"') { out += '"'; i += 1; continue }
      if (n === '\\') { out += '\\'; i += 1; continue }
      if (n === 'n') { out += '\n'; i += 1; continue }
      if (n === 't') { out += '\t'; i += 1; continue }
      if (n >= '0' && n <= '7' && i + 3 < s.length) {
        const oct = s.slice(i + 1, i + 4)
        if (/^[0-7]{3}$/.test(oct)) {
          out += String.fromCharCode(parseInt(oct, 8))
          i += 3
          continue
        }
      }
      out += n // 未知转义：保留字面（与原字符等价）
      i += 1
      continue
    }
    if (c === '"' && i === s.length - 1) break // 收尾引号
    out += c
  }
  return out
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
 * 解析 `git diff --numstat` 输出 → 文件改动统计（纯函数，供工作区脏文件汇总）。
 * 每行 `加行\t删行\t路径`：新增行 +N / 删除行 -M / 文件数取总行数。
 * 二进制文件行 `-\t-\tpath`（加删列各为 `-`）→ 计入文件数但不算行数。
 * 加/删为 0 的路径段不会出现（git 只输出有净改动的文件）。
 * 与 git-workspaces.mjs 的 parseNumstat 同款实现（该处未导出，此处置于本模块
 * 避免跨模块依赖；口径一致：{ files, added, removed }）。
 * @param {string} out
 * @returns {{files:number, added:number, removed:number} | null}
 */
export function parseNumstat(out) {
  if (typeof out !== 'string' || !out.trim()) return null
  let files = 0
  let added = 0
  let removed = 0
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [a, d, ...pathParts] = line.split('\t')
    if (!pathParts.length || !pathParts.join('\t').trim()) continue
    files++
    const addN = Number(a)
    const delN = Number(d)
    if (Number.isFinite(addN) && Number.isFinite(delN)) {
      if (addN > 0) added += addN
      if (delN > 0) removed += delN
    }
  }
  if (files === 0) return null
  return { files, added, removed }
}

/**
 * 解析 git 仓库根（候选优先级见文件头）。
 * 可选 root 参数：显式指定要查看的工作区 —— 只校验该路径，
 * `git -C <root> rev-parse --show-toplevel` 成功 → { root: <真实根>, source: 'explicit' }；
 * 失败 → null（不回落 env/默认根，与 git.mjs 只读职责一致，跨工作区不会误串根）。
 * 无 root → 走 env/YXSPEC_PROJECT_ROOT/cwd 兜底候选链。
 * @param {string} [root] 显式工作区根
 * @returns {Promise<{root: string, source: string} | null>}
 */
export async function resolveGitRoot(root) {
  if (typeof root === 'string' && root.trim()) {
    const r = await runGit(['-C', root.trim(), 'rev-parse', '--show-toplevel'])
    if (r.ok && r.stdout.trim()) return { root: r.stdout.trim(), source: 'explicit' }
    return null
  }
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
 * 批量拉取 git 提交索引 + tag→commit 映射（getStageRecords 与轨迹聚合 git 增强共用）。
 * 一次 `git log --all`（hash+unix 时间戳+subject）+ 一次 for-each-ref（tag 映射），
 * 与 getStatus 的最近提交同口径但覆盖全部分支。任何一次失败 → ok:false（不抛）。
 * @param {string} cwd git 仓库根
 * @returns {Promise<{commits: {hash:string,sec:number,subject:string}[], tagByCommit: Map<string,string>, ok: boolean}>}
 */
export async function loadGitIndex(cwd) {
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
  return { commits, tagByCommit, ok: logR.ok && tagR.ok }
}

/**
 * 解析 porcelain v1 首行（`## <branch>...<upstream> [ahead N, behind M]`）→ 分支/游离态。
 * 纯函数（可单测）：branchInfo 已剥掉尾部方括号区间。
 * 游离 HEAD 的领先/落后在**括号**里（`## HEAD (no branch, ahead 1, behind 2)`），
 * 不匹配 `[...]` —— 若把括号当分支名会得到 branch="HEAD (no branch, ahead 1…)"
 * 且 detached=false，前端把游离态显示成正常分支名。故单独识别游离头部后
 * 再剥离括号区间。
 * @param {string} branchInfo
 * @returns {{ branch: string|null, detached: boolean }}
 */
export function parsePorcelainHead(branchInfo) {
  if (branchInfo.startsWith('No commits yet on ')) {
    return { branch: branchInfo.slice('No commits yet on '.length) || null, detached: false }
  }
  if (branchInfo.startsWith('HEAD (no branch') || branchInfo.startsWith('HEAD (detached')) {
    return { branch: null, detached: true }
  }
  const paren = branchInfo.match(/ \(.*\)$/)
  const plain = paren ? branchInfo.slice(0, paren.index).trim() : branchInfo.trim()
  return { branch: plain.split('...')[0] || null, detached: false }
}

/**
 * GET /api/git/status 数据源。
 * 返回工作区 git 全貌：分支 / HEAD / 脏文件 / 领先落后 / 最近 5 条提交。
 * git 不可用（不是仓库/未安装）→ gitAvailable:false + error，不抛。
 * @param {string} [root] 显式工作区根（缺省走 env/默认根解析）
 * @returns {Promise<object>}
 */
export async function getStatus(root) {
  const base = {
    gitAvailable: false,
    branch: null,
    detached: false,
    head: null,
    dirtyFiles: [],
    // 工作区脏文件改动汇总（git diff HEAD --numstat 聚合：+N/-M 行数与文件数）。
    // 有净改动才给 { files, added, removed }；无 HEAD/无改动/采集失败 → null（前端不渲染）。
    dirtyStats: null,
    ahead: 0,
    behind: 0,
    recentCommits: [],
    tags: [],
    headTags: [],
    root: null,
    error: null,
  }
  const gr = await resolveGitRoot(root)
  if (!gr) {
    base.error = 'not-a-git-repo：未找到仓库根（可设 YXSPEC_GIT_ROOT 指向 git 仓库，或传 root 参数）'
    return base
  }
  base.root = gr.root
  const cwd = gr.root
  const [statusR, headR, logR, tagR, numstatR] = await Promise.all([
    // -c core.quotepath=false：含非 ASCII（中文）的文件路径以原始 UTF-8 输出，
    // 而不是 `"docs/\345\271\263..."` 这类 octal 转义（前端直接可读/可直接拼接路径）。
    runGit(['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-b'], { cwd }),
    runGit(['rev-parse', '--short', 'HEAD'], { cwd }),
    // 富格式 log：hash + unix 时间戳 + subject（与 getStageRecords 同款 format，
    // 便于前端展示提交时间；subject 不换行，message 兜底取 subject）
    runGit(['log', '-5', '--date=unix', '--format=%h%x09%ct%x09%s'], { cwd }),
    // tag 清单富格式：refname:short + 指向 commit（普通=objectname / 注解=peeled）
    // + 提交说明 + 提交时间 —— 前端 tag 徽标 hover 即可看到「该 tag 指向哪个检查点」。
    // 注解 tag 的星号变体（%(*objectname)/%(*subject)/%(*committerdate)）剥到其指向的
    // commit；轻量 tag 无星号变体，直接取 objectname/subject/committerdate（同 commit 字段）。
    runGit(['for-each-ref', 'refs/tags', '--sort=-creatordate', '--format=%(refname:short)%09%(objectname)%09%(*objectname)%09%(subject)%09%(*subject)%09%(committerdate:iso-strict)%09%(*committerdate:iso-strict)'], { cwd }),
    // 脏文件改动汇总（git diff HEAD --numstat）：新增/删除行数聚合。
    // 与 dirtyFiles 并列采集（同一 Promise.all 批次，不额外串行）；
    // 首次提交前无 HEAD → 该命令失败，dirtyStats 保持 null（前端不展示，语义正确）。
    runGit(['diff', 'HEAD', '--numstat'], { cwd }),
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
    // 游离 HEAD 的领先/落后在括号里（`## HEAD (no branch, ahead 1, behind 2)`），不在
    // 方括号——若只解析方括号，游离态的领先/落后恒读不到（前端分支框显示「领先 0 · 落后 0」，
    // 而实际游离 HEAD 也可能落后远端若干提交）。branchInfo 先剥方括号，游离头部/括号区间
    // 交给 parsePorcelainHead；ahead/behind 分别从「方括号 + 游离括号」两处提取，两处都没有
    // 才回落 0。
    const branchInfo = bracket ? headPart.slice(0, bracket.index).trim() : headPart.trim()
    const parsed = parsePorcelainHead(branchInfo)
    base.branch = parsed.branch
    base.detached = parsed.detached
    let ahead = 0
    let behind = 0
    if (bracket) {
      const inner = bracket[1]
      const a = inner.match(/ahead (\d+)/)
      const b = inner.match(/behind (\d+)/)
      ahead = a ? Number(a[1]) : ahead
      behind = b ? Number(b[1]) : behind
    }
    if (parsed.detached) {
      // 游离括号内同样可能带 ahead/behind（`## HEAD (no branch, ahead 1)`）
      const a = headPart.match(/ahead (\d+)/)
      const b = headPart.match(/behind (\d+)/)
      if (a) ahead = Number(a[1])
      if (b) behind = Number(b[1])
    }
    base.ahead = ahead
    base.behind = behind
  }
  // 其余行 = 脏文件（porcelain v1：前两字符 XY，X=暂存态，Y=工作区态；untracked = ??）
  for (const line of lines.slice(1)) {
    if (line.length < 3) continue
    const xy = line.slice(0, 2)
    if (xy[0] === ' ' && xy[1] === ' ') continue
    // 重命名条目（R 位）：porcelain v1 输出 `XY old -> new`（箭头分隔源/目标）。
    // 路径取 ` -> ` 之后的目标路径（前端契约 path=当前工作区相对路径），
    // 否则会把整串 `old -> new` 当路径（diff 预览/回滚按此路径会 404）。
    // 含空格路径在 porcelain 里被引号包裹（如 `"old a" -> "new b"`）→ 先按
    // ` -> ` 切分再对目标段反引号，整段一起 unquote 会保留箭头前的字面 `"`。
    let path = line.slice(3)
    const arrow = path.indexOf(' -> ')
    path = arrow >= 0 ? unquoteGitPath(path.slice(arrow + 4)) : unquoteGitPath(path)
    base.dirtyFiles.push({
      path,
      status: porcelainStatus(xy), // 语义化（前端 DIRTY_STYLE 契约），staged 单独判定
      staged: xy[0] !== ' ' && xy[0] !== '?',
    })
  }
  // 脏文件改动汇总：git diff HEAD --numstat 聚合（新增/删除行数 + 文件数）。
  // 只在 git 可用且 HEAD 存在（首次提交前该命令失败）时给值；无净改动 → null，
  // 前端据此不渲染「0 文件」误导统计。与 dirtyFiles 同源（同一工作区同一时刻），
  // 前端头部计数与「+N/-M」chip 一眼对应。
  base.dirtyStats = numstatR.ok ? parseNumstat(numstatR.stdout) : null
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
  // tags：富格式 tag 清单（name + 指向 commit + subject + 提交时间，按创建时间倒序，最多 20 个）。
  // 与 headTags 解析共用同一份 for-each-ref stdout（一次 git 调用喂两处）。
  const tagsOut = tagR.ok ? tagR.stdout.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20) : []
  base.tags = tagsOut.map((l) => {
    const [name, obj, peeled, subj, starSubj, ct, starCt] = l.split('\t')
    const commitHash = peeled || obj // 轻量 tag：obj=commit；注解 tag：peeled=commit
    const subject = starSubj || subj || ''
    const commitAt = starCt || ct || ''
    return {
      name: name || '',
      commit: commitHash || null,
      commitShort: commitHash ? commitHash.slice(0, 7) : null,
      subject: subject || null,
      // ISO-8601（本地时区，如 `2026-08-30T08:16:12+08:00`）→ 前端 relTimeOf 直接 new Date()
      commitAt: commitAt || null,
    }
  })
  // headTags：指向当前 HEAD 的 tag（普通 tag = objectname；注解 tag = peeled 指向 commit）。
  // 前端 tag 列表据此把 HEAD tag 高亮 + 标「HEAD」角标（git 语义：tag 指向 HEAD = 当前检查点）。
  // for-each-ref 只输出 20 行上限（base.tags 同款切片），HEAD 恰在切掉的部分时返回空数组——
  // 只影响高亮展示，不影响 tags 全量可见，属可接受降级。
  const headTags = new Set()
  if (tagR.ok && headR.ok) {
    const headShort = headR.stdout.trim() // rev-parse --short 输出短 hash（唯一前缀）
    if (headShort) {
      for (const l of tagR.stdout.split('\n')) {
        if (!l.trim()) continue
        const [name, obj, peeled] = l.split('\t')
        const commitHash = peeled || obj // 轻量 tag：obj=commit；注解 tag：peeled=commit
        // 短 hash 是完整 hash 的确定唯一前缀（rev-parse --short 保证唯一性）→ 前缀比对
        if (commitHash && commitHash.startsWith(headShort) && name) headTags.add(name)
      }
    }
  }
  base.headTags = [...headTags].slice(0, 20)
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
 * @param {string} [root] 显式工作区根（缺省走 env/默认根解析）
 * @returns {Promise<object>} { ok, stage, gitAvailable, root, total, records, error? }
 */
export async function getStageRecords(stage, root) {
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
  const gr = await resolveGitRoot(root)
  if (!gr) {
    out.error = 'not-a-git-repo：未找到仓库根（可设 YXSPEC_GIT_ROOT 指向 git 仓库，或传 root 参数）'
    out.records = records.map((r) => toStageRow(r))
    return out
  }
  out.root = gr.root
  const cwd = gr.root
  // 批量拉取：所有提交（hash + 时间戳 + subject）+ tag→commit 映射（各一次 git 调用）
  const { commits, tagByCommit, ok: gitOk } = await loadGitIndex(cwd)
  out.gitAvailable = gitOk
  if (!gitOk) out.error = 'git 不可用：无法读取提交历史'
  out.records = records.map((r) => {
    const row = toStageRow(r)
    const started = r.startedAt ? Math.floor(r.startedAt / 1000) : null
    if (started != null && gitOk) {
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
 * GET /api/git/diff 数据源：脏文件 diff 预览（默认）或留痕 commit 范围 diff。
 * 只读执行 git（无 shell），供工作区管控卡 hover 预览改动内容。
 * 入参：
 *   - path  仓库相对路径（反斜杠归一为斜杠；必须落在仓库内，杜绝跨仓读取）
 *   - staged=true 预览已暂存改动（--cached，X 位暂存态）；缺省预览工作区改动
 *   - from / to（可选 commit hash）：传入后进 commit 范围模式 —— 跳过脏文件判定，
 *     直接 diff `from...to`（含二者之间的所有文件，三-dot 语义）。留痕 diff 预览用
 *     （阶段留痕行 hover 展示该条 commit 相对上一条留痕 commit 的改动）。
 *     仅 from 无 to 时 diff `from`（等价 from..工作区）。两者缺省则走脏文件模式。
 * 脏文件模式判定逻辑（与 getStatus 的 porcelain XY 语义一致，便于预览"状态对应哪个 diff"）：
 *   - untracked（??）→ git 没有索引/HEAD 基线可 diff → status:'untracked'（前端提示无基线）
 *   - deleted（工作区删除）→ HEAD → 工作区路径 diff 可能为空文件，用 note 兜底
 *   - 其余（modified/added/renamed/conflict，含 staged）→ 标准 two-dot diff
 * 返回 { ok, status, path, staged, diff, stats, error }；任何 git 失败 → { ok:false, error }。
 * 红线：路径不参与 shell 拼接（execFile 数组透传）；只读 git diff，绝不写文件。
 */
export async function getFileDiff({ path, staged = false, from = null, to = null, root } = {}) {
  const p = typeof path === 'string' ? path.replace(/\\/g, '/').trim() : ''
  const fromStr = typeof from === 'string' && from.trim() ? from.trim() : null
  const toStr = typeof to === 'string' && to.trim() ? to.trim() : null
  const commitRangeMode = fromStr !== null && /^[0-9a-fA-F]{4,40}$/.test(fromStr)
  // 脏文件模式才强制 path（仓库相对路径）；commit 范围模式不读路径，无需校验
  if (!commitRangeMode) {
    if (!p || p === '.') return { ok: false, error: 'bad-request', message: 'path 不能为空' }
    // 防路径逃逸：拒绝绝对路径 / 盘符 / 父目录前缀，只能指向仓库内相对路径
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) {
      return { ok: false, error: 'bad-request', message: 'path 必须为仓库内相对路径' }
    }
  }
  const gr = await resolveGitRoot(root)
  if (!gr) return { ok: false, error: 'not-a-git-repo', message: '未找到仓库根（可设 YXSPEC_GIT_ROOT 指向 git 仓库，或传 root 参数）' }
  const cwd = gr.root

  // 脏文件模式才需要 porcelain 状态判定；range 模式直接整仓 diff（状态置 'range'）
  let isDeleted = false
  const args = ['-c', 'core.quotepath=false', 'diff']
  if (commitRangeMode) {
    // 三-dot：from 到 to 的增量改动；仅 from → diff from → 工作区。
    // 范围参数放 `--` 之前（`-- <path>` 会把 commit 名当 pathspec），不带 --cached。
    if (toStr) args.push(`${fromStr}...${toStr}`)
    else args.push(fromStr)
  } else {
    // 脏文件模式：先判定文件状态（untracked 无基线可 diff；deleted 走完整删除 diff）
    const st = await runGit(['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--', p], { cwd })
    // porcelain 输出路径可能被引号包裹（含空格/转义）→ 反引号后再与请求路径比对，
    // 否则 untracked/deleted 判定恒失败（`?? "a b.txt"` 的 `"a b.txt"` ≠ p）。
    const line = (st.ok ? st.stdout.split('\n').find((l) => unquoteGitPath(l.slice(3)) === p) : null) ?? ''
    const xy = line.slice(0, 2)
    const isUntracked = xy[0] === '?' && xy[1] === '?'
    isDeleted = porcelainStatus(xy) === 'deleted'
    if (isUntracked) {
      return { ok: true, status: 'untracked', path: p, staged, diff: null, stats: null, note: 'untracked 文件无索引/HEAD 基线，无 diff 可预览' }
    }
    if (staged) args.push('--cached')
    // 已删除文件 git 会正常输出完整删除 diff（diff --git + `--- a/` + `+++ /dev/null`），
    // 无需 --stat 兜底；加 --stat 反而只给 `1 file changed, N deletions(-)` 摘要行，
    // 前端 hover 预览失去被删的具体行。
    args.push('--', p)
  }
  const res = await runGit(args, { cwd })
  if (!res.ok) return { ok: false, error: res.error, message: 'git diff 执行失败' }
  const fullDiff = res.stdout ?? ''
  const diff = fullDiff.slice(0, 8000)
  // 行数统计：新增 +N / 删除 -M（diff 行头 ^\+[^+] 与 ^-[^-] 计数）。
  // 必须统计完整 diff 而非截断后的预览——diff 超过 8000 字符时，若按
  // diff（已截断）数行，后面的改动全部丢失（实测 500 行修改只数出 0/113），
  // stats 是「改动量」语义，应与完整 diff 对齐；截断只作用于展示字段 diff。
  let added = 0
  let removed = 0
  for (const l of fullDiff.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) added++
    else if (l.startsWith('-') && !l.startsWith('---')) removed++
  }
  return {
    ok: true,
    status: commitRangeMode ? 'range' : isDeleted ? 'deleted' : staged ? 'staged' : 'modified',
    path: p,
    staged,
    diff: diff || null,
    stats: { added, removed },
    note: isDeleted && !diff ? '工作区已删除：diff 为空（文件内容已不在工作区）' : null,
  }
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
