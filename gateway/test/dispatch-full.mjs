// 完整派活验收：sqt-strategy 真实推进 → 状态回写 done + 产物扫描
const r = await fetch('http://127.0.0.1:8787/api/agent', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: '帮我做 sqt-strategy SQT策略分析', session_id: 'acpt-full' }),
})
const t = await r.text()
console.log('STATUS:', r.status)
const body = JSON.parse(t)
console.log('finish_reason:', body.finish_reason)
console.log('stage:', body.stage)
console.log('final_response (head):', body.final_response?.slice(0, 300))
console.log('artifacts:', JSON.stringify(body.artifacts))
console.log('error:', body.error)
