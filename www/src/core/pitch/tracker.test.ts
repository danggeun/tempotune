import { describe, test, expect } from 'vitest'
import { createTracker } from './tracker.ts'

const A = 0.14
describe('tracker', () => {
  test('locks instantly on confident frame, holds through short dropouts, releases after releaseFrames', () => {
    const t = createTracker()
    expect(t.push(440, 0.95, true, A).midi).toBe(69)
    expect(t.push(-1, 0, false, A).midi).toBe(69) // 1 miss
    expect(t.push(-1, 0, false, A).midi).toBe(69) // 2 miss
    expect(t.push(-1, 0, false, A).midi).toBe(-1) // 3 → release
  })
  test('low-confidence needs two frames', () => {
    const t = createTracker()
    expect(t.push(440, 0.6, true, A).midi).toBe(-1)
    expect(t.push(440, 0.6, true, A).midi).toBe(69)
  })
  test('hysteresis: ±65¢ wobble keeps the note, real change switches within 3 frames', () => {
    const t = createTracker()
    t.push(440, 0.95, true, A)
    const up60 = 440 * Math.pow(2, 60 / 1200)
    for (let i = 0; i < 5; i++) expect(t.push(up60, 0.95, true, A).midi).toBe(69)
    expect(t.push(494, 0.7, true, A).midi).toBe(69) // 중앙값(3)이 아직 이전 음
    expect(t.push(494, 0.7, true, A).midi).toBe(69) // 1st outside frame
    expect(t.push(494, 0.7, true, A).midi).toBe(71) // 2nd → switch to B4 (총 3프레임 ≈ 70 ms)
  })
  test('outlier frame is rejected by weighted median', () => {
    const t = createTracker()
    t.push(440, 0.95, true, A); t.push(440, 0.95, true, A)
    const r = t.push(880, 0.6, true, A) // 한 프레임 옥타브 튐
    expect(r.midi).toBe(69); expect(Math.abs(1200 * Math.log2(r.hz / 440))).toBeLessThan(5)
  })
  test('adaptive smoothing: large step converges within a few frames', () => {
    const t = createTracker(); t.push(440, 0.95, true, A)
    let r = t.push(440, 0.95, true, A)
    for (let i = 0; i < 4; i++) r = t.push(466.16, 0.95, true, A) // +100¢ (A♯4)
    expect(r.midi).toBe(70); expect(Math.abs(1200 * Math.log2(r.hz / 466.16))).toBeLessThan(15)
  })
})
