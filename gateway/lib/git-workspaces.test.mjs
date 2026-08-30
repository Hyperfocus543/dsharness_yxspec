// git-workspaces.mjs 纯函数单测（Git 工作区注册表 + 写操作白名单）
// 运行：node --test gateway/lib/git-workspaces.test.mjs（任意 cwd）
// 覆盖：
//   - isSafeGitUrl：https:// / git@ / ssh:// 合法；file://、-u、url;rm、`cmd`、含空格 → false
//   - isSafeTargetDir：D:/Work/x 合法、D:\Work\x 归一合法、C:\ 盘符根 false、
//     D:/Work/../x false、相对路径 false、空 false
//   - gitOperate 未知 action → ok:false（error:'unknown-action'）
//   - gitOperate init：dir 非法（相对/盘符根/..）→ bad-request（校验先于 git），
//     init 不再返回 unknown-action
//   - canRemoveWorkspace：default/auto 拒绝，不存在 not-found，手动条放行
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

// 模块路径基于本文件位置解析（不再依赖 cwd——从仓库根或 gateway/ 下跑都正确）
const mod = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'git-workspaces.mjs')).href)
const { isSafeGitUrl, isSafeTargetDir, gitOperate, canRemoveWorkspace, parseNumstat, fetchBehindSummary, setActiveWorkspace, normalizeAuditEntry, listAuditLog, parseCloneProgressLine, listCloneProgress, cloneWithProgress, addWorkspace, listWorkspaces, parsePushSummary, checkoutSwitchSummary, parseBranchList } = mod

test('isSafeGitUrl：合法 URL 通过', () => {
  for (const url of [
    'https://github.com/foo/bar.git',
    'https://user:pass@github.com/a/b',
    'git@github.com:org/repo.git',
    'git@gitlab.example.com:g/r.git',
    'ssh://git@github.com/org/repo.git',
    'ssh://git@host:2222/org/repo.git',
    'https://github.com/org/repo',
    'https://host/中文仓库.git',
  ]) {
    assert.equal(isSafeGitUrl(url), true, `应合法: ${url}`)
  }
})

test('isSafeGitUrl：file://、- 开头、shell 元字符、含空格 → 拒绝', () => {
  for (const url of [
    'file:///etc/passwd', // 本地文件协议拒绝
    'file://C:/secret',
    '-u', // - 开头（可被当 git 选项参数）
    '-p master',
    'https://github.com/x;rm -rf /', // ; 命令分隔
    'https://github.com/x`cmd`', // 反引号命令替换
    'https://github.com/x$(whoami)', // $() 命令替换
    'https://github.com/x|sh', // | 管道
    'https://github.com/x > out', // 重定向
    'https://github.com/x &', // 后台
    'https://github.com/with space/repo', // 空格
    'git@github.com:org/repo with space',
    'http://insecure.example.com/x', // 非 https
    'ftp://example.com/x',
    'ssh:notslashed',
    'https://github.com/x\r\n', // 尾换行/回车（trim 吞尾后检查会漏网，先见真身再净化）
    'https://github.com/x\n',
    'git@github.com:org/repo\r',
    'https://github.com/\nby',
    'https://github.com/x\u0000y', // NUL 字节（Node child_process 对含 NUL 参数同步抛 ERR_INVALID_ARG_VALUE）
    '', // 空
    null,
    undefined,
    123,
    'https://' + 'a'.repeat(2000) + '.com/x', // 超长
  ]) {
    assert.equal(isSafeGitUrl(url), false, `应拒绝: ${JSON.stringify(url)}`)
  }
})

test('isSafeTargetDir：合法目标目录通过', () => {
  for (const dir of [
    'D:/Work/x',
    'D:/Work/rep-o_2',
    'C:/dev/foo',
    'D:/a/b/c',
    'E:/x', // 非盘符根、无 ..
  ]) {
    assert.equal(isSafeTargetDir(dir), true, `应合法: ${dir}`)
  }
})

test('isSafeTargetDir：盘符根、..、相对路径、空 → 拒绝', () => {
  for (const dir of [
    'C:\\', // 盘符根
    'D:/',
    'D:\\',
    'D://', // 重复分隔符盘符根（Windows 同样落在盘符根）
    'D:\\\\',
    'C://',
    'C:',
    'D:/Work/../x', // .. 逃逸
    'D:/../x',
    '../outside',
    'work/x', // 相对路径
    'x',
    '.',
    '..',
    '', // 空
    null,
    undefined,
    123,
    '/etc/passwd', // 非盘符绝对路径
  ]) {
    assert.equal(isSafeTargetDir(dir), false, `应拒绝: ${JSON.stringify(dir)}`)
  }
})

test('isSafeTargetDir：反斜杠归一为合法（D:\\Work\\x）', () => {
  assert.equal(isSafeTargetDir('D:\\Work\\x'), true)
  assert.equal(isSafeTargetDir('D:/Work\\x'), true)
})

test('gitOperate：未知 action → ok:false', async () => {
  const r = await gitOperate({ root: 'D:/Work/x', action: 'reset', args: {} })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'unknown-action')
})

test('gitOperate init：dir 校验先于 git（非法目录 → bad-request，不触碰 git）', async () => {
  // init 已进白名单：不再返回 unknown-action，而是进入 dir 校验。
  // 相对目录 → bad-request
  const relDir = await gitOperate({ root: 'D:/Work', action: 'init', args: { dir: 'work/y' } })
  assert.equal(relDir.ok, false)
  assert.equal(relDir.error, 'bad-request', 'init dir 相对路径应报 bad-request')

  // 盘符根 → bad-request
  const driveRoot = await gitOperate({ root: 'D:/Work', action: 'init', args: { dir: 'D:/' } })
  assert.equal(driveRoot.ok, false)
  assert.equal(driveRoot.error, 'bad-request', 'init dir 为盘符根应报 bad-request')

  // 重复分隔符盘符根（D:// 在 Windows 同样落在盘符根）→ bad-request
  const driveRootDup = await gitOperate({ root: 'D:/Work', action: 'init', args: { dir: 'D://' } })
  assert.equal(driveRootDup.ok, false)
  assert.equal(driveRootDup.error, 'bad-request', 'init dir 为重复分隔符盘符根应报 bad-request')

  // 含 .. 段 → bad-request
  const dotdot = await gitOperate({ root: 'D:/Work', action: 'init', args: { dir: 'D:/Work/../x' } })
  assert.equal(dotdot.ok, false)
  assert.equal(dotdot.error, 'bad-request', 'init dir 含 .. 应报 bad-request')

  // dir 缺省 / 空 → bad-request
  const missing = await gitOperate({ root: 'D:/Work', action: 'init', args: {} })
  assert.equal(missing.ok, false)
  assert.equal(missing.error, 'bad-request', 'init 缺 dir 应报 bad-request')

  // 目标路径被同名文件占用 → bad-request（mkdirSync 抛 EEXIST 必须兜住，不逃出 ok:false 契约）
  const occupied = mkdtempSync(join(tmpdir(), 'gw-init-occupied-'))
  const filePath = join(occupied, 'blocked')
  writeFileSync(filePath, 'not a dir')
  try {
    const r = await gitOperate({ root: 'D:/Work', action: 'init', args: { dir: filePath.replace(/\\/g, '/') } })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'bad-request', 'init 目标被文件占用应报 bad-request 而非抛异常')
  } finally {
    rmSync(occupied, { recursive: true, force: true })
  }
})

