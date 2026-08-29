// =============================================================================
// git-workspaces.mjs — 网关工作区注册表 + git 写操作模块
// =============================================================================
// 职责：
//   1. listWorkspaces()        — 注册表列表（自动合并当前生效根为 defaultRoot）
//   2. addWorkspace({root})    — 校验 git 仓库 → 登记进注册表
//   3. removeWorkspace({id})   — 移除手动登记的工作区（default/auto 拒绝）
//   4. setActiveWorkspace({id})— 切换 activeId
//   5. gitOperate({root,action,args}) — git 写操作白名单（clone/fetch/pull/push/
//      checkout/branch -a/init），每个 action 的 root 必须是已登记工作区或 defaultRoot
//      （clone/init 例外：root 只是「目标父目录」锚点，本身无需已登记）
//
// 与 git.mjs 的分工：git.mjs 只读 git + 追加审计 JSONL（绝不写操作）；本模块
// 是「受白名单约束的 git 写操作层」。写操作一律走 execFile（无 shell，数组透传
// 参数，路径/参数含 shell 元字符也不会被解释），每次写操作（branch 只读列表除外）
// 追加审计 JSONL（照 recordRollback 的 mkdirSync + appendFileSync 范式）。
//
// 注册表文件（JSON）：{ version, defaultRoot, activeId, workspaces:[{id,name,root,source}] }
//   默认 gateway/runtime-js/runtime-data/git-workspaces.json，可用 YXSPEC_GIT_WORKSPACES 覆盖。
//   每条 source：'auto'（当前生效根，由 resolveGitRoot 推导，id 恒 'default'）或
//   'manual'（addWorkspace 手动登记，id 为 ws-<n> 递增）。
// 审计文件（JSONL）：默认 gateway/runtime-js/runtime-data/git-workspace-audit.jsonl，
//   可用 YXSPEC_GIT_AUDIT 覆盖。只追加不修改，失败仅 console.log 记录不抛。
//
// 红线：
//   - git 写操作仅限下方白名单；其余 action → { ok:false, error:'unknown-action' }
//   - 任何 git 失败 → { ok:false, error, message }（不抛异常，失败也记审计）
//   - clone 的 url / checkout 的 branch 不做 shell 拼接（execFile 数组透传），
//     但 url 仍过 isSafeGitUrl 白名单、dir 过 isSafeTargetDir，双保险防误用。
//   - clone/init 的 dir（目标目录）同过 isSafeTargetDir（Windows 绝对路径、非盘符
//     根、不含 ..），init 用前先 mkdirSync 确保目录存在，成功后自动 addWorkspace 登记。
// =============================================================================
import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveGitRoot } from './git.mjs'

const REGISTRY_VERSION = 1
const REGISTRY_FILE =
  process.env.YXSPEC_GIT_WORKSPACES ||
  join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime-js', 'runtime-data', 'git-workspaces.json')
const AUDIT_FILE =
  process.env.YXSPEC_GIT_AUDIT ||
  join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime-js', 'runtime-data', 'git-workspace-audit.jsonl')
const GIT_OP_TIMEOUT_MS = Number(process.env.YXSPEC_GIT_OP_TIMEOUT_MS ?? 120000)
// 单独一条审计 JSONL 的截断上限（避免恶意/异常 stdout 撑爆审计文件；只截断记录不截断执行）
const AUDIT_STDOUT_MAX = 4000

/**
 * 单次 git 调用（execFile，无 shell）。任何失败都返回 ok:false，不抛。
 * 与 git.mjs 的 runGit 同款实现（该函数未导出，此处本地复刻，避免改动现有文件）。
 * @param {string[]} args
 * @param {{cwd?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string, error?: string, code?: string|null}>}
 */
function runGit(args, { cwd, timeoutMs = GIT_OP_TIMEOUT_MS } = {}) {
  return new Promise((resolve_) => {
    execFile(
      'git',
      args,
      { cwd, timeout: timeoutMs, encoding: 'utf8', windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          resolve_({
            ok: false,
            error:
              err.code === 'ENOENT'
                ? 'git-not-installed'
                : String((stderr ?? '').trim() || err.message || 'git error'),
            code: err.code ?? null,
          })
          return
        }
        resolve_({ ok: true, stdout: stdout ?? '', stderr: stderr ?? '' })
      },
    )
  })
}

