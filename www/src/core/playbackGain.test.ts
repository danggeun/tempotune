import { describe, test, expect } from 'vitest'
import { playbackGain, TARGET_PEAK, MAX_GAIN, LEGACY_GAIN } from './playbackGain.ts'

describe('playbackGain', () => {
  test('피크 정보가 없는 옛 녹음 → 기본 부스트 (리미터가 뒤를 받는다)', () => {
    for (const p of [undefined, 0, -1, NaN, Infinity]) expect(playbackGain(p as number | undefined)).toBe(LEGACY_GAIN)
  })
  test('조용한 녹음을 목표 피크까지 올린다 (상한 안에서)', () => {
    expect(playbackGain(0.2)).toBeCloseTo(TARGET_PEAK / 0.2, 6)
    expect(playbackGain(0.2) * 0.2).toBeCloseTo(TARGET_PEAK, 6)
  })
  test('이미 큰 녹음은 건드리지 않는다', () => {
    expect(playbackGain(TARGET_PEAK)).toBe(1)
    expect(playbackGain(1)).toBe(1)
  })
  test('상한이 있다 — 마이크 잡음 바닥을 끌어올리지 않게', () => {
    expect(playbackGain(1e-4)).toBe(MAX_GAIN)
  })
  test('−20 dBFS 피크(보면대 옆 바이올린)는 상한(+18 dB)에 걸려 −1.9 dBFS 까지 올라간다', () => {
    const g = playbackGain(0.1) // −20 dBFS
    expect(g).toBe(MAX_GAIN)
    expect(20 * Math.log10(g)).toBeCloseTo(18.06, 1)
    expect(20 * Math.log10(g * 0.1)).toBeCloseTo(-1.94, 1) // 목표 −1 dBFS 에 조금 못 미침 — 상한이 우선
  })
})