test('gitOperate init：审计 root 与登记/返回同口径（带尾斜杠 dir 剥尾记录）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-init-audit-'))
  const regPath = join(dir, 'registry.json')
  const auditPath = join(dir, 'audit.jsonl')
  writeFileSync(regPath, JSON.stringify({ version: 1, defaultRoot: null, activeId: null, workspaces: [] }))
  const prevWs = process.env.YXSPEC_GIT_WORKSPACES
  const prevAudit = process.env.YXSPEC_GIT_AUDIT
  process.env.YXSPEC_GIT_WORKSPACES = regPath
  process.env.YXSPEC_GIT_AUDIT = auditPath
  try {
    // 用户输入目标目录带尾斜杠（`D:/Work/x/` 常见形态）→ init 成功
    const target = (join(dir, 'x') + '/').replace(/\\/g, '/')
    const r = await gitOperate({ root: target, action: 'init', args: { dir: target } })
    assert.equal(r.ok, true, `init 应成功: ${JSON.stringify(r)}`)
    // 返回 root / 登记 root 恒剥尾（前端按 root 精确匹配激活）；rev-parse 返回规范长路径
    assert.equal(r.root.endsWith('/'), false, '返回 root 不应带尾斜杠')
    assert.equal(r.initDir, r.root, '返回 initDir 与 root 一致')
    // 审计 root 与登记/返回同口径（不再记录带尾斜杠的原值）
    const audit = readFileSync(auditPath, 'utf8').trim()
    const last = JSON.parse(audit.split('\n').pop())
    assert.equal(last.action, 'init')
    assert.equal(last.root, r.root, '审计 root 应与返回 root 一致（剥尾归一）')
    assert.equal(last.args.dir, target, '审计 args.dir 保留用户原始输入')
  } finally {
    if (prevWs === undefined) delete process.env.YXSPEC_GIT_WORKSPACES
    else process.env.YXSPEC_GIT_WORKSPACES = prevWs
    if (prevAudit === undefined) delete process.env.YXSPEC_GIT_AUDIT
    else process.env.YXSPEC_GIT_AUDIT = prevAudit
    rmSync(dir, { recursive: true, force: true })
  }
})

test('gitOperate clone：root 未登记不报 unknown-workspace（锚点例外），url/dir 校验先于 git', async () => {
  // clone 的 root 只是「目标父目录」锚点，本身无需已登记（头注释红线声明）。
  // 修复前：未登记 root → 先撞 isRegistered → unknown-workspace，url/dir 校验死代码；
  // 修复后：clone 跳过 isRegistered，url 非法 → bad-request（校验发生在 git 调用之前）。
  const badUrl = await gitOperate({ root: 'D:/Work/x', action: 'clone', args: { url: 'file:///etc/passwd', dir: 'D:/Work/y' } })
  assert.equal(badUrl.ok, false)
  assert.equal(badUrl.error, 'bad-request', 'clone url 非法应报 bad-request 而非 unknown-workspace')

  // 相对 root（clone 锚点也必须是绝对路径）→ bad-request，不触碰 git
  const relRoot = await gitOperate({ root: 'work/x', action: 'clone', args: { url: 'https://github.com/a/b.git', dir: 'D:/Work/y' } })
  assert.equal(relRoot.ok, false)
  assert.equal(relRoot.error, 'bad-request', 'clone root 相对路径应报 bad-request')

  // root 含 .. 段 → bad-request
  const dotdot = await gitOperate({ root: 'D:/Work/../x', action: 'clone', args: { url: 'https://github.com/a/b.git', dir: 'D:/Work/y' } })
  assert.equal(dotdot.ok, false)
  assert.equal(dotdot.error, 'bad-request', 'clone root 含 .. 应报 bad-request')

  // clone 锚点合法 + dir 非法（相对/盘符根）→ bad-request（dir 校验在 git 之前）
  const badDir = await gitOperate({ root: 'D:/Work', action: 'clone', args: { url: 'https://github.com/a/b.git', dir: 'work/y' } })
  assert.equal(badDir.ok, false)
  assert.equal(badDir.error, 'bad-request', 'clone dir 相对路径应报 bad-request')

  // 目标路径被同名文件占用 → bad-request（mkdirSync 抛 EEXIST 必须兜住，不逃出 ok:false 契约）。
  // 回归：修复前 clone 把 dir 当 execFile cwd，目标不存在时 spawn ENOENT → 整段 clone 恒失败
  //（首次克隆目标目录未创建是常态）；修复后先 mkdirSync 预创建，被文件占用则转 bad-request。
  const occupied = mkdtempSync(join(tmpdir(), 'gw-clone-occupied-'))
  const blockedFile = join(occupied, 'blocked')
  writeFileSync(blockedFile, 'not a dir')
  try {
    const r = await gitOperate({ root: 'D:/Work', action: 'clone', args: { url: 'https://github.com/a/b.git', dir: blockedFile.replace(/\\/g, '/') } })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'bad-request', 'clone 目标被文件占用应报 bad-request 而非抛异常')
  } finally {
    rmSync(occupied, { recursive: true, force: true })
  }
})

