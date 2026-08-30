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
//   默认 gateway/runtime-js/runtime-data/git-workspaces.json，可用 YXSPEC_GIT_WORKSPACES 覆盖
//   （registryFilePath() 恒按当前生效 env 解析，模块加载后设置也立即生效，测试隔离同款）。
//   每条 source：'auto'（当前生效根，由 resolveGitRoot 推导，id 恒 'default'）或
//   'manual'（addWorkspace 手动登记，id 为 ws-<n> 递增）。
// 审计文件（JSONL）：默认 gateway/runtime-js/runtime-data/git-workspace-audit.jsonl，
//   可用 YXSPEC_GIT_AUDIT 覆盖（auditFilePath() 同样恒按当前生效 env 解析）。
//   只追加不修改，失败仅 console.log 记录不抛。
//
// 红线：
//   - git 写操作仅限下方白名单；其余 action → { ok:false, error:'unknown-action' }
//   - 任何 git 失败 → { ok:false, error, message }（不抛异常，失败也记审计）
//   - clone 的 url / checkout 的 branch 不做 shell 拼接（execFile 数组透传），
//     但 url 仍过 isSafeGitUrl 白名单、dir 过 isSafeTargetDir，双保险防误用。
//   - clone/init 的 dir（目标目录）同过 isSafeTargetDir（Windows 绝对路径、非盘符
//     根、不含 ..），init 用前先 mkdirSync 确保目录存在，成功后自动 addWorkspace 登记。
// =============================================================================
import { execFile, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveGitRoot } from './git.mjs'

const REGISTRY_VERSION = 1
// 注册表文件缺省路径：gateway/runtime-js/runtime-data/git-workspaces.json
// 注意：注册表路径**恒按当前生效 env 解析**（registryFilePath()），不在模块加载时冻结——
// 与 auditFilePath() 同口径（见下）。env YXSPEC_GIT_WORKSPACES 可在模块加载后设置
// （测试隔离/换目录即生效），否则 readRegistry/writeRegistry 会永远落在模块加载时
// 捕获的陈旧路径：测试设了 env 却写进真实默认注册表（污染运行时数据），跨进程
// 换目录也拿不到新文件。
const DEFAULT_REGISTRY_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime-js', 'runtime-data', 'git-workspaces.json')
// 审计文件缺省路径：gateway/runtime-js/runtime-data/git-workspace-audit.jsonl
const DEFAULT_AUDIT_FILE =
  join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime-js', 'runtime-data', 'git-workspace-audit.jsonl')
const GIT_OP_TIMEOUT_MS = Number(process.env.YXSPEC_GIT_OP_TIMEOUT_MS ?? 120000)
// 单独一条审计 JSONL 的截断上限（避免恶意/异常 stdout 撑爆审计文件；只截断记录不截断执行）
const AUDIT_STDOUT_MAX = 4000

/** 注册表文件路径：恒按当前生效 env 解析（改 YXSPEC_GIT_WORKSPACES 后读写两侧立刻指向
 *  新文件，测试/换目录即生效）。缺省回退模块默认路径。 */
function registryFilePath() {
  return process.env.YXSPEC_GIT_WORKSPACES || DEFAULT_REGISTRY_FILE
}

/** 审计文件路径：恒按当前生效 env 解析（与 registryFilePath 同口径——磁盘/模块常量的
 *  陈旧快照不阻断；改 YXSPEC_GIT_AUDIT 后读写两侧立刻指向新文件，测试/换目录即生效）。
 *  缺省回退模块默认路径。 */
function auditFilePath() {
  return process.env.YXSPEC_GIT_AUDIT || DEFAULT_AUDIT_FILE
}

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

/** 剥离路径尾部分隔符（`D:/Work/x/` → `D:/Work/x`；不含分隔符则原样返回）。
 *  git rev-parse --show-toplevel 输出的真根恒无尾分隔符，而请求方传入的目标目录
 *  （args.dir）可能带尾斜杠——clone/init 返回的 root 必须与登记后的真实根逐字一致，
 *  否则前端按 root 精确匹配激活新仓库会落空（详见 clone/init 分支注释）。 */
function stripTrailingSep(p) {
  return String(p ?? '').replace(/[\\/]+$/, '')
}

/** 判断 dir 目录是否已存在且非空。非空目录 git clone 会 fatal
 *  （"already exists and is not an empty directory"），在 mkdirSync 预创建后转
 *  确定性 bad-request，避免把 git 的 raw fatal 直接抛给前端。
 *  @returns {{ exists: boolean, nonEmpty: boolean }} */
function targetDirState(dir) {
  try {
    const st = statSync(dir)
    if (!st.isDirectory()) return { exists: true, nonEmpty: true }
    let n = 0
    for (const _ of readdirSync(dir)) {
      if (++n > 0) break
    }
    return { exists: true, nonEmpty: n > 0 }
  } catch {
    return { exists: false, nonEmpty: false }
  }
}

