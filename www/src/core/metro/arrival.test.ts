import { describe, test, expect } from 'vitest'
import { createArrival, DEFAULT_ARRIVAL } from './arrival.ts'
import { createSequencer, CLICK_DUR_S } from './sequencer.ts'
import { createAnalyzer } from '../pitch/analyzer.ts'

// 순수 추정기
describe('arrival: 후보 합의 규칙', () => {
  function feed(a: ReturnType<typeof createArrival>, at: number, spikeAt: number | null): void {
    // 예상 시각 근처 0.4 초의 블록 에너지: 바닥 1e-6, 스파이크(있으면) 1e-3
    for (let t = at - 0.06; t <= at + 0.34; t += 0.005) a.pushEnergy(t, spikeAt !== null && Math.abs(t - spikeAt) < 0.004 ? 1e-3 : 1e-6)
    a.expect(at); a.update(at + 0.4)
  }
  test('합의 전에는 0 — 후보 2개로는 적용하지 않는다', () => {
    const a = createArrival(); feed(a, 1, 1.1); feed(a, 2, 2.1)
    expect(a.offset()).toBe(0); expect(a.diag().applied).toBe(false)
  })
  test('minAgree 개가 ±agreeTol 안에 모이면 그 중앙값을 적용한다', () => {
    const a = createArrival(); feed(a, 1, 1.10); feed(a, 2, 2.11); feed(a, 3, 3.09)
    expect(a.diag().applied).toBe(true); expect(a.offset()).toBeCloseTo(0.10, 2)
  })
  test('못 찾은 박(연주 중·이어폰)은 보정을 밀어내지 않는다', () => {
    const a = createArrival(); feed(a, 1, 1.1); feed(a, 2, 2.1); feed(a, 3, 3.1)
    for (let k = 4; k < 20; k++) feed(a, k, null)
    expect(a.offset()).toBeCloseTo(0.10, 2)
  })
  test('흩어진 후보(가짜 스파이크)로는 적용하지 않는다', () => {
    const a = createArrival(); feed(a, 1, 1.02); feed(a, 2, 2.12); feed(a, 3, 3.25); feed(a, 4, 4.19)
    expect(a.diag().applied).toBe(false); expect(a.offset()).toBe(0)
  })
  test('범위 밖(300 ms 초과)은 버린다', () => {
    const a = createArrival({ ...DEFAULT_ARRIVAL, searchAfter: 0.5 }); feed(a, 1, 1.4); feed(a, 2, 2.4); feed(a, 3, 3.4)
    expect(a.diag().applied).toBe(false)
  })
  test('도드라지지 않는 스파이크(중앙값의 minProminence 배 미만)는 후보가 아니다', () => {
    const a = createArrival()
    for (let k = 1; k <= 4; k++) { for (let t = k - 0.06; t <= k + 0.34; t += 0.005) a.pushEnergy(t, Math.abs(t - (k + 0.1)) < 0.004 ? 3e-6 : 1e-6); a.expect(k); a.update(k + 0.4) }
    expect(a.diag().candidates.length).toBe(0)
  })
})