test('gitOperate checkout：branch 必须是可解析的 git 引用（. / 目录名 / glob → bad-request）', async () => {
  // 回归：旧实现只查「非空 + 无空格」，`git checkout .`（或目录名/glob 等 pathspec）
  // 会走「还原路径」分支，破坏性丢弃工作区未提交改动（实测 `git checkout .` 还原）。
  // 修复：branch 先用 `git rev-parse --verify <branch>^{commit}` 解析，非引用 → 拒绝。
  // 本测试跑在当前 git 仓库（branch 只读列表走默认根 = 本仓库），路径名/`.` 应全被拒。
  const root = process.cwd().replace(/\\/g, '/')

  // 审计隔离：成功 checkout 当前分支会 recordGitOp 追加审计 JSONL——本测试不设 env
  // 会写进真实 runtime-data/git-workspace-audit.jsonl（每次测试运行污染运行时数据，
  // 实测文件里堆积了数十条历史 checkout 留痕）。与文件内其他测试同口径：
  // YXSPEC_GIT_AUDIT 指向临时文件，跑完清理。auditFilePath() 恒按当前生效 env 解析，
  // 运行时设置立即生效，无需模块重载。
  const dir = mkdtempSync(join(tmpdir(), 'gw-checkout-audit-'))
  const prevAudit = process.env.YXSPEC_GIT_AUDIT
  process.env.YXSPEC_GIT_AUDIT = join(dir, 'audit.jsonl')
  try {
    // pathspec 形态：`.`（整树还原）、目录名、glob —— 均非有效引用 → bad-request
    for (const b of ['.', 'src', '*.js', '..']) {
      const r = await gitOperate({ root, action: 'checkout', args: { branch: b } })
      assert.equal(r.ok, false, `checkout branch=${JSON.stringify(b)} 应拒绝`)
      assert.equal(r.error, 'bad-request', `checkout branch=${JSON.stringify(b)} 应为 bad-request`)
    }

    // 空 / 含空格 → bad-request（既有校验不变）
    const empty = await gitOperate({ root, action: 'checkout', args: {} })
    assert.equal(empty.ok, false)
    assert.equal(empty.error, 'bad-request')
    const spaced = await gitOperate({ root, action: 'checkout', args: { branch: 'feat x' } })
    assert.equal(spaced.ok, false)
    assert.equal(spaced.error, 'bad-request')

    // 合法引用（当前分支）→ 通过校验并执行成功（分支列表只读，不出意外）
    const cur = await gitOperate({ root, action: 'branch' })
    assert.equal(cur.ok, true, 'branch 只读列表应成功')
    const curBranch = (cur.branches ?? []).find((b) => b !== '(HEAD detached)') ?? null
    if (curBranch) {
      const ok = await gitOperate({ root, action: 'checkout', args: { branch: curBranch } })
      assert.equal(ok.ok, true, `checkout 当前分支 ${curBranch} 应成功`)
    }
  } finally {
    if (prevAudit === undefined) delete process.env.YXSPEC_GIT_AUDIT
    else process.env.YXSPEC_GIT_AUDIT = prevAudit
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseNumstat：加删行 + 文件数', () => {
  assert.deepEqual(parseNumstat('1\t2\tREADME.md\n10\t0\tlib/a.mjs\n'), { files: 2, added: 11, removed: 2 })
})

test('parseNumstat：二进制 `-\t-` 行只计文件数不计行数', () => {
  assert.deepEqual(parseNumstat('-\t-\tassets/logo.png\n3\t1\tsrc/main.ts\n'), { files: 2, added: 3, removed: 1 })
})

test('parseNumstat：空输出 / 纯空白 → null', () => {
  assert.equal(parseNumstat(''), null)
  assert.equal(parseNumstat('   \n'), null)
  assert.equal(parseNumstat('\n\n'), null)
})

test('parseNumstat：含空格路径（TAB 分隔不受影响）', () => {
  const out = '2\t0\tdocs/my file.md\n'
  assert.deepEqual(parseNumstat(out), { files: 1, added: 2, removed: 0 })
})

test('parseNumstat：非字符串 → null', () => {
  assert.equal(parseNumstat(null), null)
  assert.equal(parseNumstat(undefined), null)
})

test('fetchBehindSummary：fetch 前后落后数 + 增量', () => {
  // git fetch 只推进远端跟踪分支（@{u}）不动 HEAD，落后数在 fetch 后上升：
  // 落后 0 → 3（delta = after - before = 3，拉到 3 个新提交）
  assert.deepEqual(fetchBehindSummary('0\n', '3\n'), { before: 0, after: 3, delta: 3 })
  // 落后 1 → 3（拉到 2 个）
  assert.deepEqual(fetchBehindSummary('1', '3'), { before: 1, after: 3, delta: 2 })
  // 无更新：落后数不变（delta 0）
  assert.deepEqual(fetchBehindSummary('0', '0'), { before: 0, after: 0, delta: 0 })
  // 落后 4 → 1（fetch 后落后反而变少——本地相对新远端只差 1，实际是本地 HEAD 之外
  // 的部分被 fetch 追赶上的极端情形；负数 = 落后数下降，不属于「拉到新提交」的常规语义）
  assert.deepEqual(fetchBehindSummary('4', '1'), { before: 4, after: 1, delta: -3 })
})

test('fetchBehindSummary：任一边缺上游 / 非数字 → null（前端不展示）', () => {
  // 首次 push 前无 @{u} → rev-list 输出空 → null
  assert.equal(fetchBehindSummary('', '0'), null)
  assert.equal(fetchBehindSummary(null, '0'), null)
  assert.equal(fetchBehindSummary('0', undefined), null)
  assert.equal(fetchBehindSummary('0', ''), null)
  // rev-list 失败（非数字输出 / 空）→ null
  assert.equal(fetchBehindSummary('error', '0'), null)
  assert.equal(fetchBehindSummary(null, null), null)
  assert.equal(fetchBehindSummary(undefined, undefined), null)
})

test('parsePushSummary：引用更新行 → commits + refs（与 fetch behind / pull stats 对齐的结果摘要）', () => {
  // 单分支更新（git push 典型 stdout：To 头 + `abc1234..def5678  main -> main`）
  assert.deepEqual(
    parsePushSummary('To github.com:org/repo.git\n   abc1234..def5678  main -> main\n'),
    { refs: ['main'], commits: 1, created: 0, upToDate: false },
  )
  // 多分支/多 tag 更新 → commits 累加、refs 去重收集
  assert.deepEqual(
    parsePushSummary('   a1b2c3d..e4f5a6b  main -> main\n   01234567..89abcdef  feat/x -> feat/x\n'),
    { refs: ['main', 'feat/x'], commits: 2, created: 0, upToDate: false },
  )
  // 新建分支 / 新建 tag（首次推送）→ created 计数 + refs
  assert.deepEqual(
    parsePushSummary('* [new branch]  feat -> feat\n* [new tag]     v1.0 -> v1.0\n'),
    { refs: ['feat', 'v1.0'], commits: 0, created: 2, upToDate: false },
  )
  // 混合：更新 + 新建
  assert.deepEqual(
    parsePushSummary('   abc1234..def5678  main -> main\n* [new branch]  feat -> feat\n'),
    { refs: ['main', 'feat'], commits: 1, created: 1, upToDate: false },
  )
  // 已是最新（无引用变更行）→ upToDate:true（前端据此展示「已是最新」）
  assert.deepEqual(
    parsePushSummary('Everything up-to-date\n'),
    { refs: [], commits: 0, created: 0, upToDate: true },
  )
})

test('parsePushSummary：空 / 非字符串 / 纯空白 → null（前端不展示误导摘要）', () => {
  assert.equal(parsePushSummary(''), null)
  assert.equal(parsePushSummary(null), null)
  assert.equal(parsePushSummary(undefined), null)
  assert.equal(parsePushSummary('   \n'), null)
  assert.equal(parsePushSummary('  '), null)
})

test('canRemoveWorkspace：default/auto 拒绝、不存在 not-found、手动放行', () => {
  assert.equal(canRemoveWorkspace('default', null).error, 'cannot-remove-default')
  assert.equal(canRemoveWorkspace('default', { id: 'default', source: 'auto' }).error, 'cannot-remove-default')
  assert.equal(canRemoveWorkspace('ws-1', { id: 'ws-1', source: 'auto' }).error, 'cannot-remove-default')
  assert.equal(canRemoveWorkspace('nope', undefined).error, 'not-found')
  assert.deepEqual(canRemoveWorkspace('ws-1', { id: 'ws-1', source: 'manual' }), { ok: true })
})

// 全新注册表（磁盘无 defaultRoot，未 addWorkspace）下，自动默认工作区的
// 「设为当前」也应可用 —— gitOperate 已动态补当前生效根，setActiveWorkspace
// 曾只读磁盘 defaultRoot 而恒 not-found。用临时注册表 + cwd 指向 git 仓库探测。
test('setActiveWorkspace：全新注册表（磁盘无 defaultRoot）id=default 可激活', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-setactive-'))
  const regPath = join(dir, 'registry.json')
  writeFileSync(regPath, JSON.stringify({ version: 1, defaultRoot: null, activeId: null, workspaces: [] }))
  const prevWs = process.env.YXSPEC_GIT_WORKSPACES
  const prevAudit = process.env.YXSPEC_GIT_AUDIT
  process.env.YXSPEC_GIT_WORKSPACES = regPath
  process.env.YXSPEC_GIT_AUDIT = join(dir, 'audit.jsonl')
  try {
    const r = await setActiveWorkspace({ id: 'default' })
    assert.equal(r.ok, true, `id=default 应可激活，实际: ${JSON.stringify(r)}`)
    assert.equal(r.activeId, 'default')
    assert.ok(Array.isArray(r.list))
  } finally {
    if (prevWs === undefined) delete process.env.YXSPEC_GIT_WORKSPACES
    else process.env.YXSPEC_GIT_WORKSPACES = prevWs
    if (prevAudit === undefined) delete process.env.YXSPEC_GIT_AUDIT
    else process.env.YXSPEC_GIT_AUDIT = prevAudit
    rmSync(dir, { recursive: true, force: true })
  }
})

