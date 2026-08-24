// SSE 完整捕获：订阅事件流 + 派活一次真实推进，捕获 goal/change + todo/write + turn/end
const EVENTS_URL = 'http://127.0.0.1:8787/api/events?session_id=acpt-sse'
const controller = new AbortController()
const res = await fetch(EVENTS_URL, { signal: controller.signal })
console.log('SSE status:', res.status)
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
const events = []
const timeout = setTimeout(() => controller.abort(), 240_000)

const readerPump = (async () => {
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        if (frame.startsWith('data: ')) {
          try {
            const evt = JSON.parse(frame.slice(6))
            events.push(evt)
            const type = evt.type
            const d = evt.data ?? {}
            if (type === 'goal/change' || type === 'todo/write' || type === 'turn/end' || type === 'session/connected') {
              console.log('EVT:', type, JSON.stringify(d).slice(0, 180))
            }
          } catch { /* keepalive */ }
        }
      }
    }
  } catch (e) { /* aborted */ }
})()

// 等 SSE 连接建立，再派活
await new Promise((r) => setTimeout(r, 1000))
const disp = await fetch('http://127.0.0.1:8787/api/agent', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: '帮我做 sqt-tr-analysis', session_id: 'acpt-sse' }),
})
const dispBody = await disp.text()
console.log('DISPATCH status:', disp.status, 'finish:', JSON.parse(dispBody).finish_reason)

await readerPump
clearTimeout(timeout)
console.log('--- total events:', events.length)
const counts = {}
for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1
console.log('--- counts:', JSON.stringify(counts))
process.exit(0)
