import { describe, test, expect } from 'vitest'
import { computePeaks, peakOf } from './peaks.ts'
describe('computePeaks', () => {
  test('normalizes to 1 and follows the envelope', () => {
    const x = Float32Array.from({ length: 6000 }, (_, i) => (i < 3000 ? 0.1 : 0.5) * Math.sin(i))
    const p = computePeaks([x], 6)
    expect(Math.max(...p)).toBe(1); expect(p[0]!).toBeLessThan(0.3); expect(p[5]!).toBeGreaterThan(0.9)
  })
  // D1: 샘플 수가 bins 보다 적으면(짧은 녹음) 빈 구간이 0 으로 남아 파형이 빗살처럼 보이던 문제
  test('fewer samples than bins → no empty bins', () => {
    for (const len of [100, 200, 400, 600, 1200]) {
      const x = Float32Array.from({ length: len }, (_, i) => 0.1 + (i % 13) * 0.05)
      const p = computePeaks([x], 600)
      expect(Array.from(p).filter(v => v === 0).length).toBe(0)
      let max = 0; for (const v of p) if (v > max) max = v
      expect(max).toBeCloseTo(1, 6)
    }
  })
  test('one sample → all bins carry it', () => {
    const p = computePeaks([Float32Array.of(0.4)], 4)
    expect(Array.from(p)).toEqual([1, 1, 1, 1])
  })
  test('empty input → zeros', () => expect(Array.from(computePeaks([], 4))).toEqual([0, 0, 0, 0]))
})
describe('peakOf', () => {
  test('clamps the maximum to 1', () => { expect(peakOf([0.1, 0.9, 0.3])).toBeCloseTo(0.9); expect(peakOf([0.4, 2])).toBe(1); expect(peakOf([])).toBe(0) })
  // D4: 60분 녹음(20개/초 × 3600초 = 72,000개)에서 Math.max(...arr) 는 인자 개수 한계로 던질 수 있다
  test('doesn’t throw with 72,000 samples', () => {
    const big = Array.from({ length: 72000 }, (_, i) => (i === 50000 ? 0.77 : 0.1))
    expect(peakOf(big)).toBeCloseTo(0.77)
  })
})
