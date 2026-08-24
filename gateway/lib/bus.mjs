// 事件总线：SSE 广播（复用 M1 broadcaster 思路，驱动层换成本地 harness）。
// 一个广播器维护 {session_id -> Set<response>}，支持 keep-alive 心跳。
import { EventEmitter } from 'node:events'

const HUB = new EventEmitter()

export function emitEvent(sessionId, type, data) {
  const evt = { type, data: { session_id: sessionId, ...data } }
  HUB.emit('event', sessionId, evt)
  HUB.emit('event-all', evt)
}

export function subscribeSession(sessionId, onEvent) {
  const handler = (sid, evt) => {
    if (sid === sessionId) onEvent(evt)
  }
  HUB.on('event', handler)
  return () => HUB.off('event', handler)
}

export function subscribeAll(onEvent) {
  const handler = (evt) => onEvent(evt)
  HUB.on('event-all', handler)
  return () => HUB.off('event-all', handler)
}

/** 生成 SSE 文本帧。 */
export function sseFrame(event) {
  return `data: ${JSON.stringify(event)}\n\n`
}

export function sseKeepalive() {
  return ': keep-alive\n\n'
}

/** 打开一个 SSE 响应流：连接帧 → 事件 → 心跳 → 关闭。 */
export function openSseStream(res, { sessionId, onClose }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  // 客户端断开标记 + 写保护：res.write 在连接关闭后调用可能抛 EPIPE/ERR_STREAM_WRITE_AFTER_END，
  // 而本函数在 EventEmitter 的订阅回调里同步被调，一旦抛出会一路炸到正在跑的 turn。
  let closed = false
  const send = (frame) => {
    if (closed || res.writableEnded || res.destroyed) return
    try {
      res.write(frame)
    } catch {
      /* 客户端已断开，忽略写入错误 */
    }
  }

  // session/connected 连接帧
  send(sseFrame({ type: 'session/connected', data: { session_id: sessionId } }))

  const unsubscribe = subscribeSession(sessionId, (evt) => {
    send(sseFrame(evt))
  })

  const heartbeat = setInterval(() => {
    send(sseKeepalive())
  }, 15_000)

  // 吞掉底层 socket 的 error（客户端断电/刷新会触发），避免未处理 'error' 事件炸进程
  res.on('error', () => {})

  res.on('close', () => {
    closed = true
    clearInterval(heartbeat)
    unsubscribe()
    onClose?.()
  })
}

/** 广播 goal/change 状态（契约 §2 shape）。 */
export function broadcastGoal(sessionId, token, state, aspice) {
  emitEvent(sessionId, 'goal/change', { name: token, state, aspice })
}

/** 广播 todo/write（契约 §2 shape）。 */
export function broadcastTodos(sessionId, todos) {
  emitEvent(sessionId, 'todo/write', { todos })
}

/** 广播 turn/end（契约 §2 shape）。 */
export function broadcastTurnEnd(sessionId, reason) {
  emitEvent(sessionId, 'turn/end', { reason })
}
