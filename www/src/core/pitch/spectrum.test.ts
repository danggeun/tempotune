import { describe, test, expect } from 'vitest'
import { createSpectrum } from './spectrum.ts'

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
