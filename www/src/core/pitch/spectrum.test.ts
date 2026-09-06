import { describe, test, expect } from 'vitest'
import { createSpectrum } from './spectrum.ts'
import { createYinFast } from './yinFast.ts'
import { createAnalyzer } from './analyzer.ts'

const sr = 44100, N = 4096
const tone = (f: number, harm = 1, amp = (h: number) => 1 / h) => Float32Array.from({ length: N }, (_, i) => { let s = 0; for (let h = 1; h <= harm; h++) s += amp(h) * Math.sin(2 * Math.PI * f * h * i / sr); return 0.3 * s })
let seed = 3; const noise = Float32Array.from({ length: N }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return 0.3 * (seed / 0x80000000 - 1) })

describe('spectrum', () => {
  const sp = createSpectrum(N)
  test('harmonic count: 6-harmonic tone ≥ 5, sine = 1, noise ≈ 0', () => {
    sp.update(tone(220, 6), sr); expect(sp.harmonicCount(220)).toBeGreaterThanOrEqual(5)
    sp.update(tone(440, 1), sr); expect(sp.harmonicCount(440)).toBe(1)
    sp.update(noise, sr); expect(sp.harmonicCount(440)).toBeLessThanOrEqual(1)
  })
  test('flatness: tone low, noise high', () => {
    sp.update(tone(220, 6), sr); const ft = sp.flatness()
    sp.update(noise, sr); const fn = sp.flatness()
    expect(ft).toBeLessThan(0.1); expect(fn).toBeGreaterThan(0.3)
  })
  test('octaveCorrect: keeps correct f0, fixes sub-octave error, fixes double error', () => {
    sp.update(tone(220, 8), sr)
    expect(sp.octaveCorrect(220)).toBeCloseTo(220, 5)
    expect(sp.octaveCorrect(440)).toBeCloseTo(220, 5) // YIN 이 한 옥타브 위를 냈을 때 (기본음 220 존재)
    // 기본음이 약한 소리(짝수 배음만) → 110 으로 내려가면 안 됨: 110 의 홀수 배음(110, 330..) 없음
    expect(sp.octaveCorrect(220)).toBeCloseTo(220, 5)
    sp.update(tone(110, 8, h => h % 2 === 0 ? 0 : 1 / h), sr) // 홀수 배음만 (클라리넷풍) → f0=110
    expect(sp.octaveCorrect(110)).toBeCloseTo(110, 5)
  })
})