/**
 * 工作区 id 推导。
 * source:'auto' → 恒 'default'；source:'manual' → 取最小未占用的 ws-<n> 递增。
 * @param {object} entry { source }
 * @param {string[]} existingIds 已占用 id（自动条目含 'default'）
 */
function workspaceIdFor({ source }, existingIds) {
  if (source === 'auto') return 'default'
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
    const file = auditFilePath()
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
  } catch (e) {
    console.log(`[gateway] git-workspaces 审计落盘失败: ${e?.message ?? e}`)
  }
}

/** 追加 git 写操作审计（照规范固定字段）。args 对象序列化前先截断 stdout。
 *  附带结果摘要（pull 的 stats / fetch 的 behind / push 的 summary / checkout 的
 *  switchSummary）：与操作返回体同源，写入审计行后可回看「那次 pull 到底改了几
 *  个文件、fetch 拉到几个提交、push 推了什么引用、checkout 从哪切到哪」，不再只
 *  有瞬时 toast。 */
function recordGitOp({ root, action, args, ok, stdout, error, stats, behind, summary, switchSummary }) {
  const rec = { at: Date.now(), root, action, args }
  if (ok === true) rec.ok = true
  else rec.ok = false
  if (stdout != null) rec.stdout = String(stdout).slice(0, AUDIT_STDOUT_MAX)
  if (error != null) rec.error = String(error)
  if (stats != null) rec.stats = stats
  if (behind != null) rec.behind = behind
  if (summary != null) rec.summary = summary
  if (switchSummary != null) rec.switchSummary = switchSummary
  appendAuditLine(rec)
}

/** 读注册表 JSON；文件缺失/损坏 → 返回空结构（不抛）。 */
function readRegistry() {
  const file = registryFilePath()
  let data = null
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
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
  const file = registryFilePath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(reg, null, 2) + '\n', 'utf8')
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
  // 当前生效根（resolveGitRoot 推导）只在 listWorkspaces 内存合并为 'default' 条目，
  // 磁盘注册表不落它 → 上面 existing 永远查不到。重新 add 当前默认根会新建一条 manual
  // ws-N 与 default 同 root，withDefaultRoot 见 existing.has(root) 后抑制 auto 条目
  // → 默认工作区从列表消失、activeId 回落 null（实测复现）。故与当前生效根显式比对：
  // 命中即视作已存在（登记粒度本就是仓库根，子目录 add 也会归一到同 root），返回内存
  // 合并后的 default 条目。归一正斜杠后逐字比较（rev-parse 输出分隔符平台不一）。
  const gr = await resolveGitRoot()
  const defaultRootNorm = gr && gr.root ? gr.root.replace(/\\/g, '/') : null
  if (defaultRootNorm && verified.root === defaultRootNorm) {
    const list = await listWorkspaces()
    const def = list.workspaces.find((w) => w.id === 'default' && w.source === 'auto')
    return {
      ok: true,
      already: true,
      workspace:
        def ?? { id: 'default', name: workspaceNameFor({ root: verified.root, source: 'auto' }), root: verified.root, source: 'auto' },
      list: list.workspaces,
    }
  }
  const entry = {
    id: workspaceIdFor({ root: verified.root, source: 'manual' }, reg.workspaces.map((w) => w.id).concat('default')),
    name: workspaceNameFor({ root: verified.root, source: 'manual' }),
    root: verified.root,
    source: 'manual',
  }
  // 落盘时补 defaultRoot（磁盘注册表首次写入时 default 根也持久化，
  // 否则 defaultRoot 恒 null，setActive/gitOperate 读盘拿不到 default）
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
 * 符号说明：`fetch` 只推进远端跟踪分支（@{u}）而不动本地 HEAD，落后数
 * （`HEAD..@{u}`）在 fetch 后是**上升**的（0 → N）——「拉到 N 个」对应
 * after - before = N（正）；远端无新提交时 after === before，delta 0。
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
 * 解析 `git push` 输出 → 推送摘要（纯函数，供 push 结果展示）。
 * 入参 = push 成功的 stdout（git push 默认输出；非字符串/空 → null 前端不展示）。
 * 识别两类「引用变更」行（其余行忽略）：
 *   · 更新行 `abc1234..def5678  main -> main`  → commits++（该远端引用有提交推上去）
 *   · 新建行 `* [new branch]  feat -> feat` / `* [new tag] v1.0 -> v1.0` → created++（首次推送）
 * 无任何引用变更（`Everything up-to-date` 等）→ { refs:[], commits:0, created:0, upToDate:true }，
 * 与 fetch behind / pull stats 的「无净改动 → 前端不展示误导摘要」语义对齐。
 * @param {string|null|undefined} stdout push 的 stdout（保留原始行，内部逐行 trim 解析）
 * @returns {{refs:string[], commits:number, created:number, upToDate:boolean} | null}
 */
