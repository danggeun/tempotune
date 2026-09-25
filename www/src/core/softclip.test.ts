import { describe, test, expect } from 'vitest'
import { softClip, softClipCurve, SOFT_KNEE } from './softclip.ts'

describe('softClip', () => {
  test('identity below the knee — the existing tone is unchanged', () => {
    for (const x of [0, .1, .3, .5, .69, SOFT_KNEE, -.5, -SOFT_KNEE]) expect(softClip(x)).toBe(x)
  })
  test('compressed above the knee but always |y| < 1 (no hard clipping)', () => {
    for (const x of [.75, .9, 1, 1.3, 2, 8, -1.5]) { const y = softClip(x); expect(Math.abs(y)).toBeLessThan(1); expect(Math.abs(y)).toBeGreaterThan(SOFT_KNEE) }
  })
  test('monotonic and continuous at the knee (no audible seam)', () => {
    let prev = -1
    for (let x = -2; x <= 2; x += 0.001) { const y = softClip(x); expect(y).toBeGreaterThanOrEqual(prev - 1e-12); prev = y }
    expect(softClip(SOFT_KNEE + 1e-6)).toBeCloseTo(SOFT_KNEE, 5)
  })
  test('odd function (symmetric) — no DC offset', () => {
    for (const x of [.3, .8, 1.2]) expect(softClip(-x)).toBeCloseTo(-softClip(x), 12)
  })
  test('curve: ends within −1..1, length matches', () => {
    const c = softClipCurve(1024)
    expect(c.length).toBe(1024)
    expect(c[0]!).toBeGreaterThan(-1); expect(c[1023]!).toBeLessThan(1)
  })
})