describe('중음(더블스톱) 해석 — 실측 발견 B1', () => {
  const SR = 48000, WN = 4096
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const mi = (n: string) => { const m = /^([A-G]#?)(-?\d)$/.exec(n)!; return NOTE.indexOf(m[1]!) + (+m[2]! + 1) * 12 }
  const fq = (n: string) => 440 * Math.pow(2, (mi(n) - 69) / 12)
  /** 현악기다운 배음 구조(1/k 감쇠 + 홀짝 변조)로 한 음을 더한다 */
  function add(buf: Float32Array, f: number, amp: number): void {
    for (let i = 0; i < buf.length; i++) {
      const t = i / SR; let s = 0
      for (let k = 1; k <= 10; k++) { if (f * k > SR / 2) break; s += (amp / k) * (k % 2 ? 1 : 0.7) * Math.sin(2 * Math.PI * f * k * t + k * 0.7) }
      buf[i] = buf[i]! + s
    }
  }
  /** 두 음을 겹쳐 정상상태 한 창을 만든다 */
  function frame(a: string, b: string): Float32Array {
    const x = new Float32Array(SR); add(x, fq(a), 0.45); add(x, fq(b), 0.45)
    return x.subarray(SR - WN) as Float32Array
  }

  // 두 음이 겹치면 합성 신호의 주기가 두 주파수의 최대공약수에서 생겨, YIN 은 연주되지 않은
  // '가상 기본음' 을 높은 신뢰도로 낸다. 완전5도 → 아래 음의 한 옥타브 밑, 장3도 → 두 옥타브 밑 등.
  // octaveCorrect 는 그 배수 자리를 조사해 실제로 울리는 음으로 되돌려야 한다.
  const PAIRS: [string, string][] = [
    ['G3', 'D4'], ['D4', 'A4'], ['A4', 'E5'],   // 완전5도 (개방현 조합)
    ['G3', 'B3'], ['A3', 'C#4'], ['D4', 'F#4'], // 장3도
    ['G3', 'E4'], ['A3', 'F#4'],                // 장6도
    ['E4', 'A4'], ['G4', 'C5'],                 // 완전4도
    ['D4', 'D5'], ['A4', 'A5'],                 // 옥타브
  ]
  test.each(PAIRS)('%s + %s → 연주하지 않은 음을 내지 않는다', (a, b) => {
    const sp = createSpectrum(WN)
    const w = frame(a, b)
    sp.update(w, SR)
    const yin = createYinFast(WN, { threshold: 0.10, hzMin: 40, hzMax: 4200 })
    const y = yin.process(w, SR)
    expect(y.hz).toBeGreaterThan(0)
    const out = sp.octaveCorrect(y.hz)
    const m = 12 * Math.log2(out / 440) + 69
    // 실제로 울리는 두 음 중 하나여야 한다
    const hit = Math.abs(m - mi(a)) < 0.6 || Math.abs(m - mi(b)) < 0.6
    expect(hit).toBe(true)
  })

  test('단음은 그대로 둔다 (기본음이 약한 저음현 포함)', () => {
    for (const [n, weak] of [['A4', false], ['C2', false], ['C2', true], ['G3', true]] as const) {
      const sp = createSpectrum(WN)
      const x = new Float32Array(SR)
      add(x, fq(n), 0.5)
      if (weak) { // 기본음만 깎아 'missing fundamental' 을 만든다
        const f = fq(n)
        for (let i = 0; i < x.length; i++) x[i] = x[i]! - 0.42 * Math.sin(2 * Math.PI * f * i / SR + 0.7)
      }
      const w = x.subarray(SR - WN) as Float32Array
      sp.update(w, SR)
      const y = createYinFast(WN, { threshold: 0.10, hzMin: 40, hzMax: 4200 }).process(w, SR)
      const out = sp.octaveCorrect(y.hz)
      const cents = Math.abs(1200 * Math.log2(out / fq(n)))
      expect(cents).toBeLessThan(60)
    }
  })
})

describe('중음에서 멜로디(위 성부)를 따라간다 — 음량·시차와 무관', () => {
  const SR = 48000, N = 4096, HOP = 1024
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const mi = (n: string) => { const m = /^([A-G]#?)(-?\d)$/.exec(n)!; return NOTE.indexOf(m[1]!) + (+m[2]! + 1) * 12 }
  const fq = (n: string) => 440 * Math.pow(2, (mi(n) - 69) / 12)
  let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - .5 }
  /** 두 음을 겹친 1.2 초 — 아래 음 배율(lowGain), 위 음 시작 지연(stagger), 활 잡음(noise) */
  function ds(a: string, b: string, lowGain = 1, stagger = 0, noise = 0.02): Float32Array {
    const n = Math.floor(SR * 1.2), x = new Float32Array(n), fa = fq(a), fb = fq(b)
    for (let i = 0; i < n; i++) { const t = i / SR
      const va = 0.45 * lowGain * (1 + 0.15 * Math.sin(2 * Math.PI * 5.3 * t)), vb = t < stagger ? 0 : 0.45 * (1 + 0.15 * Math.sin(2 * Math.PI * 6.1 * t + 1))
      let s = 0
      for (let k = 1; k <= 10; k++) { if (fa * k < SR / 2) s += (va / k) * (k % 2 ? 1 : .7) * Math.sin(2 * Math.PI * fa * k * t + k * .7)
                                       if (fb * k < SR / 2) s += (vb / k) * (k % 2 ? 1 : .7) * Math.sin(2 * Math.PI * fb * k * t + k * .3) }
      x[i] = s * .4 + rnd() * noise }
    return x
  }
  /** 정착 후 프레임 중 위 성부가 표시된 비율 */
  function upperRate(x: Float32Array, upper: string, skipSec: number): number {
    const an = createAnalyzer({ sampleRate: SR }); an.setSettings({ rmsMin: .014, smoothing: .14, refHz: 440, tolCents: 15 })
    const w = new Float32Array(N); let U = 0, F = 0
    for (let end = HOP; end <= x.length; end += HOP) { w.fill(0); const s0 = Math.max(0, end - N); w.set(x.subarray(s0, end), N - (end - s0))
      const f = an.process(w); if (end / SR < skipSec) continue; F++; if (f.midi === mi(upper)) U++ }
    return U / F
  }
  const PAIRS: [string, string][] = [['G3', 'D4'], ['D4', 'A4'], ['A4', 'E5'], ['G3', 'B3'], ['D4', 'F#4'], ['G3', 'E4'], ['A3', 'C#4'], ['E4', 'A4']]
  test.each(PAIRS)('%s + %s — 아래 음이 6배 커도(개방현 공명) 위 성부 표시', (a, b) => {
    expect(upperRate(ds(a, b, 6), b, .35)).toBeGreaterThan(0.95)
  })
  test.each(PAIRS)('%s + %s — 아래 음이 먼저 시작해도 위 성부 표시', (a, b) => {
    expect(upperRate(ds(a, b, 3, 0.3), b, .65)).toBeGreaterThan(0.95)
  })
  test('한 중음이 지속되는 동안 라벨이 흔들리지 않는다', () => {
    const an = createAnalyzer({ sampleRate: SR }); an.setSettings({ rmsMin: .014, smoothing: .14, refHz: 440, tolCents: 15 })
    const x = ds('D4', 'A4', 3), w = new Float32Array(N); let last = -1, sw = 0
    for (let end = HOP; end <= x.length; end += HOP) { w.fill(0); const s0 = Math.max(0, end - N); w.set(x.subarray(s0, end), N - (end - s0))
      const f = an.process(w); if (end / SR < .35) continue; if (last >= 0 && f.midi !== last) sw++; last = f.midi }
    expect(sw).toBe(0)
  })
})