// 앱과 같은 흐름 (클릭 렌더 → 방 → 워커 규칙 → 분석기)
const SR = 48000, WIN = 4096, CH = 1024, BLK = 256
function renderMetro(sec: number, bpm = 80) {
  const seq = createSequencer(SR, { bpm, timeSig: 4, subDiv: 1, volume: 1, muted: false }); seq.start(0)
  const n = Math.ceil(sec * SR), buf = new Float32Array(n), out = new Float32Array(128), marks: Array<{ sample: number }> = []
  for (let s = 0; s < n; s += 128) { out.fill(0); for (const ev of seq.render(out, s)) marks.push(ev); buf.set(out.subarray(0, Math.min(128, n - s)), s) }
  return { buf, marks }
}
/** 스피커→공기→마이크: 감쇠 + 지연 + 짧은 잔향 */
function room(x: Float32Array, att: number, delayS: number): Float32Array {
  const d = Math.round(delayS * SR), y = new Float32Array(x.length); for (let i = d; i < x.length; i++) y[i] = x[i - d]! * att
  const g = Math.exp(-1 / (0.12 * SR)); let acc = 0; for (let i = 0; i < y.length; i++) { acc = acc * g + y[i]! * 0.15; y[i] = y[i]! + acc }
  return y
}
/** 워커와 같은 규칙. outLat = 앱이 아는 출력 지연, calib = 보정 사용 여부 */
function pipeline(sig: Float32Array, marks: Array<{ sample: number }>, outLat: number, calib: boolean) {
  const an = createAnalyzer({ sampleRate: SR, windowSize: WIN }); an.setSettings({ rmsMin: .005, smoothing: .12, refHz: 442, tolCents: 15 })
  const arr = createArrival(), mutes: Array<{ from: number; until: number }> = []; let mi = 0
  const ring = new Float32Array(WIN * 4); let rp = 0, filled = 0; const win = new Float32Array(WIN)
  const out: Array<{ t: number; midi: number; off: number }> = []
  for (let s = 0; s + CH <= sig.length; s += CH) {
    const t = (s + CH) / SR
    while (mi < marks.length && marks[mi]!.sample / SR <= t) { const at = marks[mi]!.sample / SR + outLat; mutes.push({ from: at - 0.01, until: at + CLICK_DUR_S + 0.06 }); arr.expect(at); mi++ }
    let prev = s > 0 ? sig[s - 1]! : 0
    for (let b = 0; b < CH; b += BLK) { let e = 0; for (let i = 0; i < BLK; i++) { const v = sig[s + b + i]!; const d = v - prev; e += d * d; prev = v } arr.pushEnergy((s + b + BLK) / SR, e / BLK) }
    for (let i = 0; i < CH; i++) { ring[rp] = sig[s + i]!; rp = (rp + 1) % ring.length } filled = Math.min(ring.length, filled + CH); if (filled < WIN) continue
    arr.update(t); const off = calib ? arr.offset() : 0
    const t0 = t - WIN / SR; let muted = false
    for (let i = mutes.length - 1; i >= 0; i--) { const r = mutes[i]!; if (r.until + off < t0 - 1) mutes.splice(i, 1); else if (t0 < r.until + off && t > r.from + off) muted = true }
    let src = (rp - WIN + ring.length) % ring.length; for (let i = 0; i < WIN; i++) { win[i] = ring[src]!; src = (src + 1) % ring.length }
    const f = an.process(win, muted); out.push({ t, midi: f.hz > 0 ? f.midi : -1, off })
  }
  return out
}
const shownAfter = (o: ReturnType<typeof pipeline>, t: number) => o.filter(f => f.t > t && f.midi >= 0).length

describe('메트로놈 클릭 도착 시각 자가 보정 (앱과 같은 흐름)', () => {
  const { buf, marks } = renderMetro(8)
  test.each([[0.08], [0.12], [0.20]])('입력 지연 오차 +%s s: 보정 없으면 정박마다 음이 뜨고, 보정하면 수렴 뒤 0 이다', (err) => {
    const sig = room(buf, 0.1, 0.03 + err) // 앱은 outLat 0.03 만 안다
    const without = pipeline(sig, marks, 0.03, false), withCal = pipeline(sig, marks, 0.03, true)
    expect(shownAfter(without, 3)).toBeGreaterThan(0)       // 재현: 클릭 음(라6)이 뜬다
    expect(shownAfter(withCal, 3)).toBe(0)                  // 수렴(3박 ≈ 2.3초) 뒤에는 0
    expect(Math.abs(withCal[withCal.length - 1]!.off - err)).toBeLessThan(0.012) // 추정이 실제 오차와 12 ms 안에서 맞는다
  })
  test('오차 0 인 기기: 보정값이 0 근처에 머물고 동작이 변하지 않는다', () => {
    const sig = room(buf, 0.1, 0.03)
    const without = pipeline(sig, marks, 0.03, false), withCal = pipeline(sig, marks, 0.03, true)
    expect(Math.abs(withCal[withCal.length - 1]!.off)).toBeLessThan(0.012)
    expect(withCal.map(f => f.midi).join()).toBe(without.map(f => f.midi).join())
  })
  test('이어폰(클릭이 마이크에 안 들어옴): 보정이 켜지지 않는다', () => {
    const silence = new Float32Array(buf.length)
    let seed = 3; for (let i = 0; i < silence.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; silence[i] = (seed / 0x100000000 - 0.5) * 0.002 }
    const r = pipeline(silence, marks, 0.03, true)
    expect(r[r.length - 1]!.off).toBe(0)
  })
})

describe('pending 상한', () => {
  test('update 가 오지 않아도 64개를 넘지 않는다', () => {
    const a = createArrival()
    for (let i = 0; i < 100; i++) a.expect(i * 0.75)
    expect(a.pendingCount()).toBe(64)
  })
})
