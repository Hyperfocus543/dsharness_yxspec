// SSE 客户端测试：订阅事件流，触发一次派活，打印收到的 SSE 事件。
const EVENTS_URL = 'http://127.0.0.1:8787/api/events?session_id=bcm-sse-test'
const res = await fetch(EVENTS_URL)
console.log('SSE status:', res.status)
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
const events = []
const deadline = Date.now() + 30_000

const trigger = (async () => {
  await new Promise((r) => setTimeout(r, 500))
  const r = await fetch('http://127.0.0.1:8787/api/agent', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '帮我做 sqt-tr-analysis', session_id: 'bcm-sse-test' }),
  })
  console.log('dispatch status:', r.status)
  const t = await r.text()
  console.log('dispatch body:', t.slice(0, 300))
})()

try {
  while (Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise((r) => setTimeout(() => r({ done: true }), deadline - Date.now())),
    ])
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      if (frame.startsWith('data: ')) {
        const payload = frame.slice(6)
        try {
          const evt = JSON.parse(payload)
          events.push(evt)
          console.log('EVT:', JSON.stringify(evt).slice(0, 200))
        } catch { /* keepalive */ }
      }
    }
  }
} finally {
  await trigger
  console.log('--- total events:', events.length)
  process.exit(0)
}