/** Windows 绝对路径判定：`D:/` 或 `D:\` 盘符开头（大小写均可，正斜杠归一）。 */
function isWindowsAbsolute(p) {
  return typeof p === 'string' && /^[A-Za-z]:[\\/]/.test(p)
}

/** Windows 盘符根（`D:/` / `D:\` / `D://` / `D:\\`）：clone 目标不允许落在盘符根。
 *  重复分隔符（`D://`）在 Windows 上同样指向盘符根（git clone/init 落在 D:\），
 *  故 `[\\/]+` 匹配任意连续分隔符序列，而非单个。 */
function isWindowsDriveRoot(p) {
  return /^[A-Za-z]:[\\/]+$/.test(p)
}

/**
 * 工作区 id 推导。
 * source:'auto' → 恒 'default'；source:'manual' → 优先 ws-<n> 递增，其次 root hash 短码。
 * @param {object} entry { root, source }
 * @param {string[]} existingIds 已占用 id（自动条目含 'default'）
 */
function workspaceIdFor({ root, source }, existingIds) {
  if (source === 'auto') return 'default'
  const rootNorm = String(root).replace(/\\/g, '/')
  for (let n = 1; ; n++) {
    const id = `ws-${n}`
    if (!existingIds.includes(id)) return id
  }
}

/** 由 root 末段目录名推断 name（默认工作区给可读名）。 */
function workspaceNameFor({ root, source }) {
  if (source === 'auto') return 'default'
  let name = ''
  try {
    // 规范化路径（确保尾分隔符剥离后取末段）
    name = basenameOf(String(root).replace(/[\\/]+$/, ''))
  } catch {
    name = ''
  }
  return name || 'workspace'
}

function basenameOf(p) {
  const norm = p.replace(/\\/g, '/')
  const parts = norm.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}
export { basenameOf }

/**
 * 追加审计 JSONL 行（照 git.mjs recordRollback 范式：mkdirSync + appendFileSync）。
 * 失败不抛，仅 console.log 记录（审计是尽力而为，不能因审计失败阻断 git 操作）。
 */
function appendAuditLine(entry) {
  try {
    mkdirSync(dirname(AUDIT_FILE), { recursive: true })
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8')
  } catch (e) {
    console.log(`[gateway] git-workspaces 审计落盘失败: ${e?.message ?? e}`)
  }
}

/** 追加 git 写操作审计（照规范固定字段）。args 对象序列化前先截断 stdout。 */
function recordGitOp({ root, action, args, ok, stdout, error }) {
  const rec = { at: Date.now(), root, action, args }
  if (ok === true) rec.ok = true
  else rec.ok = false
  if (stdout != null) rec.stdout = String(stdout).slice(0, AUDIT_STDOUT_MAX)
  if (error != null) rec.error = String(error)
  appendAuditLine(rec)
}

/** 读注册表 JSON；文件缺失/损坏 → 返回空结构（不抛）。 */
function readRegistry() {
  let data = null
  try {
    data = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'))
  } catch {
    data = null // 文件不存在或 JSON 损坏 → 视为空注册表，落盘时重建
  }
  return {
    version: REGISTRY_VERSION,
    defaultRoot: data && typeof data.defaultRoot === 'string' ? data.defaultRoot : null,
    activeId: data && typeof data.activeId === 'string' ? data.activeId : null,
    workspaces: Array.isArray(data && data.workspaces) ? data.workspaces : [],
  }
}

/** 写回注册表 JSON（覆盖写，注册表是单份 JSON 文档；失败抛给调用方转 ok:false）。 */
function writeRegistry(reg) {
  mkdirSync(dirname(REGISTRY_FILE), { recursive: true })
  writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2) + '\n', 'utf8')
}

