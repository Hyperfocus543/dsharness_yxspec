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

test('canRemoveWorkspace：default/auto 拒绝、不存在 not-found、手动放行', () => {
  assert.equal(canRemoveWorkspace('default', null).error, 'cannot-remove-default')
  assert.equal(canRemoveWorkspace('default', { id: 'default', source: 'auto' }).error, 'cannot-remove-default')
  assert.equal(canRemoveWorkspace('ws-1', { id: 'ws-1', source: 'auto' }).error, 'cannot-remove-default')
  assert.equal(canRemoveWorkspace('nope', undefined).error, 'not-found')
  assert.deepEqual(canRemoveWorkspace('ws-1', { id: 'ws-1', source: 'manual' }), { ok: true })
})
