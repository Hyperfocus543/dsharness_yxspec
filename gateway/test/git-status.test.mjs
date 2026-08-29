// git.mjs parsePorcelainHead 单测（porcelain v1 首行 → 分支/游离态解析）
// 运行：cd gateway && node test/git-status.test.mjs
// 覆盖：
//   - 正常分支：`main` / `main...origin/main` / 带方括号领先落后
//   - 游离 HEAD：`HEAD (no branch)` / `HEAD (detached at …)` 以及**括号内领先落后**
//     （`HEAD (no branch, ahead 1, behind 2)`——旧实现把括号当分支名 → 误显示正常分支）
//   - 首次提交前：`No commits yet on main`
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const mod = await import(pathToFileURL(join(process.cwd(), 'lib', 'git.mjs')).href)
const { parsePorcelainHead } = mod

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
assert('main', JSON.stringify(parsePorcelainHead('main')) === JSON.stringify({ branch: 'main', detached: false }))
assert('main...origin/main', JSON.stringify(parsePorcelainHead('main...origin/main')) === JSON.stringify({ branch: 'main', detached: false }))
assert('main...origin/main（strip brackets）', JSON.stringify(parsePorcelainHead('main...origin/main')) === JSON.stringify({ branch: 'main', detached: false }))

console.log('== 2) 游离 HEAD（领先/落后在括号里）==')
assert('HEAD (no branch)', JSON.stringify(parsePorcelainHead('HEAD (no branch)')) === JSON.stringify({ branch: null, detached: true }))
assert(
  'HEAD (no branch, ahead 1, behind 2)',
  JSON.stringify(parsePorcelainHead('HEAD (no branch, ahead 1, behind 2)')) === JSON.stringify({ branch: null, detached: true }),
  JSON.stringify(parsePorcelainHead('HEAD (no branch, ahead 1, behind 2)')),
)
assert(
  'HEAD (detached at abc123)',
  JSON.stringify(parsePorcelainHead('HEAD (detached at abc123)')) === JSON.stringify({ branch: null, detached: true }),
)
assert(
  'HEAD (detached from main, ahead 1)',
  JSON.stringify(parsePorcelainHead('HEAD (detached from main, ahead 1)')) === JSON.stringify({ branch: null, detached: true }),
)

console.log('== 3) 首次提交前 ==')
assert(
  'No commits yet on main',
  JSON.stringify(parsePorcelainHead('No commits yet on main')) === JSON.stringify({ branch: 'main', detached: false }),
)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