/** 合并当前生效根（resolveGitRoot）为 defaultRoot 条目，返回新注册表对象。 */
function withDefaultRoot(reg) {
  const ws = Array.isArray(reg.workspaces) ? reg.workspaces.slice() : []
  const existing = new Set(ws.map((w) => w.root))
  if (reg.defaultRoot && typeof reg.defaultRoot === 'string' && !existing.has(reg.defaultRoot)) {
    ws.unshift({ id: 'default', name: workspaceNameFor({ root: reg.defaultRoot, source: 'auto' }), root: reg.defaultRoot, source: 'auto' })
  }
  // activeId 校验：active 工作区已不存在 → 回落 defaultRoot 对应条
  let activeId = reg.activeId
  const activeExists = ws.some((w) => w.id === activeId)
  if (!activeExists) {
    const def = ws.find((w) => w.id === 'default' && w.source === 'auto')
    activeId = def ? def.id : null
  }
  return { version: REGISTRY_VERSION, defaultRoot: reg.defaultRoot, activeId, workspaces: ws }
}

/**
 * 列出工作区（合并当前生效根）。
 * 返回 { version, defaultRoot, activeId, workspaces: [{id,name,root,source},...] }。
 */
export async function listWorkspaces() {
  const gr = await resolveGitRoot()
  const reg = readRegistry()
  const reg2 = { ...reg, defaultRoot: gr ? gr.root : null }
  const out = withDefaultRoot(reg2)
  return {
    version: out.version,
    defaultRoot: out.defaultRoot,
    activeId: out.activeId,
    workspaces: out.workspaces,
  }
}

/** 校验 root 是合法 git 仓库并取真实根。成功 → {root}；失败 → {error, message}。 */
async function verifyGitRepo(root) {
  const r = await runGit(['-C', root, 'rev-parse', '--show-toplevel'])
  if (!r.ok) {
    if (r.error === 'git-not-installed') return { error: 'git-not-installed', message: 'git 未安装' }
    return { error: 'not-a-git-repo', message: `不是 git 仓库：${r.error}` }
  }
  const realRoot = (r.stdout ?? '').trim()
  if (!realRoot) return { error: 'not-a-git-repo', message: 'git rev-parse 未返回仓库根' }
  return { root: realRoot.replace(/\\/g, '/') }
}

/**
 * 登记工作区。
 * - root 必须非空、绝对路径（盘符开头）、不含 `..` 逃逸、归一为正斜杠
 * - 必须是 git 仓库（git -C <root> rev-parse --show-toplevel）→ 取真实根
 * - 已存在同 root → { ok:true, already:true, list }
 * - 成功 → { ok:true, already:false, workspace, list }
 * - 失败 → { ok:false, error:'not-a-git-repo'|'bad-request', message }
 */
export async function addWorkspace({ root } = {}) {
  if (typeof root !== 'string' || !root.trim()) {
    return { ok: false, error: 'bad-request', message: 'root 不能为空' }
  }
  const rootNorm = root.trim().replace(/\\/g, '/')
  if (!isWindowsAbsolute(rootNorm)) {
    return { ok: false, error: 'bad-request', message: 'root 必须为绝对路径（Windows 盘符开头）' }
  }
  if (rootNorm.split('/').includes('..')) {
    return { ok: false, error: 'bad-request', message: 'root 不能含 .. 路径段' }
  }
  const verified = await verifyGitRepo(rootNorm)
  if (!verified.root) {
    return { ok: false, error: verified.error, message: verified.message }
  }
  const reg = readRegistry()
  const existing = reg.workspaces.find((w) => w.root === verified.root)
  if (existing) {
    const list = await listWorkspaces()
    return { ok: true, already: true, workspace: existing, list: list.workspaces }
  }
  const entry = {
    id: workspaceIdFor({ root: verified.root, source: 'manual' }, reg.workspaces.map((w) => w.id).concat('default')),
    name: workspaceNameFor({ root: verified.root, source: 'manual' }),
    root: verified.root,
    source: 'manual',
  }
  // 落盘时补 defaultRoot（磁盘注册表首次写入时 default 根也持久化，
  // 否则 defaultRoot 恒 null，setActive/gitOperate 读盘拿不到 default）
  const gr = await resolveGitRoot()
  const newReg = {
    ...reg,
    defaultRoot: reg.defaultRoot || (gr ? gr.root : null),
    workspaces: [...reg.workspaces, entry],
  }
  try {
    writeRegistry(newReg)
  } catch (e) {
    return { ok: false, error: 'write-failed', message: String(e?.message ?? e) }
  }
  const list = await listWorkspaces()
  return { ok: true, already: false, workspace: entry, list: list.workspaces }
}

