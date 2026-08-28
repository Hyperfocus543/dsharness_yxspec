const mod = await import('./runtime-js/vendor/yxspec-tool-guard/index.js')
const { gitGuardDeny } = mod

const cases = [
  // 只读 branch 变体
  ['git branch', 'branch 列出', false],
  ['git branch -l', 'branch -l 列出', false],
  ['git branch --list', 'branch --list 列出', false],
  ['git branch --list feature/*', 'branch --list pattern 列出', false],
  ['git branch -a', 'branch -a 列出所有（含远端）', false],
  ['git branch --all', 'branch --all 列出所有', false],
  ['git branch -r', 'branch -r 列出远端', false],
  ['git branch --remotes', 'branch --remotes 列出远端', false],
  ['git branch --merged main', 'branch --merged 只读', false],
  ['git branch -v', 'branch -v 列出+上游', false],
  // 破坏性 branch 变体
  ['git branch -d foo', 'branch -d 删除', true],
  ['git branch -D foo', 'branch -D 强删', true],
  ['git branch -m old new', 'branch -m 重命名', true],
  ['git branch -M old new', 'branch -M 强重命名', true],
  ['git branch -u origin/main', 'branch -u 设上游', true],
  ['git branch --set-upstream-to=origin/main', 'branch --set-upstream-to', true],
  ['git branch -f foo', 'branch -f 强覆盖', true],
  ['git branch --force foo', 'branch --force', true],
  // 只读 tag
  ['git tag', 'tag 列出', false],
  ['git tag -l', 'tag -l', false],
  ['git tag --list v1.*', 'tag --list pattern', false],
  ['git tag -l "v1.*"', 'tag -l 引号 pattern', false],
  // 破坏性 tag
  ['git tag v1.0', 'tag 打标签', true],
  ['git tag -d v1.0', 'tag -d 删除', true],
  ['git tag -a v1.0 -m msg', 'tag -a 注解', true],
  // 只读 remote
  ['git remote', 'remote 列出', false],
  ['git remote -v', 'remote -v', false],
  ['git remote show origin', 'remote show', false],
  ['git remote get-url origin', 'remote get-url', true], // get-url 默认拒绝（非白名单）——保守策略
  // 破坏性 remote
  ['git remote add origin git@x:y.git', 'remote add', true],
  ['git remote remove origin', 'remote remove', true],
  ['git remote set-url origin x', 'remote set-url', true],
]
let pass = 0, fail = 0
for (const [cmd, label, expectDeny] of cases) {
  const got = !!gitGuardDeny(cmd)
  const ok = got === expectDeny
  if (ok) pass++; else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${label}] deny=${got ? 'YES' : 'no'} (expect ${expectDeny ? 'YES' : 'no'})`)
}
console.log(`\n${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
