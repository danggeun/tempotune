import { describe, test, expect } from 'vitest'
import { computePeaks } from './peaks.ts'
describe('computePeaks', () => {
  test('normalizes to 1 and follows the envelope', () => {
    const x = Float32Array.from({ length: 6000 }, (_, i) => (i < 3000 ? 0.1 : 0.5) * Math.sin(i))
    const p = computePeaks([x], 6)
    expect(Math.max(...p)).toBe(1); expect(p[0]!).toBeLessThan(0.3); expect(p[5]!).toBeGreaterThan(0.9)
  })
  test('empty input → zeros', () => expect(Array.from(computePeaks([], 4))).toEqual([0, 0, 0, 0]))
})
