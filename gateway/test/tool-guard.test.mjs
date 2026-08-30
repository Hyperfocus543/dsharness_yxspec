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
  // 2026-08-30 追加：git-workspaces.mjs 落后摘要用 `git rev-list --count HEAD..@{u}`、
  // `git show-ref --tags` 同为只读 ref 枚举——此前不在只读白名单 → 默认拒绝误伤，
  // 网关自身命令被自家守卫拦截（自洽性回归）。
  'git rev-list --count HEAD..@{u}',
  'git show-ref --tags',
  'git show-ref --head',
  'git branch',
  'git branch -a',
  'git branch --merged main',
  'git tag',
  'git tag -l "v1.*"',
  'git remote -v',
  'git remote --verbose',
  'git remote show origin',
  // 2026-08-31 追加：config/stash 只读子命令放行——`git config --get user.name`
  // （agent 查身份/remote URL 的常规只读调用）与 `git stash list`/`git stash show`
  // （查暂存区，纯展示不落盘）此前整段被默认拒绝误伤，现按 flag/子命令细分放行。
  'git config --get user.name',
  'git config --get-all remote.origin.url',
  'git config --get user.name --show-origin',
  'git config --list',
  'git config -l',
  'git config --get-regexp user',
  'git config',
  'git stash list',
  'git stash show',
  'git stash show stash@{0}',
  'git stash show --stat',
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
  // 2026-08-30 追加：单 `&` 切段（后台操作符）时 `&` 的重定向形态不切——
  // `2>&1` / `&>file` 是重定向的一部分，若被当分隔符切段，`>&1` 段会被误判成
  // 非 git 段（无子命令）→ 默认拒绝误伤整条只读命令。
  'git status 2>&1',
  'git log --format="%x09" 2>&1',
  'git status &>/dev/null',
  'git status >& log.txt',
  // 2026-08-30 追加：`cmd1 & cmd2` 两条都执行（后台符分隔）；两条都只读 → 放行（不误伤）
  'git status & git log -1',
  'git log -1 & git status',
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
  // 2026-08-31 追加：config/stash 写操作拒绝——`git config user.name x`（写本地值）、
  // `git config --add/--unset/--global`（改配置），`git stash push/drop/pop/apply/clear`
  // （改 stash 栈/工作树）。此前这些未被细分拦截（config/stash 整体被默认拒绝，
  // 属「误伤掩盖漏网」：config 只读查询一并误伤），现只读细分后写操作必须仍拒绝。
  'git config user.name x',
  'git config --add user.name y',
  'git config --unset user.name',
  'git config --global user.name z',
  'git stash push -m "wip"',
  'git stash drop',
  'git stash pop',
  'git stash apply stash@{0}',
  'git stash clear',
  'git stash create',
  // 2026-08-30 追加：`-v`/`--verbose` 是 remote 的「列出」flag，不是子命令——
  // `git remote -v add origin <url>` 仍执行 add（实测 git 把 -v 当 flag），
  // 此前把 -v 当子命令白名单 → 写操作漏过守卫，现须拒绝。
  'git remote -v add origin http://x',
  'git remote --verbose add origin http://x',
  'git remote -v add upstream https://github.com/x/y.git',
  'git remote -v rm origin',
  'git remote -v set-url origin https://x',
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
  // 2026-08-30 追加：单 `&`（bash 后台操作符）分隔的两条命令**都执行**——
  // `git status & git push origin main` 的 push 真实运行，此前 `&` 不切段、
  // 只扫段内首个 git 调用（只读 status）→ 破坏性 git 整段漏过守卫（实测漏网）。
  // 现须 DENY；无空格连写（`status&git push`）与 `&&`/`;` 分隔同属已覆盖形态。
  'git status & git push origin main',
  'git log & git reset --hard',
  'git status & git clean -fd',
  'git status&git push origin main',
  'git status & git remote add origin http://x',
  'git status & git branch -D feature',
  // 后台符后的破坏性 git 藏在引号/子 shell 里同须检出
  'echo "abc & git push" & git push origin main',
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
  // 2026-08-30 追加：shell 执行包装器内用单 `&`（后台符）分隔的复合命令——
  // `sh -c "git status & git push origin main"` 解包后切段扫描，push 须被检出
  // （此前 `&` 不切段，解包后只扫首个 git 调用 = 只读 status，push 漏网）
  'sh -c "git status & git push origin main"',
  'bash -c "git log & git reset --hard"',
  'powershell -c "git status & git clean -fd"',
  // 2026-08-30 追加：命令 flag 与引号命令串「无空格连写」的包装器形态——cmd/bash/powershell
  // 都接受 `cmd /c"git reset --hard"` 这类写法（开关直接贴引号串，等价于空格分隔，实测 cmd
  // 真实执行）。此前 tokenizeShell 把 `-c"git reset --hard"` 按裸 \S+ 拆成 `-c"git` + `reset`…
  // → 开关判定不命中 + 引号命令串被裸分支引号过滤当惰性文本 → 破坏性 git 整段漏过守卫
  // （与空格分隔形态行为不一致），现须 DENY。
  'cmd /c"git reset --hard"',
  'cmd /k"git reset --hard"',
  'cmd /q /c"git reset --hard"',
  'cmd /c"git clean -fd"',
  'cmd /c"echo hi & git push origin main"',
  'cmd /c"git branch -D feature"',
  // 2026-08-30 追加：反斜杠-换行（bash 行继续符）把破坏性 git 拆成两行——
  // bash 在任何词法处理前删除 `\<newline>` 对（双引号内同样生效），
  // `sh -c "git \<newline>push origin main"` 真实执行 `git push`。而引号感知切分
  // 的引号 span 排除换行，`"git \` 被当引号串尾巴、`push` 当裸词 → 解引用拿不到
  // 完整命令，破坏性 git 整段漏过守卫（实测漏网，裸 `git \<newline>push` 同样漏）。
  // 入口归一移除 `\\\n`/`\\\r\n` 后须检出。
  'sh -c "git \\\npush origin main"',
  'sh -c "git \\\r\npush origin main"',
  'sh -c \'git \\\npush origin main\'',
  'bash -c "git \\\nreset --hard"',
  'powershell -Command "git \\\nclean -fd"',
  'cmd /c "git \\\ncheckout -f main"',
  'sh -c "git \\\nstatus & git push origin main"',
  // 裸形态行继续同样漏网（无 shell 包装，段首 git 后跟行继续拆散）
  'git \\\npush origin main',
  'git \\\n \\\npush',
  'git \\\nreset --hard',
  'git \\\r\nclean -fd',
  // 多级行继续后紧跟破坏性 git
  'sh -c "git \\\n \\\npush"',
  'bash -c"git reset --hard"',
  "bash -c'git push origin main'",
  'sh -c"git clean -fd"',
  'bash --command"git reset --hard"',
  'bash -euxo pipefail -c"git push origin main"',
  'powershell -Command"git reset --hard"',
  'powershell -c"git push origin main"',
  'pwsh -c"git clean -fd"',
  'powershell -NoProfile -ExecutionPolicy Bypass -c"git checkout -f main"',
]) {
  assert(`拒绝包装器: ${cmd}`, gitGuardDeny(cmd) !== null, JSON.stringify(gitGuardDeny(cmd)))
}

