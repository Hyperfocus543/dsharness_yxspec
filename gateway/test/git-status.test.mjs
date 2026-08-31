// git.mjs parsePorcelainHead 单测（porcelain v1 首行 → 分支/上游/游离态解析）
// 运行：cd gateway && node test/git-status.test.mjs
// 覆盖：
//   - 正常分支：`main` / `main...origin/main` / 带方括号领先落后
//   - 上游跟踪分支提取：`main...origin/main` → upstream='origin/main'（v2：旧实现丢弃，
//     前端无法显示「领先/落后相对哪个远端分支」）；无上游（`main`）→ null
//   - 游离 HEAD：`HEAD (no branch)` / `HEAD (detached at …)` 以及**括号内领先落后**
//     （`HEAD (no branch, ahead 1, behind 2)`——旧实现把括号当分支名 → 误显示正常分支）
//   - 首次提交前：`No commits yet on main`
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const mod = await import(pathToFileURL(join(process.cwd(), 'lib', 'git.mjs')).href)
const { parsePorcelainHead, parseStashList, parseNumstatRows } = mod

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

console.log('== 1) 正常分支 ==')
assert('main', JSON.stringify(parsePorcelainHead('main')) === JSON.stringify({ branch: 'main', upstream: null, detached: false }))
assert(
  'main...origin/main → upstream=origin/main',
  JSON.stringify(parsePorcelainHead('main...origin/main')) === JSON.stringify({ branch: 'main', upstream: 'origin/main', detached: false }),
  JSON.stringify(parsePorcelainHead('main...origin/main')),
)
assert(
  'main...origin/main（strip brackets）→ upstream=origin/main',
  JSON.stringify(parsePorcelainHead('main...origin/main')) === JSON.stringify({ branch: 'main', upstream: 'origin/main', detached: false }),
)
assert(
  '带方括号区间由调用方剥离：branchInfo 已剥（main...origin/main）→ upstream=origin/main',
  JSON.stringify(parsePorcelainHead('main...origin/main')) === JSON.stringify({ branch: 'main', upstream: 'origin/main', detached: false }),
)

console.log('== 2) 游离 HEAD（领先/落后在括号里）==')
assert('HEAD (no branch)', JSON.stringify(parsePorcelainHead('HEAD (no branch)')) === JSON.stringify({ branch: null, upstream: null, detached: true }))
assert(
  'HEAD (no branch, ahead 1, behind 2)',
  JSON.stringify(parsePorcelainHead('HEAD (no branch, ahead 1, behind 2)')) === JSON.stringify({ branch: null, upstream: null, detached: true }),
  JSON.stringify(parsePorcelainHead('HEAD (no branch, ahead 1, behind 2)')),
)
assert(
  'HEAD (detached at abc123)',
  JSON.stringify(parsePorcelainHead('HEAD (detached at abc123)')) === JSON.stringify({ branch: null, upstream: null, detached: true }),
)
assert(
  'HEAD (detached from main, ahead 1)',
  JSON.stringify(parsePorcelainHead('HEAD (detached from main, ahead 1)')) === JSON.stringify({ branch: null, upstream: null, detached: true }),
)

console.log('== 3) 首次提交前 ==')
assert(
  'No commits yet on main',
  JSON.stringify(parsePorcelainHead('No commits yet on main')) === JSON.stringify({ branch: 'main', upstream: null, detached: false }),
)

