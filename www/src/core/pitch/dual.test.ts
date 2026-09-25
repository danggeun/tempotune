import { describe, test, expect } from 'vitest'
import { createDual, DEFAULT_DUAL, type DualIn } from './dual.ts'
import { createAnalyzer } from './analyzer.ts'

const A = (lo: number, up: number, dbLo = 0, dbUp = 0): DualIn => ({ lo, up, dbLo, dbUp })

describe('dual: lock and release rules', () => {
  test('locks only after onFrames in a row (-1 before that)', () => {
    const d = createDual()
    for (let i = 1; i < DEFAULT_DUAL.onFrames; i++) expect(d.push(A(294, 440))).toBe(-1)
    expect(d.push(A(294, 440))).toBeCloseTo(294, 0)
  })
  test('doesn’t lock when the level difference exceeds the threshold (resonance)', () => {
    const d = createDual()
    for (let i = 0; i < 30; i++) expect(d.push(A(294, 440, -30, -12))).toBe(-1) // |Δ| 18 dB
  })
  test('threshold boundary: 10 dB passes, 10.5 dB doesn’t', () => {
    const a = createDual(); let on = -1
    for (let i = 0; i < 8; i++) on = a.push(A(294, 440, -20, -10))
    expect(on).toBeGreaterThan(0)
    const b = createDual(); let off = -1
    for (let i = 0; i < 8; i++) off = b.push(A(294, 440, -20.5, -10))
    expect(off).toBe(-1)
  })
  test('after locking, short gaps (bow changes) hold; past offFrames it releases', () => {
    const d = createDual()
    for (let i = 0; i < 8; i++) d.push(A(294, 440))
    for (let i = 0; i < DEFAULT_DUAL.offFrames; i++) expect(d.push(null)).toBeCloseTo(294, 0)
    expect(d.push(null)).toBe(-1)
    expect(d.push(null)).toBe(-1)
  })
  test('after release it needs onFrames again (no leftover state)', () => {
    const d = createDual()
    for (let i = 0; i < 8; i++) d.push(A(294, 440))
    for (let i = 0; i < 10; i++) d.push(null)
    expect(d.push(A(294, 440))).toBe(-1)
  })
  test('when the lower voice moves to another note, the window clears and jumps to the new value', () => {
    const d = createDual()
    for (let i = 0; i < 8; i++) d.push(A(294, 440))
    let v = -1; for (let i = 0; i < 3; i++) v = d.push(A(330, 440)) // 레4 → 미4
    expect(v).toBeCloseTo(330, 0)
  })
  test('not a candidate when the upper note is at or below the lower', () => {
    const d = createDual()
    for (let i = 0; i < 10; i++) expect(d.push(A(440, 294))).toBe(-1)
  })
})

// 분석기 전체를 통과시키는 검증 (합성 현악음)
const SR = 44100, N = 4096
let seed = 11
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000 - .5 }
/** 현악기다운 배음 구조로 음들을 합성 (amp 는 상대 세기) */
function mixTone(parts: Array<[hz: number, amp: number, roll?: number]>, n = N * 20): Float32Array {
  const x = new Float32Array(n)
  for (const [f, amp, roll = 1.1] of parts) {
    for (let i = 0; i < n; i++) {
      const t = i / SR; let s = 0
      for (let k = 1; k <= 16; k++) { if (f * k > SR * .45) break; s += Math.pow(k, -roll) * (k % 2 ? 1 : .8) * Math.sin(2 * Math.PI * f * k * t + k * .7) }
      x[i] = x[i]! + s * amp * .22
    }
  }
  for (let i = 0; i < n; i++) x[i] = x[i]! + rnd() * .004
  return x
}
function run(x: Float32Array): Array<{ midi: number; dualMidi: number; dualCents: number }> {
  const an = createAnalyzer({ sampleRate: SR, windowSize: N }); an.setSettings({ refHz: 440, tolCents: 15, rmsMin: .01 })
  const w = new Float32Array(N), out = []
  for (let s = 0; s + N <= x.length; s += 1024) { w.set(x.subarray(s, s + N)); const f = an.process(w); out.push({ midi: f.hz > 0 ? f.midi : -1, dualMidi: f.dualMidi, dualCents: f.dualCents }) }
  return out
}
const hz = (m: number, c = 0): number => 440 * Math.pow(2, (m - 69) / 12 + c / 1200)

describe('analyzer: double-stop display', () => {
  test('single notes never show as double stops (G3, D4, A4, E5)', () => {
    for (const m of [55, 62, 69, 76]) {
      const fr = run(mixTone([[hz(m), 1]])).filter(f => f.midi >= 0)
      expect(fr.length).toBeGreaterThan(10)
      expect(fr.filter(f => f.dualMidi >= 0).length).toBe(0)
    }
  })
  test('a resonating open string (1/4 to 1/10 level) isn’t a double stop', () => {
    for (const a of [.25, .167, .1]) {
      for (const parts of [[[hz(62), a, 1.6], [hz(69), 1]], [[hz(62), 1], [hz(69), a, 1.6]]] as Array<Array<[number, number, number?]>>) {
        const fr = run(mixTone(parts)).filter(f => f.midi >= 0)
        expect(fr.filter(f => f.dualMidi >= 0).length).toBe(0)
      }
    }
  })
  test('a real double stop shows the upper voice and reports the lower — a lower note played −28 ¢ off reads that way', () => {
    // 라4(−28 ¢) + 도♯5 — v2.0.1 은 도♯5 0 ¢ 초록만 보여줬다(아래 현이 틀린 것을 보증)
    const fr = run(mixTone([[hz(69, -28), 1], [hz(73), 1]])).filter(f => f.midi >= 0)
    const dual = fr.filter(f => f.dualMidi >= 0)
    expect(dual.length / fr.length).toBeGreaterThan(.8)
    expect(dual.every(f => f.midi === 73)).toBe(true)   // 화면 음은 그대로 위 성부
    expect(dual.every(f => f.dualMidi === 69)).toBe(true)
    const med = dual.map(f => f.dualCents).sort((a, b) => a - b)[dual.length >> 1]!
    expect(Math.abs(med - (-28))).toBeLessThanOrEqual(3)
  })
  test('fifths, minor thirds and fourths also read the lower voice correctly', () => {
    for (const [lo, up] of [[62, 69], [69, 72], [69, 74]] as Array<[number, number]>) {
      const dual = run(mixTone([[hz(lo, -20), 1], [hz(up), 1]])).filter(f => f.dualMidi >= 0)
      expect(dual.length).toBeGreaterThan(10)
      expect(dual.every(f => f.dualMidi === lo)).toBe(true)
      const med = dual.map(f => f.dualCents).sort((a, b) => a - b)[dual.length >> 1]!
      expect(Math.abs(med - (-20))).toBeLessThanOrEqual(4)
    }
  })
  test('the double-stop display goes away when the sound stops', () => {
    const x = mixTone([[hz(62), 1], [hz(69), 1]], N * 12)
    const sil = new Float32Array(N * 6)
    const both = new Float32Array(x.length + sil.length); both.set(x); both.set(sil, x.length)
    const fr = run(both)
    expect(fr.slice(-4).every(f => f.dualMidi === -1)).toBe(true)
  })
})
