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
const { isSafeGitUrl, isSafeTargetDir, gitOperate, canRemoveWorkspace, parseNumstat, setActiveWorkspace } = mod

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
