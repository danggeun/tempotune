import { describe, test, expect } from 'vitest'
import { fmtHz, createHzReadout } from './hzReadout.ts'

describe('Hz readout — fixed width', () => {
  test('2-, 3- and 4-digit values have the same length (Hz doesn’t move)', () => {
    const rows = [fmtHz(65.4), fmtHz(196), fmtHz(442.31), fmtHz(1046.5)]
    expect(rows).toEqual(['  65.4 Hz', ' 196.0 Hz', ' 442.3 Hz', '1046.5 Hz'])
    expect(new Set(rows.map(r => r.length)).size).toBe(1)
  })
  test('silence and invalid values give an empty string', () => {
    expect(fmtHz(-1)).toBe(''); expect(fmtHz(0)).toBe(''); expect(fmtHz(NaN)).toBe('')
  })
})

describe('Hz readout — jitter control', () => {
  test('a new note shows immediately without smoothing, then updates once per 100 ms', () => {
    const r = createHzReadout({ alpha: 0.35, everyMs: 100 })
    expect(r.push(440, 69, 0)).toBe(' 440.0 Hz')
    expect(r.push(441, 69, 30)).toBeNull()   // 너무 이르다
    expect(r.push(441, 69, 60)).toBeNull()
    const t = r.push(441, 69, 100)           // 100 ms 지남 — 평활된 값
    expect(t).not.toBeNull(); expect(t!.trim()).toMatch(/^440\.\d Hz$/)
  })
  test('the same value isn’t written again (no DOM touch)', () => {
    const r = createHzReadout({ everyMs: 0 })
    expect(r.push(440, 69, 0)).toBe(' 440.0 Hz')
    expect(r.push(440, 69, 1)).toBeNull()
  })
  test('a note change jumps straight to the new value without gliding', () => {
    const r = createHzReadout({ alpha: 0.1, everyMs: 0 })
    r.push(440, 69, 0)
    expect(r.push(659.3, 76, 1)).toBe(' 659.3 Hz') // 라→미: 평활이 남았으면 462 쯤이 나왔을 것
  })
  test('silence clears immediately; repeated calls while empty return null', () => {
    const r = createHzReadout()
    r.push(440, 69, 0)
    expect(r.push(-1, -1, 10)).toBe('')
    expect(r.push(-1, -1, 20)).toBeNull()
    expect(r.push(440, 69, 30)).toBe(' 440.0 Hz') // 다시 소리 — 지연 없이
  })
})
