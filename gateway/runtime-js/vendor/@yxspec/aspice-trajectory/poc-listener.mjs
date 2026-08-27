// POC 探针插件：根 ctx 订阅 session/event，记录事件形状并落盘验证可达性。
// 同时订阅 session/created 观察会话生命周期。不写轨迹文件（那是正式插件的事）。
import { appendFileSync, mkdirSync } from 'node:fs'

export const name = 'poc-trajectory-listener'

export function apply(ctx) {
  const seen = []
  const logFile = `${process.cwd()}/.dsh/poc-trajectory-events.jsonl`
  mkdirSync(process.cwd() + '/.dsh', { recursive: true })

  // 根 ctx 直接订阅（与 sdk-jsonrpc-server / session-persistence 同款写法）
  const off = ctx.on('session/event', (session, event) => {
    const entry = {
      type: event.type,
      seq: event.seq,
      sessionId: String(session.id),
      data: event.data,
    }
    seen.push(entry)
    try { appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf8') } catch {}
  }, { global: true })
  const off2 = ctx.on('session/created', (session) => {
    ctx.logger?.info?.(`[poc] session/created: ${String(session.id)}`)
  }, { global: true })

  ctx.logger?.info?.('[poc-trajectory-listener] apply: 已订阅 session/event（根 ctx）')

  ctx.effect(() => {
    ctx.logger?.info?.(`[poc-trajectory-listener] 卸载：共收到 ${seen.length} 个事件`)
    try { off?.(); off2?.() } catch {}
  })
}