export function parsePushSummary(stdout) {
  if (typeof stdout !== 'string' || !stdout.trim()) return null
  const refs = []
  let commits = 0
  let created = 0
  for (const line of stdout.split('\n')) {
    const l = line.trim()
    // 更新行：`0a2b3c4..1d2e3f4  main -> main`（hash 4-40 位；远端引用取 `->` 右侧）
    const upd = /^[0-9a-fA-F]{4,40}\.\.[0-9a-fA-F]{4,40}\s+(.+?)\s*->\s*(.+)$/.exec(l)
    if (upd) {
      commits++
      const ref = upd[2].trim()
      if (ref && !refs.includes(ref)) refs.push(ref)
      continue
    }
    // 新建行：`* [new branch]  feat -> feat` / `* [new tag] v1.0 -> v1.0`
    const nw = /^\*\s*\[new (branch|tag)\]\s+(.+?)\s*->\s*(.+)$/.exec(l)
    if (nw) {
      created++
      const ref = nw[3].trim()
      if (ref && !refs.includes(ref)) refs.push(ref)
      continue
    }
    // 其余行（To <remote> 头 / Enumerating / Total / Everything up-to-date）→ 忽略
  }
  if (commits === 0 && created === 0) return { refs: [], commits: 0, created: 0, upToDate: true }
  return { refs, commits, created, upToDate: false }
}

/**
 * checkout 分支切换摘要（纯函数，供 checkout 结果展示 + 审计回看）。
 * 入参 = checkout 前后各一次 `git symbolic-ref --quiet --short HEAD` 的 stdout
 *   （before 为操作前分支名；after 为操作后分支名；游离 HEAD / 解析失败 → null）。
 * 返回 { from, to, detached, branchChanged }：
 *   · from/to       = 切换前后的分支名（null = 游离 HEAD / 解析失败）
 *   · detached      = 操作后处于游离 HEAD（checkout 到 commit/tag 而非分支）
 *   · branchChanged = 分支名有变化（含「游离 → 分支」与「分支 → 游离」，
 *                     空串归一 null 后比较；两态都 null 时按无变化处理）
 * 与 fetch behind / pull stats / push summary 同口径：让「那次 checkout 到底切了什么」
 * 在 toast 与审计留痕里可回看——旧实现只有「已切换到分支 X」，不知道从哪来的、
 * 切完是不是游离态。
 * @param {string|null|undefined} beforeOut checkout 前 symbolic-ref stdout
 * @param {string|null|undefined} afterOut checkout 后 symbolic-ref stdout
 * @returns {{from: string|null, to: string|null, detached: boolean, branchChanged: boolean}}
 */
export function checkoutSwitchSummary(beforeOut, afterOut) {
  const name = (s) => {
    if (typeof s !== 'string') return null
    const t = s.trim()
    return t ? t : null
  }
  const from = name(beforeOut)
  const to = name(afterOut)
  return {
    from,
    to,
    detached: to === null,
    branchChanged: (from ?? null) !== (to ?? null),
  }
}

/** 审计留痕展示动作 → 中文标签（listAuditLog 归一化用）。 */
const AUDIT_ACTION_LABEL = {
  clone: '克隆',
  fetch: '拉取远端',
  pull: '同步远端',
  push: '推送',
  checkout: '切换分支',
  init: '新建仓库',
}

// =============================================================================
// clone 进度反馈（Git 工作区管控卡「远程仓库」克隆的 live 进度条）
// 目的：大仓库 clone（30s~2min）期间前端只有盲等秒表，无法区分「还在跑」与
// 「卡死」——把 git clone 的 stderr 进度行（Receiving objects: NN%）透传成
// 可轮询的进度快照，前端 clone 表单实时渲染百分比。
// 实现：spawn（非 execFile）跑 `git clone --progress`，逐行解析 stderr（clone 进度
// 走 stderr；stdout 仅终态钩子）。进度注册表是纯内存 Map（clone 是短生命周期操作，
// 网关重启即失效可接受，前端捕获 404/空则静默降级为纯秒表）。只追加新条目，
// 不删除旧条目——浏览器/前端轮询时序可能与任务完成竞态，旧的已完成条目留着兜底。
// 红线：clone 进度只是「反馈增强」，不改变任何 git 语义与返回契约。
//   - 失败/超时 → ok:false（与 runGit 路径同契约，前端既有错误分支处理）
//   - 进度解析失败（无 Receiving 行，如服务器无统计）→ 条目仍在，只状态机驱动
//   - 内存注册表在并发 clone 下 key 冲突 → 后到者覆盖前者的条目（单网关串行跑 clone，
//     key 含 dir 已基本唯一；即使冲突也只是进度快照被覆盖，clone 本身互不影响）
// =============================================================================

/** 正在进行的 clone：key(=dir) → child；网关重启即随进程消失（clone 短生命周期，无需持久化）。 */
const cloneSpawns = new Map()

