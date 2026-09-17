import { describe, test, expect } from 'vitest'
import { fmtHz, createHzReadout } from './hzReadout.ts'

describe('Hz 읽기표시 — 자리 고정', () => {
  test('값이 2·3·4자리여도 전체 길이가 같다 (Hz 가 안 움직인다)', () => {
    const rows = [fmtHz(65.4), fmtHz(196), fmtHz(442.31), fmtHz(1046.5)]
    expect(rows).toEqual(['  65.4 Hz', ' 196.0 Hz', ' 442.3 Hz', '1046.5 Hz'])
    expect(new Set(rows.map(r => r.length)).size).toBe(1)
  })
  test('무음·비정상은 빈 문자열', () => {
    expect(fmtHz(-1)).toBe(''); expect(fmtHz(0)).toBe(''); expect(fmtHz(NaN)).toBe('')
  })
})

describe('Hz 읽기표시 — 흔들림 억제', () => {
  test('새 음은 평활 없이 즉시, 그 뒤엔 100 ms 에 한 번만 갱신', () => {
    const r = createHzReadout({ alpha: 0.35, everyMs: 100 })
    expect(r.push(440, 69, 0)).toBe(' 440.0 Hz')
    expect(r.push(441, 69, 30)).toBeNull()   // 너무 이르다
    expect(r.push(441, 69, 60)).toBeNull()
    const t = r.push(441, 69, 100)           // 100 ms 지남 — 평활된 값
    expect(t).not.toBeNull(); expect(t!.trim()).toMatch(/^440\.\d Hz$/)
  })
  test('같은 값이면 다시 쓰지 않는다 (DOM 안 건드림)', () => {
    const r = createHzReadout({ everyMs: 0 })
    expect(r.push(440, 69, 0)).toBe(' 440.0 Hz')
    expect(r.push(440, 69, 1)).toBeNull()
  })
  test('음이 바뀌면 이전 값에서 미끄러지지 않고 바로 새 값', () => {
    const r = createHzReadout({ alpha: 0.1, everyMs: 0 })
    r.push(440, 69, 0)
    expect(r.push(659.3, 76, 1)).toBe(' 659.3 Hz') // 라→미: 평활이 남았으면 462 쯤이 나왔을 것
  })
  test('무음이면 즉시 비우고, 비어 있는 동안 반복 호출은 null', () => {
    const r = createHzReadout()
    r.push(440, 69, 0)
    expect(r.push(-1, -1, 10)).toBe('')
    expect(r.push(-1, -1, 20)).toBeNull()
    expect(r.push(440, 69, 30)).toBe(' 440.0 Hz') // 다시 소리 — 지연 없이
  })
})
