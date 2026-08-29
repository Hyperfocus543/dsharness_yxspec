// yxspec-tool-guard git 命令级守卫单测（正则健壮性：漏网/误伤回归）
// 运行：cd gateway && node test/tool-guard.test.mjs
// 覆盖：
//   - 只读 git 子命令放行（status/diff/log/rev-parse/for-each-ref/tag -l/branch 只读）
//   - 破坏性 git 子命令拒绝（push/reset/clean/checkout -f/rm -rf/branch -D/tag/remote add）
//   - shell 执行包装器解引用（2026-08 修复）：`sh -c "git reset --hard"` /
//       `cmd /c "git clean -fd"` / `powershell -Command "git checkout -f main"` 此前
//       git 词落在引号内被裸分支引号过滤当文本放过，整段漏过守卫 → 现须 DENY
//   - 包装器内复合命令/嵌套壳（递归扫描逐层解包）
//   - 惰性文本（echo "git status"）不误伤
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const mod = await import(
  pathToFileURL(join(process.cwd(), 'runtime-js', 'vendor', 'yxspec-tool-guard', 'index.js')).href
)
const { gitGuardDeny } = mod

let pass = 0
let fail = 0
const assert = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ok  ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name} ${extra}`)
  }
}

console.log('== 1) 只读 git 命令放行 ==')
for (const cmd of [
  'git status',
  'git -c core.quotepath=false status --porcelain',
  'git -C D:/Work status',
  'git log --oneline -5',
  'git diff --cached',
  'git rev-parse --show-toplevel',
  'git for-each-ref refs/tags --format=%(refname:short)',
  'git branch',
  'git branch -a',
  'git branch --merged main',
  'git tag',
  'git tag -l "v1.*"',
  'git remote -v',
  'git remote show origin',
  'git status && git log -1',
]) {
  assert(`放行: ${cmd}`, gitGuardDeny(cmd) === null, JSON.stringify(gitGuardDeny(cmd)))
}

console.log('== 2) 破坏性 git 命令拒绝 ==')
for (const cmd of [
  'git push origin main',
  'git reset --hard HEAD~1',
  'git clean -fd',
  'git checkout -f main',
  'git checkout main',
  'git rm -rf src',
  'git branch -D feature',
  'git branch --move old new',
  'git tag v1.0',
  'git tag -d v1.0',
  'git remote add origin http://x',
  'git merge dev',
  'git cherry-pick abc',
  'git rebase main',
  'git stash drop',
  'git init',
]) {
  assert(`拒绝: ${cmd}`, gitGuardDeny(cmd) !== null)
}

console.log('== 3) shell 执行包装器解引用（漏网修复）==')
for (const cmd of [
  'sh -c "git reset --hard"',
  "bash -c 'git push origin main'",
  'cmd /c "git clean -fd"',
  'powershell -Command "git checkout -f main"',
  'sh -c "git reset --hard && git status"',
  "bash -c 'sh -c \"git push\"'",
]) {
  assert(`拒绝包装器: ${cmd}`, gitGuardDeny(cmd) !== null, JSON.stringify(gitGuardDeny(cmd)))
}

console.log('== 4) 惰性文本 / 只读包装器不误伤 ==')
for (const cmd of [
  'echo "git status"',
  "echo 'git pull'",
  'echo "sh -c \\"git status\\""',
  'sh -c "git status"',
  "bash -c 'git log --oneline -5'",
  'cmd /c "git diff --stat"',
  'powershell -Command "git for-each-ref refs/tags"',
  'sh -c "git status && git log -1"',
]) {
  assert(`放行: ${cmd}`, gitGuardDeny(cmd) === null, JSON.stringify(gitGuardDeny(cmd)))
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
