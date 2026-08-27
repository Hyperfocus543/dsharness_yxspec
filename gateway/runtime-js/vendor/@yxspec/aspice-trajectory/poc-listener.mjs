// POC 探针插件 v5：监听 internal/dispatch 观察 session/event 分发全过程
// 目的：搞清 root 插件 ctx.on('session/event') 为什么收不到（与 sdk-jsonrpc-server 对比）
import { appendFileSync, mkdirSync } from 'node:fs'

export const name = 'poc-trajectory-listener'
export const inject = ['sessions']

export function apply(ctx) {
  const logDir = `${process.cwd()}/.dsh`
  mkdirSync(logDir, { recursive: true })
  const trace = (msg) => {
    try { appendFileSync(`${logDir}/poc-probe-trace.txt`, `${new Date().toISOString()} ${msg}\n`, 'utf8') } catch {}
  }
  trace(`apply() invoked; cwd=${process.cwd()}`)

  // 方式 A：根 ctx 直接订阅（与 sdk-jsonrpc-server 逐字同款，无 global）
  const offA = ctx.on('session/event', (session, event) => {
    trace(`[A root no-global] ${event.type} seq=${event.seq} sid=${String(session.id)}`)
  })

  // 方式 C：global: true
  const offC = ctx.on('session/event', (session, event) => {
    trace(`[C global] ${event.type} seq=${event.seq} sid=${String(session.id)}`)
  }, { global: true })

  // 观察所有 session/event 分发（internal/dispatch 在共享 events 服务上，不经过 carrier 过滤）
  const offI = ctx.on('internal/dispatch', (mode, name, args, thisArg) => {
    if (name !== 'session/event') return
    try {
      const hooks = ctx.events?._hooks?.['session/event'] || []
      trace(`[I dispatch] mode=${mode} hooks=${hooks.length} thisArgHasFilter=${!!thisArg?.[Symbol.for('cordis.filter')]} session=${args?.[0]?.id} event=${args?.[1]?.type} seq=${args?.[1]?.seq}`)
    } catch (e) {
      trace(`[I dispatch] EXC ${String(e)}`)
    }
  }, { global: true })

  ctx.effect(() => {
    trace(`[effect] registered listeners; hooks.session/event=${(ctx.events?._hooks?.['session/event'] || []).length}`)
    return () => {
      trace('[dispose] cleanup')
      try { offA?.(); offC?.(); offI?.() } catch {}
    }
  })
}
