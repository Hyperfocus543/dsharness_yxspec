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
  // 2026-08-29 追加：`=` 连写带值 flag 的引号值（含空格）整体当 token——此前
  // `--work-tree="D:/my work" status` 在内部空格拆成 `work"` 当子命令名 → 只读误伤
  'git --work-tree="D:/my work" status',
  'git --work-tree="D:/my work" log -1',
  'git --git-dir="D:/my repo/.git" status',
  'git -C="D:/my work dir" status',
  // 2026-08-29 追加：多个 git 全局选项（-c/-C）下只读子命令仍须放行（扫描无上限不误伤）
  'git -c a=1 -c b=2 -c c=3 -c d=4 status',
  'git -c a=1 -c b=2 -c c=3 -c d=4 -c e=5 -c f=6 log -1',
  'git -C D:/Work/a -C D:/Work/b -C D:/Work/c -C D:/Work/d branch -a',
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
  // 2026-08-29 追加：裸分支名创建（refs 写操作）此前整段漏过守卫——
  // `git branch foo` 无任何破坏性 flag，默认拒绝策略却放行创建。
  'git branch foo',
  'git branch foo main',
  'git branch --track foo',
  'git branch -t foo',
  'git branch -t foo main',
  'git tag v1.0',
  'git tag -d v1.0',
  'git remote add origin http://x',
  'git merge dev',
  'git cherry-pick abc',
  'git rebase main',
  'git stash drop',
  'git init',
  // 2026-08-29 追加：`=` 连写带值 flag 的引号值（含空格）整体当 token 后，
  // 破坏性子命令须仍被检出（`--work-tree="D:/my work" push` → push 拒绝）
  'git --work-tree="D:/my work" push origin main',
  // 2026-08-29 追加：多个 git 全局选项（-c/-C）把子命令挤出 token 上限（旧 8-token
  // 封顶：4 组 -c 就能让 push 落在第 9 个 token，扫描提前终止返回 null → 整段漏过守卫）
  // —— 子命令名扫描不做 token 上限，破坏性 push/reset 必须仍被检出
  'git -c core.quotepath=false -c color.ui=false -c safe.directory=x -c http.sslVerify=false push origin main',
  'git -c a=1 -c b=2 -c c=3 -c d=4 push',
  'git -c a=1 -c b=2 -c c=3 -c d=4 -c e=5 -c f=6 reset --hard',
  'git -C D:/Work/repo -C D:/Work/other -C D:/Work/three -C D:/Work/four clean -fd',
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
  // PowerShell 官方短别名 -c（等价 -Command）：此前只认长名，`-c "git reset --hard"`
  // 整段漏过守卫（git 词在引号内被裸分支引号过滤当文本放过），须 DENY
  'powershell -c "git reset --hard"',
  'powershell -c "git push origin main"',
  'pwsh -c "git clean -fd"',
  'powershell -NoProfile -c "git branch -D feature"',
  'powershell -NonInteractive -NoProfile -c "git checkout -f main"',
  'powershell -c "git reset --hard && git status"',
  "pwsh -c 'git rebase main'",
  // 2026-08-29 追加：wrapper 带额外 flag/开关/可执行名后缀时仍须解引用（此前整段漏网）
  'cmd /q /c "git clean -fd"',
  'cmd /q /c "git reset --hard"',
  'cmd /v:on /q /c "git reset --hard"',
  'cmd.exe /c "git clean -fd"',
  'cmd /q /k "git reset --hard"',
  'bash -e -c "git reset --hard"',
  'bash -x -c "git push origin main"',
  'bash -eu -c "git clean -fd"',
  'bash --login -c "git reset --hard"',
  'sh -l -c "git push"',
  'bash --command "git reset --hard"',
  'bash.exe -c "git reset --hard"',
  'bash -euxo pipefail -c "git clean -fd"',
  'powershell -ExecutionPolicy Bypass -Command "git reset --hard"',
  'powershell -NoProfile -ExecutionPolicy Bypass -c "git push origin main"',
  'pwsh -ExecutionPolicy Bypass -Command "git clean -fd"',
  'powershell.exe -Command "git reset --hard"',
  'powershell "git reset --hard"',
  'pwsh "git clean -fd"',
  'powershell -NoProfile "git reset --hard"',
  // 2026-08-29 追加：wrapper 带值 flag 的值是引号包裹串（带空格）时仍须解引用——
  // 此前值跳过子模式 `(?!-|["'`])` 拒绝引号值，flag 循环卡死在值上、-c/-Command 永不达，
  // 引号内破坏性 git 整段漏网（git 词在引号内被裸分支引号过滤当文本放过），须 DENY
  'bash --rcfile "my rc file" -c "git reset --hard"',
  "bash --init-file 'init bash' -c 'git push origin main'",
  'bash --rcfile rc -c "git clean -fd"',
  'bash --rcfile "my rc file" --login -c "git reset --hard"',
  'bash -e --rcfile "a b" -c "git checkout -f main"',
  'zsh -d -f -c "git branch -D feature"',
  'bash --rcfile "my rc" -c "git rebase main"',
  'powershell -ExecutionPolicy "Bypass All" -Command "git reset --hard"',
  "powershell -ExecutionPolicy 'Bypass All' -Command 'git push origin main'",
  'powershell -WindowStyle "Hidden X" -c "git clean -fd"',
  'pwsh -ExecutionPolicy "Bypass All" -Command "git branch -D feature"',
  'powershell -NoProfile -ExecutionPolicy "Bypass All" -c "git checkout -f main"',
  // 2026-08-29 追加：命令串后带尾随实参仍须解引用拒绝——`bash -c "git reset --hard" extra`
  // 的尾随实参是位置参数（$0/$1），不影响命令执行；此前 commandAfter 要求引号命令串
  // 须为末位，尾随实参被当作「不剥」依据，破坏性 git 整段漏过守卫（实测漏网）。
  // 只读命令 + 尾随实参（`bash -c "git status" extra`）解包后仍只读 → 放行（见 §4）。
  'bash -c "git reset --hard" extra',
  'sh -c "git clean -fd" foo',
  'bash -euxo pipefail -c "git push origin main" extra',
  'powershell -c "git push origin main" extra',
  'pwsh -Command "git reset --hard" more',
  'cmd /c "git clean -fd" extra',
  // 2026-08-29 追加：cmd/ps 隐式命令串（非 -c/-Command 直连）带尾随实参仍须解引用——
  // `powershell -NoProfile "git reset --hard" extra` 的引号串是隐式执行命令，尾随实参
  // 是 %*/args 不影响命令内容；此前 flag 值跳过逻辑把它当 `-NoProfile` 的值吞掉，
  // 破坏性 git 整段漏过守卫（实测漏网）。
  'powershell -NoProfile "git reset --hard" extra',
  'powershell -NoProfile "git clean -fd" more',
  'cmd /q "git reset --hard" more',
  'cmd /q "git clean -fd" extra',
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
  // PowerShell -c 短别名只读命令：解引用后子命令为只读 → 放行（不误伤）
  'powershell -c "git status"',
  'powershell -c "git log --oneline -5"',
  "pwsh -c 'git diff --stat'",
  // 2026-08-29 追加：wrapper 带额外 flag/开关的只读命令解引用后子命令只读 → 放行
  'cmd /q /c "git status"',
  'bash -e -c "git status"',
  'bash --login -c "git diff --stat"',
  'bash -euxo pipefail -c "git status"',
  'powershell -ExecutionPolicy Bypass -Command "git status"',
  'powershell -NoProfile -ExecutionPolicy Bypass -c "git status"',
  'powershell.exe -Command "git status"',
  'powershell "git status"',
  'powershell -NoProfile "git status"',
  'cmd /v:on /q /c "git diff --stat"',
  // 2026-08-29 追加：带值 flag 的值是引号包裹串（带空格）的只读 wrapper——
  // 解引用后子命令只读 → 放行（不误伤）
  'bash --rcfile "my rc file" -c "git status"',
  'bash --rcfile "my rc file" -c "git log --oneline -5"',
  'powershell -ExecutionPolicy "Bypass All" -Command "git status"',
  'powershell -WindowStyle "Hidden X" -c "git diff --stat"',
  // 2026-08-29 追加：命令串带尾随实参的只读 wrapper 解包后仍只读 → 放行（不误伤）。
  // 回归：修复「尾随实参不剥」时不能把只读命令 + 尾随实参误判为破坏性。
  'bash -c "git status" extra',
  'bash -c "git log -1" x y',
  'powershell -NoProfile "git status" extra',
  'cmd /q "git status" extra',
]) {
  assert(`放行: ${cmd}`, gitGuardDeny(cmd) === null, JSON.stringify(gitGuardDeny(cmd)))
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