/** clone 进度快照注册表（append-only）：key → 进度对象（前端轮询 /api/git/clone-progress）。 */
const cloneProgress = new Map()

/** chunk 边界粘滞尾（stderr 数据块可能切半行，粘住下一块再整行解析）。 */
let stderrTail = ''

/** 进度轮询条数上限（防泄漏兜底；正常 clone 只会写 1 条/次） */
const CLONE_PROGRESS_MAX = 50

/** 进度快照累积字段上限（防止极端损坏行撑爆内存；只截断展示数据不截断解析） */
const CLONE_LINE_MAX = 500

/**
 * 解析单行 git clone --progress 的 stderr 进度行（纯函数，可单测）。
 * 兼容三种 Git 形态：
 *   `Receiving objects:  42% (1234/2938), 5.12 MiB | 3.45 MiB/s`   → 收到对象（%）
 *   `Resolving deltas:  33% (3/9)`                                 → 解析增量（%）
 *   `Receiving objects: 100% (2938/2938), 20.0 MiB | 5.0 MiB/s`    → 完成（状态机归终态）
 * 非进度行（remote: ... / Counting objects / 空行）→ null。
 * 合法百分比 0~100（解析 <0 或 >100 的损坏行 → 拒绝，避免状态机误判完成）。
 * @param {string} line
 * @returns {{kind:'receiving'|'deltas', pct:number} | null}
 */
export function parseCloneProgressLine(line) {
  if (typeof line !== 'string' || !line.trim()) return null
  const m = /^(Receiving objects|Resolving deltas):\s+(\d{1,3})%\s*\(\d+\/\d+\)/.exec(line.trim())
  if (!m) return null
  const pct = Number(m[2])
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) return null
  return { kind: m[1] === 'Receiving objects' ? 'receiving' : 'deltas', pct }
}

/**
 * spawn 版 `git clone --progress`：逐行解析 stderr 进度写入注册表。
 * 语义与 runGit 版完全一致（ok:true / ok:false + error），只是顺带采集进度。
 * 超时与 runGit 同契约（timeoutMs 缺省 GIT_OP_TIMEOUT_MS）：spawn 没有 execFile 的
 * 内置 timeout，远端无响应/凭据卡住的 clone 若一直挂着，HTTP 请求永不返回、前端
 * operating 锁一直转秒表——到点必须 SIGKILL 子进程落失败终态（契约：任何 git 失败
 * 返回 ok:false 不抛）。
 * @param {string[]} args `['clone', '--progress', url, dir]`（白名单校验已在 gitOperate 完成）
 * @param {{cwd: string, key: string, timeoutMs?: number}} opts cwd=已创建的目录；key=进度注册表键（gitOperate 传 dir）
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string, error?:string}>}
 */
