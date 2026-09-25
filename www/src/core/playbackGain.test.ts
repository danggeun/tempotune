import { describe, test, expect } from 'vitest'
import { playbackGain, TARGET_PEAK, MAX_GAIN, LEGACY_GAIN } from './playbackGain.ts'

describe('playbackGain', () => {
  test('old recording without peak info → default boost (the limiter catches the rest)', () => {
    for (const p of [undefined, 0, -1, NaN, Infinity]) expect(playbackGain(p as number | undefined)).toBe(LEGACY_GAIN)
  })
  test('raises a quiet recording to the target peak (within the cap)', () => {
    expect(playbackGain(0.2)).toBeCloseTo(TARGET_PEAK / 0.2, 6)
    expect(playbackGain(0.2) * 0.2).toBeCloseTo(TARGET_PEAK, 6)
  })
  test('leaves loud recordings alone', () => {
    expect(playbackGain(TARGET_PEAK)).toBe(1)
    expect(playbackGain(1)).toBe(1)
  })
  test('there’s a cap — so the mic noise floor isn’t raised', () => {
    expect(playbackGain(1e-4)).toBe(MAX_GAIN)
  })
  test('a −20 dBFS peak (violin next to the stand) hits the +18 dB cap and reaches −1.9 dBFS', () => {
    const g = playbackGain(0.1) // −20 dBFS
    expect(g).toBe(MAX_GAIN)
    expect(20 * Math.log10(g)).toBeCloseTo(18.06, 1)
    expect(20 * Math.log10(g * 0.1)).toBeCloseTo(-1.94, 1) // 목표 −1 dBFS 에 조금 못 미침 — 상한이 우선
  })
})
