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

const { getFileDiff, getStatus, parseNumstat } = await import(
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

  console.log('== 5) parseNumstat（git diff --numstat 输出 → 改动汇总）==')
  {
    assert('空串 → null', parseNumstat('') === null)
    assert('仅空白 → null', parseNumstat('  \n\t\n') === null)
    assert(
      '常规三行统计',
      JSON.stringify(parseNumstat('1\t0\ta.md\n0\t2\tb.md\n3\t4\tc.md\n')) ===
        JSON.stringify({ files: 3, added: 4, removed: 6 }),
      JSON.stringify(parseNumstat('1\t0\ta.md\n0\t2\tb.md\n3\t4\tc.md\n')),
    )
    assert(
      '二进制行（- -）计入文件数不算行数',
      JSON.stringify(parseNumstat('-\t-\timg.bin\n2\t1\td.md\n')) ===
        JSON.stringify({ files: 2, added: 2, removed: 1 }),
      JSON.stringify(parseNumstat('-\t-\timg.bin\n2\t1\td.md\n')),
    )
    assert(
      '含空格路径（tab 分隔 → 路径可含空格）',
      JSON.stringify(parseNumstat('1\t0\tmy file.txt\n')) ===
        JSON.stringify({ files: 1, added: 1, removed: 0 }),
      JSON.stringify(parseNumstat('1\t0\tmy file.txt\n')),
    )
  }

  console.log('== 6) getStatus dirtyStats（工作区改动汇总）==')
  {
    // 工作区改动：big.txt 加 1 行（相对 second 提交）；dirtyStats 应含该文件统计
    writeFileSync(join(TMP, 'big.txt'), 'one more line\nworktree change\n')
    const st = await getStatus()
    assert('gitAvailable=true', st.gitAvailable === true, JSON.stringify(st.error))
    assert('dirtyFiles 命中 big.txt', st.dirtyFiles.some((f) => f.path === 'big.txt'), JSON.stringify(st.dirtyFiles))
    assert('dirtyStats.files ≥1', (st.dirtyStats?.files ?? 0) >= 1, JSON.stringify(st.dirtyStats))
    assert('dirtyStats.added ≥1（工作区加行）', (st.dirtyStats?.added ?? 0) >= 1, JSON.stringify(st.dirtyStats))
    assert('dirtyStats.removed ≥0', (st.dirtyStats?.removed ?? -1) >= 0, JSON.stringify(st.dirtyStats))
  }

  console.log('== 7) getStatus tags 富格式（tag → 指向 commit / subject / 提交时间）==')
  {
    const c1 = execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: TMP }).toString().trim()
    const c2 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: TMP }).toString().trim()
    // 轻量 tag 指向 first commit；注解 tag 指向 second commit（= HEAD，应进 headTags）
    execFileSync('git', ['tag', 'lt-1', c1], { cwd: TMP })
    execFileSync('git', ['tag', '-a', 'annotated', '-m', 'annotated message', c2], { cwd: TMP })

    const st = await getStatus()
    const tags = st.tags
    assert('tags 为对象数组（富格式）', Array.isArray(tags) && tags.length >= 2 && typeof tags[0] === 'object', JSON.stringify(tags))
    const lt = tags.find((t) => t.name === 'lt-1')
    const ann = tags.find((t) => t.name === 'annotated')
    assert('轻量 tag → commit 指向 c1 + subject 取该 commit', lt && lt.commit === c1 && lt.subject === 'init', JSON.stringify(lt))
    assert('注解 tag → commit 指向 c2（peeled）', ann && ann.commit === c2, JSON.stringify(ann))
    assert('注解 tag → subject 取 peeled commit 的提交说明', ann && ann.subject === 'second', JSON.stringify(ann))
    assert('注解 tag → commitAt 为 ISO 时间', ann && typeof ann.commitAt === 'string' && !Number.isNaN(new Date(ann.commitAt).getTime()), JSON.stringify(ann))
    assert('commitShort 为 7 位短 hash', ann && ann.commitShort === c2.slice(0, 7), JSON.stringify(ann))
    assert('headTags 命中指向 HEAD 的 tag（annotated）', Array.isArray(st.headTags) && st.headTags.includes('annotated'), JSON.stringify(st.headTags))
  }
} finally {
  rmSync(TMP, { recursive: true, force: true })
  delete process.env.YXSPEC_GIT_ROOT
  delete process.env.YXSPEC_PROJECT_ROOT
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
