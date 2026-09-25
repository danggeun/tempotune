import { describe, test, expect } from 'vitest'
import { joinSegment, buildSegments, TRACE_JOIN_MAX, keepInTrace, TRACE_HELD_MAX } from './trace.ts'

describe('joinSegment', () => {
  test('connects any movement within the same note (glissandos and boost jumps are real movement)', () => {
    expect(joinSegment(-48, 49, 69, 69)).toBe(true)
    expect(joinSegment(0, 40, 69, 69)).toBe(true)
  })
  test('connects note changes in an in-tune scale — measured Δ mean 22 ¢, max 31 ¢', () => {
    expect(joinSegment(3, -4, 69, 71)).toBe(true)   // Δ7
    expect(joinSegment(12, -10, 62, 64)).toBe(true) // Δ22
    expect(joinSegment(-20, 11, 66, 64)).toBe(true) // Δ31 (실측 최댓값)
  })
  test('breaks note changes with a big jump in error — connecting would draw a fake "in tune" across the band', () => {
    expect(joinSegment(-40, 45, 69, 71)).toBe(false) // Δ85
    expect(joinSegment(48, -45, 69, 67)).toBe(false) // Δ93
  })
  test('connects across note changes when consistently off on the same side (consistently flat is information too)', () => {
    expect(joinSegment(-35, -38, 69, 71)).toBe(true) // Δ3
  })
  test('threshold boundary', () => {
    expect(joinSegment(0, TRACE_JOIN_MAX, 69, 71)).toBe(true)
    expect(joinSegment(0, TRACE_JOIN_MAX + 1, 69, 71)).toBe(false)
  })
})

describe('buildSegments', () => {
  const seg = (c: Array<number | null>, m: Array<number | null>) => buildSegments(c, m).segs
  const brk = (c: Array<number | null>, m: Array<number | null>) => buildSegments(c, m).breaks
  test('all frames within one note are connected', () => {
    expect(seg([1, 2, 3, 4], [69, 69, 69, 69])).toEqual([[0, 1], [1, 2], [2, 3]])
  })
  test('drops the frame right before a note change (window spanning two notes) and connects around it — measured +21 ¢ artifact', () => {
    // 실제 분석기 출력: −2 −2 −1 +21 | −3 −3 −2  (전환 @1.90 s, 64→66)
    const c = [-2, -2, -1, 21, -3, -3, -2], m = [64, 64, 64, 64, 66, 66, 66]
    const s = seg(c, m)
    expect(s.some(([, j]) => j === 3)).toBe(false)   // 튄 프레임은 그리지 않는다
    expect(s.some(([i, j]) => i === 2 && j === 4)).toBe(true) // −1 → −3 이 직접 이어진다
  })
  test('still breaks when the error is large after dropping (no fake crossing line)', () => {
    const c = [-40, -40, 10, 45, 45], m = [69, 69, 69, 71, 71]
    expect(seg(c, m).some(([i, j]) => i === 1 && j === 3)).toBe(false) // Δ85 → 끊김
    expect(brk(c, m)).toBe(1)
  })
  test('breaks at silence (null)', () => {
    expect(seg([1, null, 2], [69, null, 69])).toEqual([])
  })
  test('also drops the frame before the sound stops — the window spanning sound and silence jumped up to +47 ¢ (measured)', () => {
    const c = [4, 5, 4, 5, 47, null, null], m = [62, 62, 62, 62, 62, null, null]
    const s = seg(c, m)
    expect(s.some(([, j]) => j === 4)).toBe(false)     // +47 프레임은 그리지 않는다
    expect(s[s.length - 1]).toEqual([2, 3])
  })
  test('also drops the first frame of a sound (window spans silence and sound)', () => {
    const c = [null, 30, 3, 3, 3], m = [null, 69, 69, 69, 69]
    const s = seg(c, m)
    expect(s.some(([i]) => i === 1)).toBe(false)
    expect(s[0]).toEqual([2, 3])
  })
  test('drops only one frame per note even in a fast trill (6 frames per note)', () => {
    const c: number[] = [], m: number[] = []
    for (let k = 0; k < 4; k++) for (let i = 0; i < 6; i++) { c.push(i === 5 ? 20 : 2); m.push(k % 2 ? 69 : 71) }
    const s = seg(c, m)
    expect(s.length).toBeGreaterThan(15)  // 대부분 이어진다
    expect(s.length).toBeLessThan(c.length - 1) // 전환마다 1프레임씩 빠진다
  })
})


describe('keepInTrace — how many held frames are allowed', () => {
  test('silence isn’t added', () => { expect(keepInTrace(-1, 0)).toBe(false) })
  test('a fresh measurement is added', () => { expect(keepInTrace(440, 0)).toBe(true) })
  test('a short hold like a bow change (≤ TRACE_HELD_MAX) is connected', () => {
    for (let h = 1; h <= TRACE_HELD_MAX; h++) expect(keepInTrace(440, h)).toBe(true)
  })
  test('the tail after the sound ends (held up to releaseFrames 6) is left empty', () => {
    for (let h = TRACE_HELD_MAX + 1; h <= 6; h++) expect(keepInTrace(440, h)).toBe(false)
  })
  test('TRACE_HELD_MAX is 2 — 46 ms. Measured staccato coverage went 69 % → 86 % with this value', () => { expect(TRACE_HELD_MAX).toBe(2) })
})
