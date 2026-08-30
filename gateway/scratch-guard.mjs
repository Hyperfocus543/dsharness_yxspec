import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const mod = await import(pathToFileURL(join(process.cwd(), 'runtime-js', 'vendor', 'yxspec-tool-guard', 'index.js')).href)
const { gitGuardDeny } = mod

const cases = [
  // quoted subcommand — should be read-only (git "status" === git status)
  ['git "status"', null],
  ["git 'status'", null],
  ['git "log" --oneline -5', null],
  ["git 'diff' --stat", null],
  ['git "branch" -a', null],
  ['git "tag" -l', null],
  // quoted subcommand + destructive — must still be caught
  ['git "push" origin main', 'DENY'],
  ["git 'reset' --hard", 'DENY'],
  ['git "checkout" -f main', 'DENY'],
]

let pass = 0
for (const [cmd, expect] of cases) {
  const deny = gitGuardDeny(cmd)
  const got = deny === null ? 'PASS' : 'DENY'
  const ok = expect === null ? got === 'PASS' : got === 'DENY'
  if (ok) pass++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${JSON.stringify(cmd)} -> ${got}${deny ? ' | ' + deny : ''}`)
}
console.log(`\n${pass}/${cases.length}`)
process.exit(pass === cases.length ? 0 : 1)