/** 内部工具：removeWorkspace 的纯判定（可导出供测试）。 */
export function canRemoveWorkspace(id, target) {
  if (id === 'default' || (target && target.source === 'auto')) {
    return { ok: false, error: 'cannot-remove-default' }
  }
  if (!target) return { ok: false, error: 'not-found' }
  return { ok: true }
}

/**
 * 移除工作区。
 * - id='default' 或该条 source='auto' → { ok:false, error:'cannot-remove-default' }
 * - 不存在 → { ok:false, error:'not-found' }
 * - 成功 → { ok:true, list }
 */
export async function removeWorkspace({ id } = {}) {
  const reg = readRegistry()
  const target = reg.workspaces.find((w) => w.id === id)
  const verdict = canRemoveWorkspace(id, target)
  if (!verdict.ok) return { ok: false, error: verdict.error }
  const newReg = { ...reg, workspaces: reg.workspaces.filter((w) => w.id !== id) }
  try {
    writeRegistry(newReg)
  } catch (e) {
    return { ok: false, error: 'write-failed', message: String(e?.message ?? e) }
  }
  const list = await listWorkspaces()
  return { ok: true, list: list.workspaces }
}

/**
 * 切换 active 工作区。
 * - id 不在列表 → { ok:false, error:'not-found' }
 * - 成功 → { ok:true, activeId, list }
 */
export async function setActiveWorkspace({ id } = {}) {
  const reg = readRegistry()
  // default 根只在 listWorkspaces 内存合并（磁盘注册表不落 default 条目），
  // 故显式认可 id==='default'（defaultRoot 存在即视为合法 active）。
  // 与 gitOperate/listWorkspaces 同口径恒重新解析当前生效根：磁盘 defaultRoot 是
  // addWorkspace 时的陈旧快照，跨进程换项目后仍认它为合法 active 会误导前端。
  {
    const gr = await resolveGitRoot()
    reg.defaultRoot = gr ? gr.root : null
  }
  const inList = reg.workspaces.some((w) => w.id === id)
  const isDefault = id === 'default' && reg.defaultRoot
  if (!inList && !isDefault) return { ok: false, error: 'not-found' }
  const newReg = { ...reg, activeId: id }
  try {
    writeRegistry(newReg)
  } catch (e) {
    return { ok: false, error: 'write-failed', message: String(e?.message ?? e) }
  }
  const list = await listWorkspaces()
  return { ok: true, activeId: id, list: list.workspaces }
}

/**
 * 解析 `git diff --numstat` 输出 → 文件改动统计（纯函数，供 pull/fetch 结果展示）。
 * 每行 `加行\t删行\t路径`：新增行 +N / 删除行 -M / 文件数取总行数。
 * 二进制文件行 `-\t-\tpath`（加删列各为 `-`）→ 计入文件数但不算行数。
 * 注：加/删为 0 的路径段不会出现（git 只输出有净改动的文件）。
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
 * fetch 落后提交摘要（纯函数，供 fetch 结果展示）。
 * 入参 = fetch 前后各一次 `git rev-list --count HEAD..@{u}` 的 stdout（trim 后为整数串）。
 * 返回 { before, after, delta }：before/after 为该时刻落后上游的提交数，
 * delta = after - before（正 = 这次 fetch 拉到了 N 个新提交；0 = 无更新）。
 * 任一边缺上游（如首次 push 前无 @{u}，rev-list 输出空）→ null（前端不展示）。
 * @param {string|null|undefined} beforeOut fetch 前 rev-list stdout
 * @param {string|null|undefined} afterOut fetch 后 rev-list stdout
 * @returns {{before:number, after:number, delta:number} | null}
 */
export function fetchBehindSummary(beforeOut, afterOut) {
  const parse = (s) => {
    if (typeof s !== 'string') return null
    const t = s.trim()
    if (!/^\d+$/.test(t)) return null
    return Number(t)
  }
  const before = parse(beforeOut)
  const after = parse(afterOut)
  if (before == null || after == null) return null
  return { before, after, delta: after - before }
}

/**
 * git 写操作白名单（受 URL 白名单 + 已登记工作区约束）。
 * @param {{root: string, action: string, args?: object}} param0
 */
