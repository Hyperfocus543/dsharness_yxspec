// git.mjs getFileDiff 单测（Git 工作区 diff 预览数据源）
// 运行：cd gateway && node test/git-diff.test.mjs
// 覆盖：
//   - 脏文件模式：modified 文件 diff 统计（完整 diff，非截断预览）
//   - 大 diff（>8000 字符）stats 须按完整 diff 统计，不被展示截断影响
//   - untracked 无基线 → status:'untracked' 降级
//   - 路径逃逸拒绝（绝对路径/盘符/..）
//   - commit 范围模式（from...to 三-dot）
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const TMP = join(tmpdir(), 'yxspec-git-diff-test-' + Date.now())
mkdirSync(TMP, { recursive: true })
process.env.YXSPEC_GIT_ROOT = TMP
process.env.YXSPEC_PROJECT_ROOT = TMP

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

const { getFileDiff } = await import(
  pathToFileURL(join(process.cwd(), 'lib', 'git.mjs')).href
)

try {
  execFileSync('git', ['init', '-q'], { cwd: TMP })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: TMP })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: TMP })

  console.log('== 1) 大 diff stats 按完整 diff 统计（>8000 字符截断不吞计数）==')
  {
    const lines = []
    for (let i = 0; i < 500; i++) lines.push(`line number ${i} with some padding content to exceed 8000 chars total`)
    writeFileSync(join(TMP, 'big.txt'), lines.join('\n'))
    execFileSync('git', ['add', '-A'], { cwd: TMP })
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: TMP })
    writeFileSync(join(TMP, 'big.txt'), lines.map((l) => l + ' changed').join('\n'))

    const r = await getFileDiff({ path: 'big.txt' })
    assert('ok=true', r.ok === true, JSON.stringify(r))
    assert('diff 被截断到 8000 字符', (r.diff?.length ?? 0) === 8000, String(r.diff?.length))
    assert('stats 按完整 diff 统计 500/500', r.stats?.added === 500 && r.stats?.removed === 500, JSON.stringify(r.stats))
  }

  console.log('== 2) untracked 无基线降级 ==')
  {
    writeFileSync(join(TMP, 'new.txt'), 'hello')
    const r = await getFileDiff({ path: 'new.txt' })
    assert('status=untracked', r.status === 'untracked', JSON.stringify(r))
    assert('diff=null（无基线）', r.diff === null, String(r.diff))
  }

  console.log('== 3) 路径逃逸拒绝 ==')
  {
    for (const bad of ['/etc/passwd', 'C:/Windows/x', '../outside', 'a/../../x']) {
      const r = await getFileDiff({ path: bad })
      assert(`拒绝逃逸路径 ${bad}`, r.ok === false && r.error === 'bad-request', JSON.stringify(r))
    }
  }

  console.log('== 4) commit 范围模式（from...to 三-dot）==')
  {
    const from = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: TMP }).toString().trim()
    // 改一行 → 新 commit
    writeFileSync(join(TMP, 'big.txt'), 'one more line\n')
    execFileSync('git', ['add', '-A'], { cwd: TMP })
    execFileSync('git', ['commit', '-q', '-m', 'second'], { cwd: TMP })
    const to = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: TMP }).toString().trim()
    const r = await getFileDiff({ path: '', from, to })
    assert('ok=true', r.ok === true, JSON.stringify(r))
    assert('status=range', r.status === 'range', JSON.stringify(r.status))
    assert('stats ≥1 added（新行加入）', (r.stats?.added ?? 0) >= 1, JSON.stringify(r.stats))
  }
} finally {
  rmSync(TMP, { recursive: true, force: true })
  delete process.env.YXSPEC_GIT_ROOT
  delete process.env.YXSPEC_PROJECT_ROOT
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
