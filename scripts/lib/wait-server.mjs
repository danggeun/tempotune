// 서버가 실제로 응답할 때까지 기다린다 — npx 가 serve 를 처음 내려받는 환경에서는 고정 대기가 짧다
export async function waitForServer(url, timeoutMs = 90000, everyMs = 250) {
  const t0 = Date.now()
  for (;;) {
    try { const r = await fetch(url, { method: 'HEAD' }); if (r.status < 500) return } catch { /* 아직 안 뜸 */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`서버가 ${Math.round(timeoutMs / 1000)}초 안에 뜨지 않았다: ${url}`)
    await new Promise(r => setTimeout(r, everyMs))
  }
}