export function cloneWithProgress(args, { cwd, key, timeoutMs = GIT_OP_TIMEOUT_MS }) {
  return new Promise((resolve_) => {
    let stdout = ''
    let stderr = ''
    // 终态只落一次：spawn 失败时 Node 会**双 fire**（实测 ENOENT 先 error 后 close），
    // 后到者必须被忽略——否则 close 会用通用「git clone 退出码 -4058」覆盖 error 的
    // 具体原因（git-not-installed），前端克隆失败进度条展示误导性文案，promise 也重复 settle。
    let settled = false
    const settle = (result) => {
      if (settled) return
      settled = true
      resolve_(result)
    }
    const prog = {
      dir: key,
      status: 'running',
      stage: 'starting',
      pct: null,
      startedAt: Date.now(),
      error: null,
    }
    cloneProgress.set(key, prog)
    const child = spawn('git', args, { cwd, encoding: 'utf8', windowsHide: true })
    cloneSpawns.set(key, child)
    // 超时兜底（与 runGit 的 execFile timeout 同契约）：远端无响应/凭据卡住的 clone
    // 到点必须落失败终态，否则 HTTP 请求永不返回、前端 operating 锁一直转秒表。
    // 先 settle 再 SIGKILL：kill 会触发 close（code=null），settle 已置位则 close
    // 只做收尾（删 cloneSpawns）不覆盖终态——错误信息保持清晰的超时文案。
    const timer = setTimeout(() => {
      // 已 settle（恰好在同一 tick 正常完成）→ 不再覆盖 done 进度终态
      if (settled) return
      const msg = `git clone 超时（${Math.round(timeoutMs / 1000)}s 未完成，已终止）`
      touch({ status: 'failed', error: msg })
      try { child.kill('SIGKILL') } catch {}
      settle({ ok: false, stdout, stderr, error: msg, code: 'ETIMEDOUT' })
    }, timeoutMs)
    timer.unref?.()
    const touch = (patch) => {
      const cur = cloneProgress.get(key)
      if (cur) cloneProgress.set(key, { ...cur, ...patch })
    }
    child.stdout?.on('data', (d) => { stdout += String(d ?? '') })
    child.stderr?.on('data', (d) => {
      const chunk = String(d ?? '')
      stderr += chunk
      // 逐行解析：进度行以 \r 原地刷新（非 TTY 也如此），chunk 边界可能切半行、
      // 也可能整段无 \n 只有 \r → 同时按 \n 与 \r 切行，粘滞尾再拼下一块。
      // 行超长截断防损坏行撑爆内存（只截断展示数据，不截断解析）。
      const lines = (stderrTail + chunk).split(/\r?\n|\r/)
      stderrTail = lines.pop() ?? ''
      for (const raw of lines) {
        if (stderr.length > CLONE_LINE_MAX) stderr = stderr.slice(-CLONE_LINE_MAX)
        const ln = raw.trim()
        const p = parseCloneProgressLine(ln)
        if (p) {
          if (p.kind === 'receiving') touch({ status: 'running', stage: 'receiving', pct: p.pct })
          else if (p.kind === 'deltas') touch({ status: 'running', stage: 'deltas', pct: p.pct })
        }
      }
    })
    child.on('error', (err) => {
      // spawn 失败（ENOENT：git 未装）→ 终态；进度条目同步标记，前端轮询拿得到原因
      clearTimeout(timer)
      const msg = err?.code === 'ENOENT' ? 'git-not-installed' : String(err?.message ?? err)
      touch({ status: 'failed', error: msg })
      cloneSpawns.delete(key)
      settle({ ok: false, stdout: '', stderr: '', error: msg, code: err?.code ?? null })
    })
    child.on('close', (code) => {
      cloneSpawns.delete(key)
      clearTimeout(timer)
      // 双 fire 场景（error 已 settle）：close 只是收尾信号，不再 touch 进度——
      // 否则会把 error 分支写下的具体原因（git-not-installed）覆盖成通用退出码文案。
      if (settled) return
      if (code === 0) {
        touch({ status: 'done', stage: 'done', pct: 100 })
        settle({ ok: true, stdout: stdout ?? '', stderr: stderr ?? '' })
      } else {
        const msg = (stderr ?? '').trim() || `git clone 退出码 ${code}`
        touch({ status: 'failed', error: msg })
        settle({ ok: false, stdout: stdout ?? '', stderr: stderr ?? '', error: msg })
      }
    })
  })
}

/**
 * 读取 clone 进度快照（GET /api/git/clone-progress 数据源；轮询式）。
 * - dir 缺省 → 返回全量（新→旧，上限 CLONE_PROGRESS_MAX）——前端「克隆中」首次
 *   轮询时不知道自己 clone 的 key，先拿最新一条（唯一在跑的克隆就是它）
 * - dir 指定 → 精确匹配；不存在 → []（前端静默降级为纯秒表）
 * - 快照只含可序列化字段（不含 spawn 句柄，不能跨进程序列化）
 * @param {{dir?: string}} [opts]
 * @returns {object[]} { dir, status, stage, pct, startedAt, error }
 */
export function listCloneProgress({ dir } = {}) {
  if (dir) {
    const p = cloneProgress.get(dir)
    return p ? [{ ...p }] : []
  }
  const out = []
  for (const [, p] of cloneProgress) out.push({ ...p })
  return out
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, CLONE_PROGRESS_MAX)
}

/**
 * 归一化单条 git 写操作审计留痕为前端展示行（纯函数，可单测）。
 * @param {object} e 审计 JSONL 原始行（recordGitOp 写入形态；类型不完整时宽容降级）
 * @returns {object} { at, action, actionLabel, ok, okLabel, root, args, stdout, error, stats, behind } 展示字段恒存在
 */