test('normalizeAuditEntry：写操作审计行 → 展示字段（动作中文标签 + 成功/失败）', () => {
  // 标准成功行（recordGitOp 写入形态）
  assert.deepEqual(
    normalizeAuditEntry({
      at: 1725000000000,
      root: 'D:/Work/x',
      action: 'push',
      args: {},
      ok: true,
      stdout: 'To github.com:org/repo.git\n   abc1234..def5678  main -> main\n',
    }),
    {
      at: 1725000000000,
      action: 'push',
      actionLabel: '推送',
      ok: true,
      okLabel: '成功',
      root: 'D:/Work/x',
      args: {},
      stdout: 'To github.com:org/repo.git\n   abc1234..def5678  main -> main',
      error: null,
      stats: null,
      behind: null,
      summary: null,
      switchSummary: null,
    },
  )

  // 失败行：ok=false → 「失败」，error 透传，stdout 为空保留 null
  assert.deepEqual(
    normalizeAuditEntry({ at: 1725000001000, root: 'D:/Work/x', action: 'fetch', args: {}, ok: false, error: 'boom' }),
    { at: 1725000001000, action: 'fetch', actionLabel: '拉取远端', ok: false, okLabel: '失败', root: 'D:/Work/x', args: {}, stdout: null, error: 'boom', stats: null, behind: null, summary: null, switchSummary: null },
  )

  // clone / checkout / init / pull → 中文标签映射
  assert.equal(normalizeAuditEntry({ action: 'clone', ok: true }).actionLabel, '克隆')
  assert.equal(normalizeAuditEntry({ action: 'checkout', ok: true }).actionLabel, '切换分支')
  assert.equal(normalizeAuditEntry({ action: 'init', ok: true }).actionLabel, '新建仓库')
  assert.equal(normalizeAuditEntry({ action: 'pull', ok: true }).actionLabel, '同步远端')

  // 带字符串 args 的 checkout 行 → args 透传；空/非字符串值过滤
  assert.deepEqual(
    normalizeAuditEntry({ action: 'checkout', args: { branch: 'main', url: '' }, ok: true }).args,
    { branch: 'main' },
  )

  // 未知 action 原文；缺 ok → 「未确认」且 ok=false（前端按中性色展示）
  assert.equal(normalizeAuditEntry({ action: 'reset', ok: false }).actionLabel, 'reset')
  assert.equal(normalizeAuditEntry({ action: 'clone' }).okLabel, '未确认')
  assert.equal(normalizeAuditEntry({ action: 'clone' }).ok, false)
})

test('normalizeAuditEntry：宽容降级（缺字段 / 类型异常不抛）', () => {
  // null / undefined / 非对象 → 全默认展示字段
  assert.deepEqual(normalizeAuditEntry(null), { at: null, action: 'unknown', actionLabel: 'unknown', ok: false, okLabel: '未确认', root: null, args: {}, stdout: null, error: null, stats: null, behind: null, summary: null, switchSummary: null })
  assert.deepEqual(normalizeAuditEntry(undefined), normalizeAuditEntry(null))

  // 非数字 at → null；action 非字符串 → unknown
  assert.equal(normalizeAuditEntry({ at: 'yesterday' }).at, null)
  assert.equal(normalizeAuditEntry({ action: 42 }).actionLabel, 'unknown')

  // stdout / error 全空白 → null（前端不展示空行）
  assert.equal(normalizeAuditEntry({ stdout: '   \n' }).stdout, null)
  assert.equal(normalizeAuditEntry({ error: '   ' }).error, null)
})

test('normalizeAuditEntry：pull/fetch 结果摘要透传（stats / behind）', () => {
  // pull 成功行带 stats（recordGitOp 写入形态）
  assert.deepEqual(
    normalizeAuditEntry({
      at: 1725000000000,
      root: 'D:/Work/x',
      action: 'pull',
      args: {},
      ok: true,
      stats: { files: 3, added: 12, removed: 4 },
    }),
    {
      at: 1725000000000,
      action: 'pull',
      actionLabel: '同步远端',
      ok: true,
      okLabel: '成功',
      root: 'D:/Work/x',
      args: {},
      stdout: null,
      error: null,
      stats: { files: 3, added: 12, removed: 4 },
      behind: null,
      summary: null,
      switchSummary: null,
    },
  )

  // fetch 成功行带 behind（落后提交摘要）
  assert.deepEqual(
    normalizeAuditEntry({ at: 1725000000000, action: 'fetch', args: {}, ok: true, behind: { before: 0, after: 3, delta: 3 } }).behind,
    { before: 0, after: 3, delta: 3 },
  )

  // 老审计行（无 stats/behind/summary）→ 缺省 null，不回退成 {0,0,0} 误导
  assert.equal(normalizeAuditEntry({ action: 'push', ok: true }).stats, null)
  assert.equal(normalizeAuditEntry({ action: 'push', ok: true }).behind, null)
  assert.equal(normalizeAuditEntry({ action: 'push', ok: true }).summary, null)

  // 类型异常（字符串/数组/null）→ 宽容降级 null，不抛
  assert.equal(normalizeAuditEntry({ action: 'pull', stats: '3' }).stats, null)
  assert.equal(normalizeAuditEntry({ action: 'fetch', behind: [1, 2] }).behind, null)
  assert.equal(normalizeAuditEntry({ action: 'pull', stats: null }).stats, null)
  // 字段值非法（非数字）→ 兜底 0（不影响展示行形态稳定）
  assert.deepEqual(normalizeAuditEntry({ action: 'pull', stats: { files: 'x', added: 'y', removed: 'z' } }).stats, { files: 0, added: 0, removed: 0 })
})

