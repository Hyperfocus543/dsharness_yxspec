// POC 探针插件 v3：多种订阅方式对比，全部写文件留痕（根 ctx vs global）
import { appendFileSync, mkdirSync } from 'node:fs'

export const name = 'poc-trajectory-listener'

export function apply(ctx) {
  const logDir = `${process.cwd()}/.dsh`
  mkdirSync(logDir, { recursive: true })
  const trace = (msg) => {
    try { appendFileSync(`${logDir}/poc-probe-trace.txt`, `${new Date().toISOString()} ${msg}\n`, 'utf8') } catch {}
  }
  trace(`apply() invoked; cwd=${process.cwd()}; sessions.now=${ctx.sessions ? ctx.sessions.list?.().length : 'n/a'}`)

  // 方式 A：根 ctx 直接订阅（与 sdk-jsonrpc-server 逐字同款，无 global）
  const offA = ctx.on('session/event', (session, event) => {
    trace(`[A root no-global] ${event.type} seq=${event.seq} sid=${String(session.id)}`)
  })

  // 方式 B：root.events 直接订阅
  const offB = ctx.root.events?.on?.('session/event', (session, event) => {
    trace(`[B root.events] ${event.type} seq=${event.seq} sid=${String(session.id)}`)
  })

  // 方式 C：global: true
  const offC = ctx.on('session/event', (session, event) => {
    trace(`[C global] ${event.type} seq=${event.seq} sid=${String(session.id)}`)
  }, { global: true })

  // session/created 对照
  const offD = ctx.on('session/created', (session) => {
    trace(`[D created] ${String(session.id)}`)
  }, { global: true })

  ctx.effect(() => {
    trace('dispose: unsubscribed')
    try { offA?.(); offB?.(); offC?.(); offD?.() } catch {}
  })
}
