// 서버가 **실제로 응답할 때까지** 기다린다. 고정 대기(2.5초)는 npx 가 serve 를 처음 내려받는 환경
// (윈도우 콜드 캐시)에서 짧아, 앞 시나리오들이 ERR_CONNECTION_REFUSED 로 무더기 실패했다(2026-09-16 실제 발생).
// 넘기면 원인이 바로 보이는 한 줄로 죽는다 — "5개 실패" 가 아니라 "서버가 안 떴다".
export async function waitForServer(url, timeoutMs = 90000, everyMs = 250) {
  const t0 = Date.now()
  for (;;) {
    try { const r = await fetch(url, { method: 'HEAD' }); if (r.status < 500) return } catch { /* 아직 안 뜸 */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`서버가 ${Math.round(timeoutMs / 1000)}초 안에 뜨지 않았다: ${url}`)
    await new Promise(r => setTimeout(r, everyMs))
  }
}