test('normalizeAuditEntry：push 结果摘要透传（summary）', () => {
  // push 成功行带 summary（recordGitOp 写入形态）→ 透传 refs/commits/created/upToDate
  assert.deepEqual(
    normalizeAuditEntry({
      at: 1725000000000,
      root: 'D:/Work/x',
      action: 'push',
      args: {},
      ok: true,
      summary: { refs: ['main'], commits: 3, created: 1, upToDate: false },
    }).summary,
    { refs: ['main'], commits: 3, created: 1, upToDate: false },
  )
  // upToDate（无引用变更）→ 透传 true
  assert.deepEqual(
    normalizeAuditEntry({ action: 'push', ok: true, summary: { refs: [], commits: 0, created: 0, upToDate: true } }).summary,
    { refs: [], commits: 0, created: 0, upToDate: true },
  )
  // 老审计行无 summary / 非对象 → 缺省 null（前端不渲染，静默降级）
  assert.equal(normalizeAuditEntry({ action: 'push', ok: true }).summary, null)
  assert.equal(normalizeAuditEntry({ action: 'push', summary: 'x' }).summary, null)
  assert.equal(normalizeAuditEntry({ action: 'push', summary: [1, 2] }).summary, null)
  // 字段值非法（非数组/非数字）→ 宽容兜底（refs 滤非字符串、计数兜底 0），不抛
  assert.deepEqual(
    normalizeAuditEntry({ action: 'push', summary: { refs: ['main', 42], commits: 'x', created: null } }).summary,
    { refs: ['main'], commits: 0, created: 0, upToDate: false },
  )
})

test('checkoutSwitchSummary：分支切换前后名 + 游离态 + 有无变化', () => {
  // 常规切换 main → feat（前后 symbolic-ref 均解析成功）
  assert.deepEqual(checkoutSwitchSummary('main', 'feat'), {
    from: 'main',
    to: 'feat',
    detached: false,
    branchChanged: true,
  })
  // 切同分支（幂等）→ branchChanged false
  assert.deepEqual(checkoutSwitchSummary('main', 'main'), {
    from: 'main',
    to: 'main',
    detached: false,
    branchChanged: false,
  })
  // checkout 到 commit/tag → 游离 HEAD（after 为空 → to=null + detached）
  assert.deepEqual(checkoutSwitchSummary('main', ''), {
    from: 'main',
    to: null,
    detached: true,
    branchChanged: true,
  })
  assert.deepEqual(checkoutSwitchSummary('main', '  \n'), {
    from: 'main',
    to: null,
    detached: true,
    branchChanged: true,
  })
  // 从游离态 checkout 回分支（before 为空 → from=null，分支名变化）
  assert.deepEqual(checkoutSwitchSummary('', 'feat'), {
    from: null,
    to: 'feat',
    detached: false,
    branchChanged: true,
  })
  // 两态都 null（未知/空仓库）→ 无变化，不误报游离到分支
  assert.deepEqual(checkoutSwitchSummary(null, null), {
    from: null,
    to: null,
    detached: true,
    branchChanged: false,
  })
  assert.deepEqual(checkoutSwitchSummary(undefined, undefined), {
    from: null,
    to: null,
    detached: true,
    branchChanged: false,
  })
  // 空白输入归一 → null（stdout 为纯空白时 git 语义同空）
  assert.deepEqual(checkoutSwitchSummary('\n', '\n'), {
    from: null,
    to: null,
    detached: true,
    branchChanged: false,
  })
})

test('normalizeAuditEntry：checkout 分支切换摘要透传（switchSummary）', () => {
  // 成功切换行带 switchSummary（recordGitOp 写入形态）→ 透传 from/to/detached/branchChanged
  assert.deepEqual(
    normalizeAuditEntry({
      at: 1725000000000,
      root: 'D:/Work/x',
      action: 'checkout',
      args: { branch: 'feat' },
      ok: true,
      switchSummary: { from: 'main', to: 'feat', detached: false, branchChanged: true },
    }).switchSummary,
    { from: 'main', to: 'feat', detached: false, branchChanged: true },
  )
  // checkout 到 commit → 游离态透传（to=null + detached）
  assert.deepEqual(
    normalizeAuditEntry({
      action: 'checkout',
      ok: true,
      switchSummary: { from: 'main', to: null, detached: true, branchChanged: true },
    }).switchSummary,
    { from: 'main', to: null, detached: true, branchChanged: true },
  )
  // 老审计行无 switchSummary / 非对象 → 缺省 null（前端不渲染，静默降级）
  assert.equal(normalizeAuditEntry({ action: 'checkout', ok: true }).switchSummary, null)
  assert.equal(normalizeAuditEntry({ action: 'checkout', switchSummary: 'x' }).switchSummary, null)
  assert.equal(normalizeAuditEntry({ action: 'checkout', switchSummary: [1, 2] }).switchSummary, null)
  // 字段值非法（空字符串 from/to → 归一 null；布尔兜底 false）→ 宽容降级不抛
  assert.deepEqual(
    normalizeAuditEntry({ action: 'checkout', ok: true, switchSummary: { from: '', to: '', detached: true, branchChanged: true } }).switchSummary,
    { from: null, to: null, detached: true, branchChanged: true },
  )
})

test('normalizeAuditEntry：截断 stdout 追加省略号标记（存储值达上限即已截断）', () => {
  // recordGitOp 落盘时恒 `slice(0, AUDIT_STDOUT_MAX)`——存储值恰 4000 即代表「源输出更长，
  // 已被截断」，展示层必须追加 '…'，否则超长 stdout 显示成完整输出（误导回看）。
  const AUDIT_STDOUT_MAX = 4000
  const long = 'x'.repeat(AUDIT_STDOUT_MAX)
  const e = normalizeAuditEntry({ at: 1725000000000, root: 'D:/Work/x', action: 'push', args: {}, ok: true, stdout: long })
  assert.equal(e.stdout.length, AUDIT_STDOUT_MAX + 1, '截断行应保留上限长度 + 省略号')
  assert.ok(e.stdout.endsWith('…'), '截断行应带省略号标记')
  assert.equal(e.stdout.slice(0, AUDIT_STDOUT_MAX), long, '省略号前内容与存储值一致')

  // 超上限的原始输入（老审计行/异常形态）→ 同样收敛到 上限 + 省略号，不超长
  const over = 'y'.repeat(AUDIT_STDOUT_MAX + 100)
  const e2 = normalizeAuditEntry({ at: 1, action: 'pull', ok: true, args: {}, stdout: over })
  assert.equal(e2.stdout.length, AUDIT_STDOUT_MAX + 1, '超上限输入应收敛到 上限 + 省略号')

  // 未达上限的 stdout → 原样透传，不加省略号（展示行不误标已截断）
  const short = normalizeAuditEntry({ at: 2, action: 'fetch', ok: true, args: {}, stdout: 'a'.repeat(AUDIT_STDOUT_MAX - 1) })
  assert.equal(short.stdout, 'a'.repeat(AUDIT_STDOUT_MAX - 1), '未达上限不应追加省略号')

  // 尾随空白 + 存储值达上限：省略号判定按原始存储长度，不因 trim 变短漏标
  const padded = normalizeAuditEntry({ at: 3, action: 'push', ok: true, args: {}, stdout: 'x'.repeat(AUDIT_STDOUT_MAX - 2) + '\n\n' })
  assert.ok(padded.stdout.endsWith('…'), '存储值达上限但 trim 后变短也应标记已截断')
})