export async function gitOperate({ root, action, args = {} } = {}) {
  // 1) action 白名单校验（未知 action 直接拒绝，不触碰 git）
  const KNOWN = ['clone', 'fetch', 'pull', 'push', 'checkout', 'branch', 'init']
  if (!KNOWN.includes(action)) {
    return { ok: false, error: 'unknown-action', message: `不支持的操作：${action}` }
  }
  // 2) root 必须是已登记工作区（或等于 defaultRoot）——按真实仓库根比对：
  //    注册表存的是 rev-parse 归一后的顶层根，请求的 root 可能是其子目录，
  //    故先 `git -C <root> rev-parse --show-toplevel` 归一后再比对。
  //    clone 例外：其 root 只是「目标父目录」锚点，本身无需已登记。
  const reg = readRegistry()
  // defaultRoot 动态补当前生效根（与 listWorkspaces 同口径：恒重新解析，绝不用
  // 磁盘陈旧快照）。磁盘 defaultRoot 只在 addWorkspace 时落盘一次快照，跨进程
  // 换项目 / YXSPEC_GIT_ROOT 变更后即陈旧——若「仅当磁盘缺省才重解析」，写操作
  // 会拿陈旧根比对 → 新的默认根 unknown-workspace，而 listWorkspaces 却显示正常
  // （前端看着默认工作区是活动的，fetch/pull/push 全失败）。
  {
    const gr = await resolveGitRoot()
    reg.defaultRoot = gr ? gr.root : null
  }
  let realRoot = null
  if (action !== 'clone' && action !== 'init') {
    if (typeof root !== 'string' || !root.trim()) {
      return { ok: false, error: 'bad-request', message: 'root 不能为空' }
    }
    const rootNorm = root.trim().replace(/\\/g, '/')
    if (!isWindowsAbsolute(rootNorm)) {
      return { ok: false, error: 'bad-request', message: 'root 必须为绝对路径（Windows 盘符开头）' }
    }
    if (rootNorm.split('/').includes('..')) {
      return { ok: false, error: 'bad-request', message: 'root 不能含 .. 路径段' }
    }
    const v = await verifyGitRepo(rootNorm)
    if (!v.root) return { ok: false, error: v.error, message: v.message }
    realRoot = v.root
  } else {
    // clone/init 的 root 只是「目标父目录」锚点（git clone 的 cwd / init 的 parent），
    // 本身无需已登记（头注释红线声明）；但仍是用户输入 → 同样过绝对路径/`..`
    // 校验，防弱化。
    const rootNorm = typeof root === 'string' ? root.trim().replace(/\\/g, '/') : ''
    if (!isWindowsAbsolute(rootNorm)) {
      return { ok: false, error: 'bad-request', message: 'root 必须为绝对路径（Windows 盘符开头）' }
    }
    if (rootNorm.split('/').includes('..')) {
      return { ok: false, error: 'bad-request', message: 'root 不能含 .. 路径段' }
    }
    realRoot = rootNorm
  }
  // 非 clone/init 才要求已登记工作区；clone/init 的目标目录由 isSafeTargetDir 单独立界
  // （clone 还有 url 过 isSafeGitUrl 双保险），锚点仅需绝对路径。
  const isRegistered =
    action === 'clone' ||
    action === 'init' ||
    reg.workspaces.some((w) => w.root === realRoot) ||
    (reg.defaultRoot && reg.defaultRoot === realRoot)
  if (!isRegistered) {
    return { ok: false, error: 'unknown-workspace', message: 'root 不是已登记的工作区' }
  }
  // 3) clone 特有校验（url + 目标目录），clone 的 root 参数只是「目标父目录」锚点
  if (action === 'clone') {
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    if (!isSafeGitUrl(url)) {
      return { ok: false, error: 'bad-request', message: 'clone url 非法（仅允许 https:// / git@ / ssh://，且不含 shell 元字符）' }
    }
    const dir = typeof args.dir === 'string' ? args.dir.trim().replace(/\\/g, '/') : ''
    if (!isSafeTargetDir(dir)) {
      return { ok: false, error: 'bad-request', message: 'clone 目标目录非法（需绝对路径、非盘符根、不含 ..）' }
    }
    const g = await runGit(['clone', url, dir], { cwd: realRoot })
    recordGitOp({ root: realRoot, action: 'clone', args: { url, dir }, ok: g.ok, stdout: g.stdout, error: g.error })
    if (!g.ok) return { ok: false, error: g.error, message: 'git clone 执行失败' }
    // clone 成功后自动登记新仓库进工作区列表
    const added = await addWorkspace({ root: dir })
    return { ok: true, root: dir, cloneDir: dir, registered: added.ok ? added.workspace ?? added.already : false }
  }
  // 3b) init 特有校验（dir 目标目录），init 的 root 只是「目标父目录」锚点。
  //     语义同 clone：本地在空目录里 git init 建新仓库 → 自动登记进工作区列表。
  if (action === 'init') {
    const dir = typeof args.dir === 'string' ? args.dir.trim().replace(/\\/g, '/') : ''
    if (!isSafeTargetDir(dir)) {
      return { ok: false, error: 'bad-request', message: 'init 目标目录非法（需绝对路径、非盘符根、不含 ..）' }
    }
    // 先确保目录存在（git init 在目录内创建 .git；空目录也允许——git init 自身会补）。
    // 目标路径被同名文件占用 / 目录不可写时 mkdirSync 抛 EEXIST/EACCES —— 必须兜住，
    // 否则逃出模块「任何失败返回 ok:false 不抛」的契约，网关全局 catch 会变成裸 500。
    try {
      mkdirSync(dir, { recursive: true })
    } catch (e) {
      return { ok: false, error: 'bad-request', message: `init 目标目录不可用：${String(e?.message ?? e)}` }
    }
    const g = await runGit(['init'], { cwd: dir })
    recordGitOp({ root: dir, action: 'init', args: {}, ok: g.ok, stdout: g.stdout, error: g.error })
    if (!g.ok) return { ok: false, error: g.error, message: 'git init 执行失败' }
    // init 后即 git 仓库 → 自动登记进工作区列表（verifyGitRepo 通过）
    const added = await addWorkspace({ root: dir })
    return { ok: true, root: dir, initDir: dir, registered: added.ok ? added.workspace ?? added.already : false }
  }
  // 4) checkout 特有校验（branch 非空、无空格、必须是可解析的 git 引用）
  if (action === 'checkout') {
    const branch = typeof args.branch === 'string' ? args.branch.trim() : ''
    if (!branch) return { ok: false, error: 'bad-request', message: 'checkout 需提供 branch' }
    if (/\s/.test(branch)) return { ok: false, error: 'bad-request', message: 'branch 不能含空格' }
    // branch 必须是可解析的 git 引用（分支/tag/commit hash）——否则 `git checkout <branch>`
    // 会按 pathspec 回退：`.`,/目录名（`git checkout .` 实测丢弃工作区改动）、glob 等
    // 名字能匹配文件路径就会走「还原路径」分支，破坏性覆盖未提交改动。
    // `git rev-parse --verify <branch>^{commit}` 只认引用解析，路径名一律失败 → 拒绝。
    const chk = await runGit(['rev-parse', '--verify', `${branch}^{commit}`], { cwd: realRoot })
    if (!chk.ok) {
      return { ok: false, error: 'bad-request', message: `checkout 的 branch 不是有效的分支/引用：${branch}` }
    }
    const g = await runGit(['checkout', branch], { cwd: realRoot })
    recordGitOp({ root: realRoot, action: 'checkout', args: { branch }, ok: g.ok, stdout: g.stdout, error: g.error })
    if (!g.ok) return { ok: false, error: g.error, message: 'git checkout 执行失败' }
    return { ok: true, stdout: g.stdout }
  }
  // 5) 其余写操作（fetch / pull / push）
  if (action === 'fetch') {
    // fetch 结果摘要：操作前后各记 HEAD..@{u} 的落后提交数 —— fetch 拉回了多少
    // 上游提交，前端 toast 直接可见（「落后 3 → 0，拉到 3 个新提交」）。
    // 缺上游（首次 push 前无 @{u}，rev-list 输出空）→ behind:null，前端不展示。
    // rev-list 失败不阻断 fetch 本身，仅摘要降级为 null。
    const before = await runGit(['rev-list', '--count', 'HEAD..@{u}'], { cwd: realRoot })
    const g = await runGit(['fetch', '--all', '--prune'], { cwd: realRoot })
    recordGitOp({ root: realRoot, action: 'fetch', args: {}, ok: g.ok, stdout: g.stdout, error: g.error })
    if (!g.ok) return { ok: false, error: g.error, message: 'git fetch 执行失败' }
    const after = await runGit(['rev-list', '--count', 'HEAD..@{u}'], { cwd: realRoot })
    return { ok: true, stdout: g.stdout, behind: fetchBehindSummary(before.stdout, after.stdout) }
  }
  if (action === 'pull') {
    // pull 结果统计：操作前记 HEAD 短哈希，成功后 diff 旧/新 HEAD 得文件改动统计
    // （--ff-only 语义下新 HEAD 是旧 HEAD 的后代，diff 单向即完整增量）。
    // rev-parse 失败（如无 HEAD）不阻断 pull 本身，仅 stats 降级为 null。
    const before = await runGit(['rev-parse', '--short', 'HEAD'], { cwd: realRoot })
    const g = await runGit(['pull', '--ff-only'], { cwd: realRoot })
    recordGitOp({ root: realRoot, action: 'pull', args: {}, ok: g.ok, stdout: g.stdout, error: g.error })
    if (!g.ok) return { ok: false, error: g.error, message: 'git pull 执行失败' }
    let stats = null
    if (before.ok && before.stdout.trim()) {
      const after = await runGit(['rev-parse', '--short', 'HEAD'], { cwd: realRoot })
      const from = before.stdout.trim()
      const to = after.ok && after.stdout.trim() ? after.stdout.trim() : null
      // from === to → 无新提交（已是最新）：返回 null，前端不展示「0 文件」的误导统计
      if (to && to !== from) {
        const numstat = await runGit(['diff', '--numstat', from, to], { cwd: realRoot })
        if (numstat.ok) stats = parseNumstat(numstat.stdout)
      }
    }
    return { ok: true, stdout: g.stdout, head: null, stats }
  }
  if (action === 'push') {
    const g = await runGit(['push'], { cwd: realRoot })
    recordGitOp({ root: realRoot, action: 'push', args: {}, ok: g.ok, stdout: g.stdout, error: g.error })
    if (!g.ok) return { ok: false, error: g.error, message: 'git push 执行失败' }
    // push 成功回显 `HEAD -> branch` 信息（git push 默认输出第一行即远端更新摘要）
    const line = (g.stdout || '').split('\n').find((l) => /HEAD\s*->/.test(l))
    return { ok: true, stdout: g.stdout, head: line || null }
  }
  // 6) branch -a：只读列表（不追加写审计）
  const g = await runGit(['branch', '-a'], { cwd: realRoot })
  if (!g.ok) return { ok: false, error: g.error, message: 'git branch 执行失败' }
  const branches = (g.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^\*\s*/, '').trim())
  return { ok: true, branches }
}