export function normalizeAuditEntry(e) {
  const rawAt = e && (e.at ?? e.ts)
  const t = typeof rawAt === 'number' && Number.isFinite(rawAt) ? rawAt : NaN
  const action = typeof e?.action === 'string' && e.action ? e.action : 'unknown'
  const ok = e?.ok === true
  const okLabel = e?.ok === true ? '成功' : e?.ok === false ? '失败' : '未确认'
  const root = typeof e?.root === 'string' && e.root ? e.root : null
  const args =
    e?.args && typeof e.args === 'object' && !Array.isArray(e.args)
      ? Object.fromEntries(Object.entries(e.args).filter(([, v]) => typeof v === 'string' && v.trim() !== ''))
      : {}
  const stdout = typeof e?.stdout === 'string' && e.stdout.trim() ? e.stdout.trim() : null
  const error = typeof e?.error === 'string' && e.error.trim() ? e.error.trim() : null
  // 结果摘要透传：pull 的文件改动统计 / fetch 的落后提交摘要（老审计行无此字段 → 缺省 null）
  const stats =
    e?.stats && typeof e.stats === 'object' && !Array.isArray(e.stats)
      ? { files: Number(e.stats.files) || 0, added: Number(e.stats.added) || 0, removed: Number(e.stats.removed) || 0 }
      : null
  const behind =
    e?.behind && typeof e.behind === 'object' && !Array.isArray(e.behind)
      ? { before: Number(e.behind.before) || 0, after: Number(e.behind.after) || 0, delta: Number(e.behind.delta) || 0 }
      : null
  // push 结果摘要透传（新网关审计行附带；老行/无引用变更 → null，行内不展示）
  const summary =
    e?.summary && typeof e.summary === 'object' && !Array.isArray(e.summary)
      ? {
          refs: Array.isArray(e.summary.refs) ? e.summary.refs.filter((r) => typeof r === 'string') : [],
          commits: Number(e.summary.commits) || 0,
          created: Number(e.summary.created) || 0,
          upToDate: e.summary.upToDate === true,
        }
      : null
  // checkout 分支切换摘要透传（新网关审计行附带；老行/解析失败 → null，行内不展示）
  const switchSummary =
    e?.switchSummary && typeof e.switchSummary === 'object' && !Array.isArray(e.switchSummary)
      ? {
          from: typeof e.switchSummary.from === 'string' && e.switchSummary.from ? e.switchSummary.from : null,
          to: typeof e.switchSummary.to === 'string' && e.switchSummary.to ? e.switchSummary.to : null,
          detached: e.switchSummary.detached === true,
          branchChanged: e.switchSummary.branchChanged === true,
        }
      : null
  return {
    at: Number.isFinite(t) ? t : null,
    action,
    actionLabel: AUDIT_ACTION_LABEL[action] ?? action,
    ok,
    okLabel,
    root,
    args,
    stdout,
    error,
    stats,
    behind,
    summary,
    switchSummary,
  }
}

/**
 * GET /api/git/audit 数据源：git 写操作审计留痕（git-workspace-audit.jsonl，时间倒序）。
 * 该 JSONL 在每次写操作（clone/fetch/pull/push/checkout/init）时由 recordGitOp 追加，
 * 本函数只读展示，绝不修改文件。缺文件 / 不可读 → 返回空数组（前端渲染空态）。
 * @param {{limit?: number}} [opts]
 * @returns {{count: number, entries: object[]}}
 */