test('listAuditLog：截断 stdout 行展示含省略号（与 normalize 同口径）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-audit-trunc-'))
  const auditPath = join(dir, 'audit.jsonl')
  const prevAudit = process.env.YXSPEC_GIT_AUDIT
  process.env.YXSPEC_GIT_AUDIT = auditPath
  try {
    // recordGitOp 形态的落盘行：stdout 恰 4000（截断后的存储值）
    const AUDIT_STDOUT_MAX = 4000
    writeFileSync(
      auditPath,
      JSON.stringify({ at: 1725000000000, root: 'D:/Work/x', action: 'push', args: {}, ok: true, stdout: 'x'.repeat(AUDIT_STDOUT_MAX) }) + '\n',
      'utf8',
    )
    const r = listAuditLog({ limit: 5 })
    assert.equal(r.count, 1)
    assert.equal(r.entries[0].stdout.length, AUDIT_STDOUT_MAX + 1, '展示行应为 上限 + 省略号')
    assert.ok(r.entries[0].stdout.endsWith('…'), '落盘截断行展示应带省略号')
  } finally {
    if (prevAudit === undefined) delete process.env.YXSPEC_GIT_AUDIT
    else process.env.YXSPEC_GIT_AUDIT = prevAudit
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listAuditLog：读审计文件返回时间倒序（新→旧），limit 截断，缺文件空数组', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-audit-'))
  const auditPath = join(dir, 'audit.jsonl')
  const prevAudit = process.env.YXSPEC_GIT_AUDIT
  process.env.YXSPEC_GIT_AUDIT = auditPath
  try {
    // 缺文件 → 空数组（不抛）
    assert.deepEqual(listAuditLog({ limit: 5 }), { count: 0, entries: [] })

    // 写入两条 + 一条损坏行 + 一条空行 → 时间倒序、损坏行跳过
    writeFileSync(
      auditPath,
      [
        JSON.stringify({ at: 1725000000000, root: 'D:/Work/x', action: 'push', args: {}, ok: true }),
        'not-json{',
        '',
        JSON.stringify({ at: 1725000001000, root: 'D:/Work/y', action: 'fetch', args: {}, ok: false }),
      ].join('\n'),
      'utf8',
    )
    const r = listAuditLog({ limit: 10 })
    assert.equal(r.count, 2)
    assert.equal(r.entries[0].action, 'fetch') // 时间倒序：新（fetch，ok=false）在前
    assert.equal(r.entries[0].ok, false)
    assert.equal(r.entries[1].action, 'push')

    // limit 截断：只取最新 1 条
    const r1 = listAuditLog({ limit: 1 })
    assert.equal(r1.count, 1)
    assert.equal(r1.entries[0].action, 'fetch')

    // limit 非法值：负数钳到最小 1；NaN/Infinity → 回落默认 20
    assert.equal(listAuditLog({ limit: -5 }).count, 1)
    assert.equal(listAuditLog({ limit: Number('abc') }).count, 2)
    assert.equal(listAuditLog({ limit: Infinity }).count, 2)
  } finally {
    if (prevAudit === undefined) delete process.env.YXSPEC_GIT_AUDIT
    else process.env.YXSPEC_GIT_AUDIT = prevAudit
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseCloneProgressLine：Receiving objects / Resolving deltas 百分比', () => {
  // 收到对象：常见带速率后缀形态
  assert.deepEqual(parseCloneProgressLine('Receiving objects:  42% (1234/2938), 5.12 MiB | 3.45 MiB/s'), { kind: 'receiving', pct: 42 })
  // 解析增量
  assert.deepEqual(parseCloneProgressLine('Resolving deltas:  33% (3/9)'), { kind: 'deltas', pct: 33 })
  // 完成态（Receiving 100%）
  assert.deepEqual(parseCloneProgressLine('Receiving objects: 100% (2938/2938), 20.0 MiB | 5.0 MiB/s'), { kind: 'receiving', pct: 100 })
  // 行首空白容忍
  assert.deepEqual(parseCloneProgressLine('   Resolving deltas:  0% (0/1)'), { kind: 'deltas', pct: 0 })
  // 尾随 \r（git 进度行用 \r 原地刷新，chunk 切在行尾）
  assert.deepEqual(parseCloneProgressLine('Receiving objects:  5% (100/2000)\r'), { kind: 'receiving', pct: 5 })
})

test('parseCloneProgressLine：非进度行 / 损坏行 / 非字符串 → null', () => {
  // git 克隆的非进度 stderr 行
  for (const line of [
    '',
    'Cloning into \'D:/Work/x\'...',
    'remote: Enumerating objects: 100, done.',
    'remote: Counting objects: 100% (100/100), done.',
    'remote: Compressing objects: 100% (50/50), done.',
    'remote: Total 2938 (delta 9), reused 2938 (delta 9), pack-reused 2938',
    'Receiving objects: done.',
  ]) {
    assert.equal(parseCloneProgressLine(line), null, `应 null: ${JSON.stringify(line)}`)
  }
  // 非字符串（损坏 chunk）
  assert.equal(parseCloneProgressLine(null), null)
  assert.equal(parseCloneProgressLine(undefined), null)
  assert.equal(parseCloneProgressLine(42), null)
})

test('parseCloneProgressLine：非法百分比（<0 / >100 / 非数字）→ null，不误判完成', () => {
  assert.equal(parseCloneProgressLine('Receiving objects: 101% (100/100)'), null)
  assert.equal(parseCloneProgressLine('Receiving objects: -1% (0/100)'), null)
  assert.equal(parseCloneProgressLine('Receiving objects: abc% (0/100)'), null)
  assert.equal(parseCloneProgressLine('Receiving objects: 12.5% (0/100)'), null) // 非整数
})

test('listCloneProgress：无注册表 → 空数组；dir 精确匹配；返回快照不含 spawn 句柄', () => {
  // 全新模块状态（node --test 每次独立加载）→ 空数组
  assert.deepEqual(listCloneProgress(), [])
  assert.deepEqual(listCloneProgress({ dir: 'D:/Work/x' }), [])
  // 空 dir 等同全量（不抛）
  assert.deepEqual(listCloneProgress({ dir: '' }), [])
})