console.log('== 3b) eval 内置解引用（漏网修复）==')
// eval 的参数按真实命令执行（`eval "git push origin main"` 的 push 真实运行），
// 不是惰性文本——git 词落在引号内被裸分支引号过滤当文本放过（echo "git status"
// 语义），此前 `eval "git push"` 整段漏过守卫（实测漏网）。现须解引用后按真实
// 命令判定；只读 eval（`eval "git status"`）解包后仍只读 → 放行（见 §4）。
for (const cmd of [
  'eval "git push origin main"',
  'eval \'git reset --hard\'',
  'eval "git clean -fd"',
  'eval "git checkout -f main"',
  'eval "git branch -D feature"',
  'eval "git remote add origin http://x"',
  'eval "git status && git push origin main"',
  'eval "sh -c \'git push\'"',
  'eval "echo x && git reset --hard"',
]) {
  assert(`拒绝 eval: ${cmd}`, gitGuardDeny(cmd) !== null, JSON.stringify(gitGuardDeny(cmd)))
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
  // 2026-08-30 追加：只读 eval（解引用后子命令只读）→ 放行（不误伤）
  'eval "git status"',
  'eval \'git log --oneline -5\'',
  'eval "git status && git log -1"',
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
  // 2026-08-30 追加：无空格连写的只读包装器（与破坏性连写同 token 化路径）——
  // 解引用后子命令只读 → 放行（不误伤）
  'cmd /c"git status"',
  'cmd /c"git diff --stat"',
  'bash -c"git status"',
  "bash -c'git log --oneline -5'",
  'sh -c"git diff --stat"',
  'powershell -c"git status"',
  'pwsh -c"git log --oneline -5"',
  // 2026-08-30 追加：反斜杠-换行（行继续符）拆开的只读命令不误伤——
  // 入口归一移除 `\\\n` 后解引用子命令仍只读 → 放行
  'sh -c "git \\\nstatus"',
  'git \\\nstatus',
  'git -C D:/Work \\\nlog -1',
]) {
  assert(`放行: ${cmd}`, gitGuardDeny(cmd) === null, JSON.stringify(gitGuardDeny(cmd)))
}

