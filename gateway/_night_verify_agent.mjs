// 夜间回归临时验证脚本（验证后删除）
// 1) getStatus().recentCommits 含 message 字段
// 2) plugins.mjs getPluginMap() 含 git-workspace / yxspec-self-iteration
import { getStatus } from './lib/git.mjs'
import { getPluginMap } from './lib/plugins.mjs'

process.env.YXSPEC_GIT_ROOT = process.cwd()

const st = await getStatus()
const rc = st.recentCommits ?? []
const hasMsg = rc.every((c) => typeof c.message === 'string')
const hasSubject = rc.every((c) => typeof c.subject === 'string')
console.log('gitAvailable=', st.gitAvailable, 'root=', st.root)
console.log('recentCommits.length=', rc.length, 'hasMessage=', hasMsg, 'hasSubject=', hasSubject)
if (!st.gitAvailable) console.log('gitError=', st.error)
if (rc.length > 0) console.log('sample=', JSON.stringify(rc[0]))
if (!hasMsg || !hasSubject || !st.gitAvailable) process.exit(1)

const map = getPluginMap()
console.log('map keys=', Object.keys(map).join(','))
const gw = map['git-workspace']
const si = map['yxspec-self-iteration']
console.log('git-workspace=', JSON.stringify(gw))
console.log('yxspec-self-iteration=', JSON.stringify(si))
if (!gw || !si) process.exit(1)
console.log('ASSERT PASS')