test('cloneWithProgress：spawn 版 clone 成功 → 进度注册表写终态（done/100），dir 精确可取', async () => {
  // 用本地 git 仓库验证 spawn 版生命周期（本地 clone 不走 pack 传输 → 无 Receiving
  // 进度行，但注册表仍应有 starting→done 状态机终态；HTTP/SSH 下进度行由
  // parseCloneProgressLine 单测覆盖）。isSafeGitUrl 拦截本地路径，故不绕 gitOperate，
  // 直接调 cloneWithProgress 验证采集链路本身。
  const dir = mkdtempSync(join(tmpdir(), 'gw-clone-progress-'))
  const remote = join(dir, 'remote.git')
  const work = join(dir, 'w')
  try {
    execFileSync('git', ['init', '-q', '--bare', remote], { cwd: dir })
    execFileSync('git', ['clone', '-q', remote, work], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: work })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: work })
    writeFileSync(join(work, 'a.txt'), 'x')
    execFileSync('git', ['add', '-A'], { cwd: work })
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: work })
    execFileSync('git', ['push', '-q', 'origin', 'HEAD'], { cwd: work })

    const target = join(dir, 'target').replace(/\\/g, '/')
    const g = await cloneWithProgress(['clone', '--progress', remote, target], { cwd: dir, key: target })
    assert.equal(g.ok, true, `clone 应成功: ${JSON.stringify(g)}`)
    // 注册表写入了该 key 的终态快照（dir 精确可取）
    const entries = listCloneProgress({ dir: target })
    assert.equal(entries.length, 1, '应恰好 1 条')
    assert.equal(entries[0].status, 'done', `状态应为 done，实际 ${entries[0].status}`)
    assert.equal(entries[0].pct, 100, `pct 应为 100，实际 ${entries[0].pct}`)
    assert.ok(Number.isFinite(entries[0].startedAt), 'startedAt 应为时间戳')
    // 全量兜底（无 dir）也应能取到
    assert.ok(listCloneProgress().some((e) => e.dir === target), '全量列表应含该条')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// 磁盘 defaultRoot 是 addWorkspace 时的陈旧快照；跨进程换项目 / YXSPEC_GIT_ROOT
// 变更后，gitOperate / setActiveWorkspace 必须按当前生效根重新解析，不能用陈旧快照
// 比对——否则 UI 显示默认工作区正常，但所有写操作 unknown-workspace、激活 not-found。
test('defaultRoot 恒按当前生效根解析：磁盘陈旧快照不阻断写操作/激活', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-stale-'))
  const regPath = join(dir, 'registry.json')
  writeFileSync(regPath, JSON.stringify({ version: 1, defaultRoot: 'D:/Work/01_Projects/OLD_PROJECT', activeId: null, workspaces: [] }))
  const prevWs = process.env.YXSPEC_GIT_WORKSPACES
  const prevAudit = process.env.YXSPEC_GIT_AUDIT
  process.env.YXSPEC_GIT_WORKSPACES = regPath
  process.env.YXSPEC_GIT_AUDIT = join(dir, 'audit.jsonl')
  try {
    // gitOperate：当前默认根（= 本仓库）可操作（branch 只读列表）
    const op = await gitOperate({ root: process.cwd(), action: 'branch' })
    assert.equal(op.ok, true, `当前默认根写操作应可用，实际: ${JSON.stringify(op)}`)
    // setActiveWorkspace：id=default 仍可激活（陈旧快照不阻断）
    const act = await setActiveWorkspace({ id: 'default' })
    assert.equal(act.ok, true, `陈旧 defaultRoot 下 id=default 应可激活，实际: ${JSON.stringify(act)}`)
  } finally {
    if (prevWs === undefined) delete process.env.YXSPEC_GIT_WORKSPACES
    else process.env.YXSPEC_GIT_WORKSPACES = prevWs
    if (prevAudit === undefined) delete process.env.YXSPEC_GIT_AUDIT
    else process.env.YXSPEC_GIT_AUDIT = prevAudit
    rmSync(dir, { recursive: true, force: true })
  }
})

// 回归：gitOperate clone 曾把原始 dir（可能带尾斜杠，如 `D:/Work/x/`）当进度注册表
// key；前端轮询 /api/git/clone-progress 前按 `replace(/[\\/]+$/, '')` 剥尾 → 精确匹配
// 恒落空，克隆进度条静默降级为纯秒表。修复后 gitOperate 以剥尾的 dir 为 key。
// 本测试验证「尾斜杠 dir + 剥尾 key」链路：clone 用带尾 dir 正常执行，前端口径 key 精确可取。
test('cloneWithProgress：key 用剥尾分隔符的 dir（前端轮询口径），带尾斜杠目标精确可取', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-clone-trailing-'))
  const remote = join(dir, 'remote.git')
  const work = join(dir, 'w')
  try {
    execFileSync('git', ['init', '-q', '--bare', remote], { cwd: dir })
    execFileSync('git', ['clone', '-q', remote, work], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: work })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: work })
    writeFileSync(join(work, 'a.txt'), 'x')
    execFileSync('git', ['add', '-A'], { cwd: work })
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: work })
    execFileSync('git', ['push', '-q', 'origin', 'HEAD'], { cwd: work })

    // 用户输入目标目录带尾斜杠（`D:/Work/x/` 常见形态）
    const target = (join(dir, 'target') + '/').replace(/\\/g, '/')
    const stripped = target.replace(/[\\/]+$/, '')
    // 与修复后 gitOperate 同口径：clone 命令用原始 dir（带尾斜杠），key 用剥尾 form
    const g = await cloneWithProgress(['clone', '--progress', remote, target], { cwd: dir, key: stripped })
    assert.equal(g.ok, true, `clone 应成功: ${JSON.stringify(g)}`)
    // 前端轮询口径（剥尾 key）精确可取；原始带尾 key 不匹配（不进注册表）
    const entries = listCloneProgress({ dir: stripped })
    assert.equal(entries.length, 1, '剥尾 key 应恰好 1 条')
    assert.equal(entries[0].status, 'done', `状态应为 done，实际 ${entries[0].status}`)
    assert.equal(entries[0].pct, 100, `pct 应为 100，实际 ${entries[0].pct}`)
    assert.equal(listCloneProgress({ dir: target }).length, 0, '带尾 key 不应匹配（注册表用剥尾 key）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// 回归：cloneWithProgress（spawn 版）曾无超时——远端无响应/凭据卡住的 clone 永不
// settle，HTTP 请求挂死、前端 operating 锁一直转秒表（execFile 版 runGit 的
// timeout: GIT_OP_TIMEOUT_MS 契约在进度采集重构里被弄丢）。修复后 spawn 版到点
// SIGKILL + 落失败终态（进度注册表 failed + error 含超时文案）。
test('cloneWithProgress：超时兜底——到点落失败终态（不挂起、不双 settle）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-clone-timeout-'))
  const remote = join(dir, 'remote.git')
  const work = join(dir, 'w')
  try {
    execFileSync('git', ['init', '-q', '--bare', remote], { cwd: dir })
    execFileSync('git', ['clone', '-q', remote, work], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: work })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: work })
    writeFileSync(join(work, 'a.txt'), 'x')
    execFileSync('git', ['add', '-A'], { cwd: work })
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: work })
    execFileSync('git', ['push', '-q', 'origin', 'HEAD'], { cwd: work })

    const target = join(dir, 'target').replace(/\\/g, '/')
    // timeoutMs=1：timer 下一 tick 即触发，本地 clone 远未完成 → 超时路径。
    // 断言 ok:false + 超时文案 + 进度注册表 failed 终态。
    const g = await cloneWithProgress(['clone', '--progress', remote, target], { cwd: dir, key: target, timeoutMs: 1 })
    assert.equal(g.ok, false, `超时应返回 ok:false: ${JSON.stringify(g)}`)
    assert.ok(g.error && g.error.includes('超时'), `error 应含超时文案: ${g.error}`)
    const entries = listCloneProgress({ dir: target })
    assert.equal(entries.length, 1, '进度注册表应恰好 1 条')
    assert.equal(entries[0].status, 'failed', `状态应为 failed，实际 ${entries[0].status}`)
    assert.ok(entries[0].error && entries[0].error.includes('超时'), `进度 error 应含超时文案: ${entries[0].error}`)
  } finally {
    // 被 SIGKILL 的 git 可能短暂残留子进程（git-upload-pack 等）握着目录句柄（Windows），
    // 立即 rmSync 偶发 EPERM——重试几次等句柄释放，不掩盖测试结论。
    for (let i = 0; i < 20; i++) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch {
        await new Promise((r) => setTimeout(r, 25))
      }
    }
  }
})

