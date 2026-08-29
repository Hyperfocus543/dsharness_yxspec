// git-workspaces.mjs 纯函数单测（Git 工作区注册表 + 写操作白名单）
// 运行：cd gateway && node --test lib/git-workspaces.test.mjs
// 覆盖：
//   - isSafeGitUrl：https:// / git@ / ssh:// 合法；file://、-u、url;rm、`cmd`、含空格 → false
//   - isSafeTargetDir：D:/Work/x 合法、D:\Work\x 归一合法、C:\ 盘符根 false、
//     D:/Work/../x false、相对路径 false、空 false
//   - gitOperate 未知 action → ok:false（error:'unknown-action'）
//   - canRemoveWorkspace：default/auto 拒绝，不存在 not-found，手动条放行
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const mod = await import(pathToFileURL(join(process.cwd(), 'lib', 'git-workspaces.mjs')).href)
const { isSafeGitUrl, isSafeTargetDir, gitOperate, canRemoveWorkspace } = mod

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

test('canRemoveWorkspace：default/auto 拒绝、不存在 not-found、手动放行', () => {
  assert.equal(canRemoveWorkspace('default', null).error, 'cannot-remove-default')
  assert.equal(canRemoveWorkspace('default', { id: 'default', source: 'auto' }).error, 'cannot-remove-default')
  assert.equal(canRemoveWorkspace('ws-1', { id: 'ws-1', source: 'auto' }).error, 'cannot-remove-default')
  assert.equal(canRemoveWorkspace('nope', undefined).error, 'not-found')
  assert.deepEqual(canRemoveWorkspace('ws-1', { id: 'ws-1', source: 'manual' }), { ok: true })
})
