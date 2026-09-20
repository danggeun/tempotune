import { describe, test, expect } from 'vitest'
import { parseStored } from './settings.ts'
import { RMS_LEVELS } from '../state/index.ts'

describe('parseStored', () => {
  test('empty / broken → {}', () => { expect(parseStored(null)).toEqual({}); expect(parseStored('{oops')).toEqual({}); expect(parseStored('"x"')).toEqual({}) })
  // 픽스처는 **진짜 v1(main.js) 값**이어야 한다. 이전 픽스처는 rms 에 v2 값(.008)을 써서 v1 매핑 결함을 덮지 못했다 (B8)
  test('v1 format migrates (TTL 무시)', () => {
    const v1 = { cents: 10, rms: .005, smooth: .05, wakelock: false, aimode: true, bpm: 120, timeSig: 3, subDiv: 'd', refHz: 415, vol: .5, savedAt: 0 }
    expect(parseStored(JSON.stringify(v1))).toEqual({ tolCents: 10, rmsMin: RMS_LEVELS[2], smoothing: .06, wakeLock: false, bpm: 120, timeSig: 3, subDiv: 'd', refHz: 415, metroVol: .5 })
  })
  // 감도는 **숫자가 아니라 사용자가 고른 단계**를 옮긴다. 값은 v2.0.2 에서 전 단계가 내려갔다 (약음기)
  test('v1(.015/.010/.005) 감도가 같은 단계로 옮겨진다', () => {
    expect(parseStored(JSON.stringify({ rms: .015 })).rmsMin).toBe(RMS_LEVELS[0]) // 낮음
    expect(parseStored(JSON.stringify({ rms: .010 })).rmsMin).toBe(RMS_LEVELS[1]) // 보통
    expect(parseStored(JSON.stringify({ rms: .005 })).rmsMin).toBe(RMS_LEVELS[2]) // 높음
  })
  test('v2.0.1(.024/.014/.008) 감도도 같은 단계로 옮겨진다 — 숫자가 아니라 단계가 유지된다', () => {
    expect(parseStored(JSON.stringify({ v: 2, rmsMin: .024 })).rmsMin).toBe(RMS_LEVELS[0])
    expect(parseStored(JSON.stringify({ v: 2, rmsMin: .014 })).rmsMin).toBe(RMS_LEVELS[1])
    expect(parseStored(JSON.stringify({ v: 2, rmsMin: .008 })).rmsMin).toBe(RMS_LEVELS[2])
  })
  test('v1 키와 v2 키는 값 범위가 겹치므로 키로 구분한다 (.005 = v1 높음 / v2.0.2 보통)', () => {
    expect(parseStored(JSON.stringify({ rms: .005 })).rmsMin).toBe(RMS_LEVELS[2])        // v1 키 → 높음
    expect(parseStored(JSON.stringify({ v: 2, rmsMin: .005 })).rmsMin).toBe(RMS_LEVELS[1]) // v2 키 → 보통
  })
  test('현재 값은 그대로 통과', () => {
    for (const v of RMS_LEVELS) expect(parseStored(JSON.stringify({ v: 2, rmsMin: v })).rmsMin).toBe(v)
  })
  test('v1 unknown rms level ignored', () => expect(parseStored(JSON.stringify({ rms: .5 }))).toEqual({}))
  test('v2 round trip', () => {
    const v2 = { v: 2, tolCents: 5, rmsMin: RMS_LEVELS[1], smoothing: .20, wakeLock: true, bpm: 60, timeSig: 6, subDiv: 1, refHz: 442, metroVol: 1 }
    const { v, ...rest } = v2
    expect(parseStored(JSON.stringify(v2))).toEqual(rest)
  })
  test('v2 rejects bad timeSig', () => expect(parseStored(JSON.stringify({ v: 2, timeSig: 5 }))).toEqual({}))
})

describe('parseStored hardening', () => {
  test('bpm clamped and rounded', () => {
    // 범위는 CFG.metro (v2.3.2 M7: 40~200). 옛 저장값이 범위 밖이면 여기서 끌어들인다
    expect(parseStored(JSON.stringify({ v: 2, bpm: -5 })).bpm).toBe(40)
    expect(parseStored(JSON.stringify({ v: 2, bpm: 999 })).bpm).toBe(200)
    expect(parseStored(JSON.stringify({ v: 2, bpm: 20 })).bpm).toBe(40) // 옛 범위(20~220)로 저장된 값도 새 범위로 끌어들인다
    expect(parseStored(JSON.stringify({ v: 2, bpm: 220 })).bpm).toBe(200)
    expect(parseStored(JSON.stringify({ bpm: 80.6 })).bpm).toBe(81)
    expect(parseStored(JSON.stringify({ v: 2, bpm: 'x' })).bpm).toBeUndefined()
  })
})