// 回归：addWorkspace 重复登记「当前生效根」。
// 修复前：default 条目只在 listWorkspaces 内存合并（磁盘不落），existing 查不到当前根
// → 重新 add 当前默认根会新建一条 manual ws-N，withDefaultRoot 见同 root 后抑制 auto 条目
// → 默认工作区从列表消失、activeId 回落 null（实测复现，_probe_dupadd）。修复后：
// 与 resolveGitRoot 当前生效根显式比对 → already:true 返回 default 条目，列表恒含 auto 默认。
test('addWorkspace：重复登记当前生效根 → already:true 返回 default 条目（不新建 manual 抑制 auto）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-dupadd-'))
  const regPath = join(dir, 'registry.json')
  writeFileSync(regPath, JSON.stringify({ version: 1, defaultRoot: null, activeId: null, workspaces: [] }))
  const prevWs = process.env.YXSPEC_GIT_WORKSPACES
  const prevAudit = process.env.YXSPEC_GIT_AUDIT
  process.env.YXSPEC_GIT_WORKSPACES = regPath
  process.env.YXSPEC_GIT_AUDIT = join(dir, 'audit.jsonl')
  try {
    const root = process.cwd().replace(/\\/g, '/')
    const r1 = await addWorkspace({ root })
    assert.equal(r1.ok, true, `add 当前默认根应成功: ${JSON.stringify(r1)}`)
    assert.equal(r1.already, true, `当前默认根应命中 already: ${JSON.stringify(r1)}`)
    assert.equal(r1.workspace?.id, 'default', `返回条目应为 default: ${JSON.stringify(r1.workspace)}`)
    assert.equal(r1.workspace?.source, 'auto')
    assert.ok(r1.list.some((w) => w.id === 'default' && w.source === 'auto'), '列表应含 auto 默认条目')

    // 磁盘注册表不被污染：不落 manual ws-N 条目
    const raw = JSON.parse(readFileSync(regPath, 'utf8'))
    assert.equal(raw.workspaces.length, 0, `磁盘注册表不应新增条目: ${JSON.stringify(raw.workspaces)}`)

    // 再次 add 同 root → 仍 already:true default
    const r2 = await addWorkspace({ root })
    assert.equal(r2.already, true)
    assert.equal(r2.workspace?.id, 'default')

    const list = await listWorkspaces()
    assert.equal(list.activeId, 'default', `activeId 应保持 default: ${JSON.stringify(list.activeId)}`)
    assert.ok(list.workspaces.some((w) => w.id === 'default' && w.source === 'auto'), '最终列表应含 auto 默认条目')
    assert.ok(!list.workspaces.some((w) => w.source === 'manual'), '最终列表不应含 manual 条目')
  } finally {
    if (prevWs === undefined) delete process.env.YXSPEC_GIT_WORKSPACES
    else process.env.YXSPEC_GIT_WORKSPACES = prevWs
    if (prevAudit === undefined) delete process.env.YXSPEC_GIT_AUDIT
    else process.env.YXSPEC_GIT_AUDIT = prevAudit
    rmSync(dir, { recursive: true, force: true })
  }
})

// 分支富格式列表（branch -a --format 输出 → 条目含上游/偏差）。格式：
//   %(HEAD)%09%(refname)%09%(upstream:short)%09%(upstream:track)
// 远端 refname 为 refs/remotes/<remote>/<rest>，本地为 refs/heads/<name>；
// 偏差括号 `[ahead N]` / `[behind M]` / `[ahead N, behind M]`；无上游/无偏差 → 空。
test('parseBranchList：本地分支 + 上游偏差（ahead / behind / 组合）', () => {
  const out = [
    '*\trefs/heads/main\torigin/main\t[ahead 2]',
    '\trefs/heads/topic\torigin/topic\t[ahead 1, behind 1]',
    '\trefs/heads/old\torigin/old\t[behind 3]',
    '\trefs/heads/local\t\t',
  ].join('\n')
  const rows = parseBranchList(out)
  assert.equal(rows.length, 4)
  // 当前分支：HEAD=* → current
  assert.deepEqual(rows[0], { name: 'main', remote: null, current: true, upstream: 'origin/main', ahead: 2, behind: 0 })
  // 组合偏差
  assert.deepEqual(rows[1], { name: 'topic', remote: null, current: false, upstream: 'origin/topic', ahead: 1, behind: 1 })
  // 仅落后
  assert.deepEqual(rows[2], { name: 'old', remote: null, current: false, upstream: 'origin/old', ahead: 0, behind: 3 })
  // 无上游 → upstream null + 偏差 0
  assert.deepEqual(rows[3], { name: 'local', remote: null, current: false, upstream: null, ahead: 0, behind: 0 })
})

test('parseBranchList：远端分支 → remotes/<remote>/<rest>（与旧 branch -a 逐字一致）+ remote 名', () => {
  const out = [
    '\trefs/remotes/origin/main\t\t',
    '\trefs/remotes/origin/feature/x\t\t',
    '\trefs/remotes/upstream/main\t\t',
  ].join('\n')
  const rows = parseBranchList(out)
  assert.deepEqual(rows, [
    { name: 'remotes/origin/main', remote: 'origin', current: false, upstream: null, ahead: 0, behind: 0 },
    { name: 'remotes/origin/feature/x', remote: 'origin', current: false, upstream: null, ahead: 0, behind: 0 },
    { name: 'remotes/upstream/main', remote: 'upstream', current: false, upstream: null, ahead: 0, behind: 0 },
  ])
})

test('parseBranchList：上游已删 [gone] → 偏差按 0（不误报）；空/非字符串 → []', () => {
  const gone = parseBranchList('\trefs/heads/x\torigin/x\t[gone]')
  assert.equal(gone[0].ahead, 0)
  assert.equal(gone[0].behind, 0)
  assert.equal(parseBranchList('').length, 0)
  assert.equal(parseBranchList('   \n').length, 0)
  assert.equal(parseBranchList(null).length, 0)
  assert.equal(parseBranchList(undefined).length, 0)
  // detached HEAD 行（refname 空）与 tags → 忽略
  const noise = parseBranchList('\trefs/heads/main\torigin/main\t\n\t\t\t\n\trefs/tags/v1\t\t\n')
  assert.equal(noise.length, 1)
  assert.equal(noise[0].name, 'main')
})