console.log('== 5) 段内命令替换/子 shell 解引用（漏网修复）==')
// 命令替换（$(…) / `…`）与子 shell（(…)）在子进程真实执行——破坏性 git 藏在
// 只读 git 调用的命令替换里会整段漏过守卫（外层段首个子命令是只读 status，
// 旧实现只扫外层一个 git 调用）。须递归解引用后按独立命令判定。
// 2026-08-30 追加：**双引号包裹的命令替换也真实执行**（bash 双引号只保留 $ / 反引号 /
// \ / ! 的特殊性，不关闭 $() 与反引号替换）——`echo "x $(git push)"` 的 push 真实运行，
// 此前被误当惰性文本整段漏过守卫（旧 §6 放行：漏网）；现须拒绝。只有单引号区间
// （原样保留一切字符）才是惰性文本，仍在 §6 放行。
for (const cmd of [
  // 只读命令替换 → 解引用后仍只读，放行（不误伤）
  'git status $(git status)',
  'git status $(echo hi)',
  // 破坏性命令替换藏在只读 git 调用后 → 须拒绝（此前整段漏网）
  'git status $(git push origin main)',
  'git status `git push`',
  'git log $(git reset --hard)',
  'git diff --cached $(git push origin main)',
  'git -C /repo status $(git push)',
  // 子 shell 形态
  'git status (git push origin main)',
  'git status $(git clean -fd)',
  'git log `git checkout -f main`',
  // 2026-08-30 追加：双引号内的命令替换/反引号同样真实执行 → 须拒绝
  'echo "git status $(git push)"',
  'echo "built $(git push origin main)"',
  'echo "x $(git clean -fd)"',
  'echo "x `git push origin main`"',
  'echo "head $(git reset --hard)"',
  // 2026-08-30 追加：双引号内的撇号是普通字符，不能把它当单引号开区间——
  // `echo "don't $(git push)"` 的 push 仍真实执行，须拒绝（数引号对数会漏网）
  'echo "don\'t $(git push origin main)"',
  'echo "it\'s $(git reset --hard)"',
  'echo "couldn\'t $(git clean -fd)"',
  // 双引号内反斜杠转义（\" 不关闭双引号）→ 引号状态仍是双引号 → 命令替换仍执行
  'echo "a \\" b $(git push origin main)"',
]) {
  const deny = gitGuardDeny(cmd)
  if (cmd.includes('$(git status)') || cmd.includes('$(echo hi)')) {
    assert(`放行: ${cmd}`, deny === null, JSON.stringify(deny))
  } else {
    assert(`拒绝命令替换: ${cmd}`, deny !== null, JSON.stringify(deny))
  }
}

console.log('== 6) 惰性文本引号内命令替换不误伤 ==')
// 惰性文本只认**单引号**区间（bash 单引号原样保留一切字符，含 $()/反引号/子 shell，
// 命令内容不执行）；双引号内的 `(…)` 子 shell 也是字面文本（双引号不把括号当语法），
// 但双引号内的 `$(…)`/反引号命令替换真实执行，已在 §5 拒绝。
for (const cmd of [
  "echo 'git log `git pull`'",
  "echo 'git status $(git push)'",
  "echo '$(git reset --hard)'",
  'echo "run (git reset --hard)"',
  'echo "print (git push origin main)"',
]) {
  assert(`放行惰性文本: ${cmd}`, gitGuardDeny(cmd) === null, JSON.stringify(gitGuardDeny(cmd)))
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