export function listAuditLog({ limit = 20 } = {}) {
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 20
  const file = auditFilePath()
  if (!existsSync(file)) return { count: 0, entries: [] }
  let lines = []
  try {
    lines = readFileSync(file, 'utf8').split('\n')
  } catch {
    return { count: 0, entries: [] }
  }
  const entries = []
  for (let i = lines.length - 1; i >= 0 && entries.length < n; i--) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    try {
      const e = normalizeAuditEntry(JSON.parse(line))
      // 截断 stdout 省略行（`… 截断 N 字符`）：审计文件里是 recordGitOp 已截断的
      // stdout（AUDIT_STDOUT_MAX），展示用同样上限，防超大单行刷屏
      if (e.stdout && e.stdout.length > AUDIT_STDOUT_MAX) e.stdout = e.stdout.slice(0, AUDIT_STDOUT_MAX) + '…'
      entries.push(e)
    } catch {
      // 单行 JSON 损坏（理论上 appendFileSync 不会产生）→ 跳过，不阻断整列表
    }
  }
  return { count: entries.length, entries }
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
    // 先确保目标目录存在：git clone 的目标目录（dir）是即将创建/已存在的目录，
    // 而 execFile 的 cwd 必须是已存在目录——若目标目录尚不存在（首次克隆的常态），
    // spawn 会直接 ENOENT（实测 `git clone <url> <newdir>` cwd=不存在目录 → ENOENT，
    // 整段 clone 恒失败，前端「克隆完成」永远走不到）。先 mkdirSync 兜底（git 对
    // 已存在的空目录克隆同样成功，实测 .git 正常落盘）；目标路径被同名文件占用 /
    // 目录不可写时 mkdirSync 抛 EEXIST/EACCES —— 兜住转 bad-request，不逃出契约。
    try {
      mkdirSync(dir, { recursive: true })
    } catch (e) {
      return { ok: false, error: 'bad-request', message: `clone 目标目录不可用：${String(e?.message ?? e)}` }
    }
    // 非空目标目录 git clone 必 fatal（"destination path already exists and is not
    // an empty directory"）——mkdirSync 预创建后必然命中（预创建的是空目录，非空只能
    // 是用户输入本就指向已含内容的目录），在 git 调用前转确定性 bad-request，
    // 不把 git 的 raw fatal 当「git clone 执行失败」抛给前端。
    if (targetDirState(dir).nonEmpty) {
      return { ok: false, error: 'bad-request', message: 'clone 目标目录已存在且非空（git 无法克隆到非空目录），请更换目标目录' }
    }
    // clone 进度反馈：spawn 版（--progress + stderr 逐行解析 → 内存进度注册表）。
    // 契约与 runGit 版一致（成功 ok:true / 失败 ok:false + error），进度只作增强；
    // 前端「克隆中」轮询 /api/git/clone-progress 渲染百分比条（老网关/无注册表 → 纯秒表降级）。
    // 进度注册表 key 用剥尾分隔符的 dir（与前端轮询的归一 key 逐字一致——CloneProgressBar
    // 请求前 `.replace(/[\\/]+$/, '')`；若用带尾斜杠的原始 dir，用户输入 `D:/x/` 时精确
    // 匹配恒落空，进度条静默降级为纯秒表）。返回的 root/cloneDir 已走 stripTrailingSep，
    // 同一 key 语义下注册表记录与激活根一致。
    const g = await cloneWithProgress(['clone', '--progress', url, dir], { cwd: dir, key: stripTrailingSep(dir) })
    if (!g.ok) {
      // 失败：审计 root 记剥尾目标目录（git 可能未落盘/非仓库，无真根可取；前端
      // gitWorkspaceName 归一后仍可辨识末段目录名）
      recordGitOp({ root: stripTrailingSep(dir), action: 'clone', args: { url, dir }, ok: false, stdout: g.stdout, error: g.error })
      return { ok: false, error: g.error, message: 'git clone 执行失败' }
    }
    // clone 成功后自动登记新仓库进工作区列表
    const added = await addWorkspace({ root: dir })
    // 返回的 root/cloneDir 归一为真根（git rev-parse 输出）——与登记条 root 逐字一致，
    // 否则 dir 带尾分隔符（`D:/x/`）时前端 pickWorkspaceToActivate 按 root 精确匹配
    // 新仓库会落空（登记条无尾分隔符），激活失败停在旧默认工作区。
    const realCloneRoot = added.ok ? added.workspace?.root ?? stripTrailingSep(dir) : stripTrailingSep(dir)
    // 成功审计 root = 登记后真根（与返回/登记条目逐字一致，行内重试/展示才不漂移）
    recordGitOp({ root: realCloneRoot, action: 'clone', args: { url, dir }, ok: true, stdout: g.stdout, error: g.error })
    return { ok: true, root: realCloneRoot, cloneDir: realCloneRoot, registered: added.ok ? added.workspace ?? added.already : false }
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
    if (!g.ok) {
      // 失败：审计 root 记剥尾目标目录（无真根可取；前端归一后仍可辨识末段目录名）
      recordGitOp({ root: stripTrailingSep(dir), action: 'init', args: { dir }, ok: false, stdout: g.stdout, error: g.error })
      return { ok: false, error: g.error, message: 'git init 执行失败' }
    }
    // init 后即 git 仓库 → 自动登记进工作区列表（verifyGitRepo 通过）
    const added = await addWorkspace({ root: dir })
    // 返回的 root/initDir 归一为真根（git rev-parse 输出）——与登记条 root 逐字一致，
    // 否则 dir 带尾分隔符时前端按 root 精确匹配激活新仓库会落空（同 clone 分支）。
    const realInitRoot = added.ok ? added.workspace?.root ?? stripTrailingSep(dir) : stripTrailingSep(dir)
    // 成功审计 root = 登记后真根（与返回/登记条目逐字一致，行内重试/展示才不漂移）
    recordGitOp({ root: realInitRoot, action: 'init', args: { dir }, ok: true, stdout: g.stdout, error: g.error })
    return { ok: true, root: realInitRoot, initDir: realInitRoot, registered: added.ok ? added.workspace ?? added.already : false }
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
    // checkout 分支切换摘要：操作前后各记当前分支（symbolic-ref）。游离 HEAD /
    // 无 HEAD 时输出空 → null，摘要仍能表达「游离 → main」「main → 游离」。
    // symbolic-ref 失败不阻断 checkout 本身，仅摘要降级为 null。
    const before = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: realRoot })
    const g = await runGit(['checkout', branch], { cwd: realRoot })
    let switchSummary = null
    if (g.ok) {
      const after = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: realRoot })
      // 用 after 重算：checkout 到 commit/tag（游离）时 after 为空 → to=null 表达游离态
      switchSummary = checkoutSwitchSummary(before.stdout, after.stdout)
      recordGitOp({ root: realRoot, action: 'checkout', args: { branch }, ok: true, stdout: g.stdout, switchSummary })
    } else {
      recordGitOp({ root: realRoot, action: 'checkout', args: { branch }, ok: false, stdout: g.stdout, error: g.error })
    }
    if (!g.ok) return { ok: false, error: g.error, message: 'git checkout 执行失败' }
    return { ok: true, stdout: g.stdout, switchSummary }
  }
  // 5) 其余写操作（fetch / pull / push）
  if (action === 'fetch') {
    // fetch 结果摘要：操作前后各记 HEAD..@{u} 的落后提交数 —— fetch 拉回了多少
    // 上游提交，前端 toast 直接可见（「落后 3 → 0，拉到 3 个新提交」）。
    // 缺上游（首次 push 前无 @{u}，rev-list 输出空）→ behind:null，前端不展示。
    // rev-list 失败不阻断 fetch 本身，仅摘要降级为 null。
    const before = await runGit(['rev-list', '--count', 'HEAD..@{u}'], { cwd: realRoot })
    const g = await runGit(['fetch', '--all', '--prune'], { cwd: realRoot })
    if (!g.ok) {
      recordGitOp({ root: realRoot, action: 'fetch', args: {}, ok: false, stdout: g.stdout, error: g.error })
      return { ok: false, error: g.error, message: 'git fetch 执行失败' }
    }
    const after = await runGit(['rev-list', '--count', 'HEAD..@{u}'], { cwd: realRoot })
    const behind = fetchBehindSummary(before.stdout, after.stdout)
    // 审计行附带最终落后摘要（缺上游/失败 → null，前端不展示）
    recordGitOp({ root: realRoot, action: 'fetch', args: {}, ok: true, stdout: g.stdout, behind })
    return { ok: true, stdout: g.stdout, behind }
  }
  if (action === 'pull') {
    // pull 结果统计：操作前记 HEAD 短哈希，成功后 diff 旧/新 HEAD 得文件改动统计
    // （--ff-only 语义下新 HEAD 是旧 HEAD 的后代，diff 单向即完整增量）。
    // rev-parse 失败（如无 HEAD）不阻断 pull 本身，仅 stats 降级为 null。
    const before = await runGit(['rev-parse', '--short', 'HEAD'], { cwd: realRoot })
    const g = await runGit(['pull', '--ff-only'], { cwd: realRoot })
    let stats = null
    if (g.ok) {
      // 成功才计算统计（失败行只留 error；避免拉取失败时 stats 挂 null 误导）
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
      // 成功路径：recordGitOp 附带最终 stats（老实现只把统计放进瞬时返回体，
      // 审计行看不到 —— pull 改了几个文件，留痕里现在也能回看）
      recordGitOp({ root: realRoot, action: 'pull', args: {}, ok: true, stdout: g.stdout, stats })
    } else {
      recordGitOp({ root: realRoot, action: 'pull', args: {}, ok: false, stdout: g.stdout, error: g.error })
    }
    if (!g.ok) return { ok: false, error: g.error, message: 'git pull 执行失败' }
    return { ok: true, stdout: g.stdout, head: null, stats }
  }
  if (action === 'push') {
    const g = await runGit(['push'], { cwd: realRoot })
    // push 结果摘要（对齐 fetch behind / pull stats 的「写操作结果可回看」语义）：
    // 成功时解析 stdout 的引用变更行（`abc..def main -> main` / `[new branch]`），
    // 失败时 summary 保持 null —— 与 pull stats 同口径，失败行只留 error，不误导。
    // 空 stdout → null（前端不展示）；无引用变更（Everything up-to-date）→
    // summary 带 upToDate:true，前端据此展示「已是最新」而非「0 提交」。
    const summary = g.ok ? parsePushSummary(g.stdout) : null
    recordGitOp({ root: realRoot, action: 'push', args: {}, ok: g.ok, stdout: g.stdout, error: g.error, summary })
    if (!g.ok) return { ok: false, error: g.error, message: 'git push 执行失败' }
    // 兼容透传：旧前端仍读 head 字段（git push 默认输出第一行即远端更新摘要行）
    const line = (g.stdout || '').split('\n').find((l) => /HEAD\s*->/.test(l))
    return { ok: true, stdout: g.stdout, head: line || null, summary }
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
 * 双保险防 URL 里混入注入式 payload；换行 `\n`/回车 `\r`/NUL 一并拒绝）。
 * @param {string} url
 * @returns {boolean}
 */
export function isSafeGitUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false
  // 换行/回车/NUL 在任何位置都拒绝——trim() 会吞掉首尾的 \r\n，若只在 trim 后检查则
  // `https://x/y\r\n` 这类带尾换行的 url 会漏网（净化为干净 url 前必须见真身）。
  // NUL（\u0000）不在 \s 类里（`/\s/.test('\u0000')` === false），但 Node child_process
  // 对含 NUL 的参数同步抛 ERR_INVALID_ARG_VALUE（实测 execFile/spawn 均如此）——若放行，
  // cloneWithProgress 的 spawn 会在 Promise executor 内同步 throw → gitOperate 抛异常
  // 逃出「任何 git 失败 → ok:false 不抛」契约 → 网关 500，故须显式拒绝。
  if (/[\r\n\u0000]/.test(url)) return false
  const u = url.trim()
  if (u.length > 2000) return false
  if (!/^(https:\/\/|git@|ssh:\/\/)/.test(u)) return false
  if (/[|;`$&<>"'\s]/.test(u)) return false
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
