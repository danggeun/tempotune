import { describe, test, expect } from 'vitest'
import { histLenFor } from './hist.ts'

describe('histLenFor', () => {
  test('창 길이는 샘플레이트가 달라도 같은 초', () => {
    for (const sr of [44100, 48000, 32000, 96000]) {
      const n = histLenFor(sr, 4.0)
      expect(n * 1024 / sr).toBeCloseTo(4.0, 1)
    }
  })
  test('v2.0.1 의 360 프레임이 실제로 몇 초였는지 (회귀 기록)', () => {
    expect(360 * 1024 / 48000).toBeCloseTo(7.68, 2)
    expect(360 * 1024 / 44100).toBeCloseTo(8.36, 2)
  })
  test('4초 창은 48 kHz 에서 188 프레임 — 예전 360 의 절반 (밀도도 같이 내려간다)', () => {
    expect(histLenFor(48000, 4.0)).toBe(188)
    expect(histLenFor(44100, 4.0)).toBe(172)
  })
  test('이상한 샘플레이트는 44100 으로 폴백, 하한 8', () => {
    expect(histLenFor(0, 4)).toBe(histLenFor(44100, 4))
    expect(histLenFor(NaN, 4)).toBe(histLenFor(44100, 4))
    expect(histLenFor(48000, 0.0001)).toBe(8)
  })
})
