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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

// 模块路径基于本文件位置解析（不再依赖 cwd——从仓库根或 gateway/ 下跑都正确）
const mod = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'git-workspaces.mjs')).href)
const { isSafeGitUrl, isSafeTargetDir, gitOperate, canRemoveWorkspace, parseNumstat, fetchBehindSummary, setActiveWorkspace, normalizeAuditEntry, listAuditLog } = mod

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
    },
  )

  // 失败行：ok=false → 「失败」，error 透传，stdout 为空保留 null
  assert.deepEqual(
    normalizeAuditEntry({ at: 1725000001000, root: 'D:/Work/x', action: 'fetch', args: {}, ok: false, error: 'boom' }),
    { at: 1725000001000, action: 'fetch', actionLabel: '拉取远端', ok: false, okLabel: '失败', root: 'D:/Work/x', args: {}, stdout: null, error: 'boom', stats: null, behind: null },
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
  assert.deepEqual(normalizeAuditEntry(null), { at: null, action: 'unknown', actionLabel: 'unknown', ok: false, okLabel: '未确认', root: null, args: {}, stdout: null, error: null, stats: null, behind: null })
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
    },
  )

  // fetch 成功行带 behind（落后提交摘要）
  assert.deepEqual(
    normalizeAuditEntry({ at: 1725000000000, action: 'fetch', args: {}, ok: true, behind: { before: 0, after: 3, delta: 3 } }).behind,
    { before: 0, after: 3, delta: 3 },
  )

  // 老审计行（无 stats/behind）→ 缺省 null，不回退成 {0,0,0} 误导
  assert.equal(normalizeAuditEntry({ action: 'push', ok: true }).stats, null)
  assert.equal(normalizeAuditEntry({ action: 'push', ok: true }).behind, null)

  // 类型异常（字符串/数组/null）→ 宽容降级 null，不抛
  assert.equal(normalizeAuditEntry({ action: 'pull', stats: '3' }).stats, null)
  assert.equal(normalizeAuditEntry({ action: 'fetch', behind: [1, 2] }).behind, null)
  assert.equal(normalizeAuditEntry({ action: 'pull', stats: null }).stats, null)
  // 字段值非法（非数字）→ 兜底 0（不影响展示行形态稳定）
  assert.deepEqual(normalizeAuditEntry({ action: 'pull', stats: { files: 'x', added: 'y', removed: 'z' } }).stats, { files: 0, added: 0, removed: 0 })
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