/**
 * clone url 白名单校验（纯函数）。
 * 规则：必须 https:// 或 git@ 或 ssh:// 开头；拒绝 file://、`-` 开头（避免当选项参数）、
 * 含空格、以及 `|` `;` `` ` `` `$` 等 shell 元字符（execFile 数组透传本不会解释，
 * 双保险防 URL 里混入注入式 payload；换行 `\n`/回车 `\r` 一并拒绝）。
 * @param {string} url
 * @returns {boolean}
 */
export function isSafeGitUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false
  const u = url.trim()
  if (u.length > 2000) return false
  if (!/^(https:\/\/|git@|ssh:\/\/)/.test(u)) return false
  if (/[|;`$&<>"'\s\r\n]/.test(u)) return false
  return true
}

/**
 * clone 目标目录校验（纯函数）。
 * 规则：Windows 绝对路径（盘符开头，正/反斜杠均可）→ 归一正斜杠后须非盘符根、
 * 不含 `..` 段；相对路径 / 空 / 非盘符绝对路径一律拒绝。
 * @param {string} dir
 * @returns {boolean}
 */
export function isSafeTargetDir(dir) {
  if (typeof dir !== 'string' || !dir.trim()) return false
  const d = dir.trim()
  if (!isWindowsAbsolute(d)) return false
  const norm = d.replace(/\\/g, '/')
  if (isWindowsDriveRoot(norm)) return false
  if (norm.split('/').includes('..')) return false
  return true
}
