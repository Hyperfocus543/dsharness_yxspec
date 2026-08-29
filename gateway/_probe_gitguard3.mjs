import { gitGuardDeny } from './runtime-js/vendor/yxspec-tool-guard/index.js'

const cases = [
  ['echo "git status $(git push)"', null],
  ['echo "x $(git reset --hard)"', null],
  ["echo 'git log `git pull`'", null],
  ['echo "run (git reset --hard)"', null],
  // 命令替换不在引号内 → 应拒绝
  ['git status $(git push)', 'DENY'],
  ['echo hi && $(git push)', 'DENY'],
  ['x=$(git push)', 'DENY'],
  ['foo="$(git reset --hard)"', null], // 赋值引号内惰性
  ['foo=$(git push)', 'DENY'],
]
for (const [c, want] of cases) {
  const got = gitGuardDeny(c)
  const ok = want === null ? got === null : got !== null
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(c)} => ${got === null ? 'null' : got.slice(0, 40)} (want ${want})`)
}