console.log('== 4) stash 列表解析（git stash list --format=%gd: %gs）==')
const WIP_LINE = 'stash@{0}: WIP on main: abc1234 暂存中的改动'
const nonWip = 'stash@{1}: On feat/x: def5678 feature wip'
const noCommit = 'stash@{2}: WIP on main: 没有 commit 的行'
assert(
  'WIP 行 → ref/分支/commit/说明',
  JSON.stringify(parseStashList(WIP_LINE)) ===
    JSON.stringify([{ ref: 'stash@{0}', branch: 'main', commit: 'abc1234', subject: '暂存中的改动' }]),
  JSON.stringify(parseStashList(WIP_LINE)),
)
assert(
  '非 WIP stash（On <branch>:）→ branch 取 On 后分支',
  JSON.stringify(parseStashList(nonWip)) ===
    JSON.stringify([{ ref: 'stash@{1}', branch: 'feat/x', commit: 'def5678', subject: 'feature wip' }]),
  JSON.stringify(parseStashList(nonWip)),
)
assert(
  '缺 commit 的行 → commit 为 null（整段说明保留为 subject，不丢信息）',
  JSON.stringify(parseStashList(noCommit)) ===
    JSON.stringify([{ ref: 'stash@{2}', branch: 'main', commit: null, subject: '没有 commit 的行' }]),
  JSON.stringify(parseStashList(noCommit)),
)
assert(
  '仅 ref + commit（无说明）→ subject 为 null',
  JSON.stringify(parseStashList('stash@{3}: WIP on main: abc1234')) ===
    JSON.stringify([{ ref: 'stash@{3}', branch: 'main', commit: 'abc1234', subject: null }]),
  JSON.stringify(parseStashList('stash@{3}: WIP on main: abc1234')),
)
assert(
  '多行（含空行）→ 按行解析',
  JSON.stringify(parseStashList(`${WIP_LINE}\n\n${nonWip}\n`)) ===
    JSON.stringify([
      { ref: 'stash@{0}', branch: 'main', commit: 'abc1234', subject: '暂存中的改动' },
      { ref: 'stash@{1}', branch: 'feat/x', commit: 'def5678', subject: 'feature wip' },
    ]),
  JSON.stringify(parseStashList(`${WIP_LINE}\n\n${nonWip}\n`)),
)
assert('空输入 → []', JSON.stringify(parseStashList('')) === '[]' && JSON.stringify(parseStashList('   ')) === '[]')
assert('null/undefined/非字符串 → []', JSON.stringify(parseStashList(null)) === '[]' && JSON.stringify(parseStashList(undefined)) === '[]')
assert('非法行（非 stash 格式）→ 跳过', JSON.stringify(parseStashList('abc def')) === '[]')

console.log('== 5) 逐文件改动统计解析（git diff HEAD --numstat → 行内 +N/-M）==')
assert(
  '常规行 → {path,added,removed} 数组',
  JSON.stringify(parseNumstatRows('1\t0\ta.md\n0\t2\tb.md\n3\t4\tc.md\n')) ===
    JSON.stringify([
      { path: 'a.md', added: 1, removed: 0 },
      { path: 'b.md', added: 0, removed: 2 },
      { path: 'c.md', added: 3, removed: 4 },
    ]),
  JSON.stringify(parseNumstatRows('1\t0\ta.md\n0\t2\tb.md\n3\t4\tc.md\n')),
)
assert(
  '二进制 `-\t-` 行 → added/removed 归 0（文件仍计入）',
  JSON.stringify(parseNumstatRows('-\t-\tassets/logo.png\n2\t1\td.md\n')) ===
    JSON.stringify([
      { path: 'assets/logo.png', added: 0, removed: 0 },
      { path: 'd.md', added: 2, removed: 1 },
    ]),
  JSON.stringify(parseNumstatRows('-\t-\tassets/logo.png\n2\t1\td.md\n')),
)
assert(
  '含空格路径（TAB 分隔不受影响）',
  JSON.stringify(parseNumstatRows('2\t0\tmy file.txt\n')) ===
    JSON.stringify([{ path: 'my file.txt', added: 2, removed: 0 }]),
  JSON.stringify(parseNumstatRows('2\t0\tmy file.txt\n')),
)
assert('空/纯空白 → []', JSON.stringify(parseNumstatRows('')) === '[]' && JSON.stringify(parseNumstatRows('   \n')) === '[]')
assert('null/undefined/非字符串 → []', JSON.stringify(parseNumstatRows(null)) === '[]' && JSON.stringify(parseNumstatRows(undefined)) === '[]')

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
