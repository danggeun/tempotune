import { describe, test, expect } from 'vitest'
import { parseStored } from './settings.ts'
import { RMS_LEVELS } from '../state/index.ts'

describe('parseStored', () => {
  test('empty / broken → {}', () => { expect(parseStored(null)).toEqual({}); expect(parseStored('{oops')).toEqual({}); expect(parseStored('"x"')).toEqual({}) })
  // 픽스처는 실제 v1 값이어야 한다
  test('v1 format migrates (TTL ignored)', () => {
    const v1 = { cents: 10, rms: .005, smooth: .05, wakelock: false, aimode: true, bpm: 120, timeSig: 3, subDiv: 'd', refHz: 415, vol: .5, savedAt: 0 }
    expect(parseStored(JSON.stringify(v1))).toEqual({ tolCents: 10, rmsMin: RMS_LEVELS[2], smoothing: .06, wakeLock: false, bpm: 120, timeSig: 3, subDiv: 'd', refHz: 415, metroVol: .5 })
  })
  // 감도는 숫자가 아니라 단계 인덱스로 옮긴다
  test('v1 (.015/.010/.005) sensitivity maps to the same step', () => {
    expect(parseStored(JSON.stringify({ rms: .015 })).rmsMin).toBe(RMS_LEVELS[0]) // 낮음
    expect(parseStored(JSON.stringify({ rms: .010 })).rmsMin).toBe(RMS_LEVELS[1]) // 보통
    expect(parseStored(JSON.stringify({ rms: .005 })).rmsMin).toBe(RMS_LEVELS[2]) // 높음
  })
  test('v2.0.1 (.024/.014/.008) sensitivity maps to the same step — the step is kept, not the number', () => {
    expect(parseStored(JSON.stringify({ v: 2, rmsMin: .024 })).rmsMin).toBe(RMS_LEVELS[0])
    expect(parseStored(JSON.stringify({ v: 2, rmsMin: .014 })).rmsMin).toBe(RMS_LEVELS[1])
    expect(parseStored(JSON.stringify({ v: 2, rmsMin: .008 })).rmsMin).toBe(RMS_LEVELS[2])
  })
  test('v1 and v2 keys overlap in range, so the key decides (.005 = v1 high / v2.0.2 normal)', () => {
    expect(parseStored(JSON.stringify({ rms: .005 })).rmsMin).toBe(RMS_LEVELS[2])        // v1 키 → 높음
    expect(parseStored(JSON.stringify({ v: 2, rmsMin: .005 })).rmsMin).toBe(RMS_LEVELS[1]) // v2 키 → 보통
  })
  test('current values pass through', () => {
    for (const v of RMS_LEVELS) expect(parseStored(JSON.stringify({ v: 2, rmsMin: v })).rmsMin).toBe(v)
  })
  test('v1 unknown rms level ignored', () => expect(parseStored(JSON.stringify({ rms: .5 }))).toEqual({}))
  test('v2 round trip', () => {
    const v2 = { v: 2, tolCents: 5, rmsMin: RMS_LEVELS[1], smoothing: .20, wakeLock: true, bpm: 60, timeSig: 6, subDiv: 1, refHz: 442, metroVol: 1 }
    const { v, ...rest } = v2
    expect(parseStored(JSON.stringify(v2))).toEqual(rest)
  })
  test('v2 rejects bad timeSig', () => expect(parseStored(JSON.stringify({ v: 2, timeSig: 5 }))).toEqual({}))
  test('theme: only dark/light pass, anything else is ignored (the default applies)', () => {
    expect(parseStored(JSON.stringify({ v: 2, theme: 'light' })).theme).toBe('light')
    expect(parseStored(JSON.stringify({ v: 2, theme: 'dark' })).theme).toBe('dark')
    expect(parseStored(JSON.stringify({ v: 2, theme: 'auto' }))).toEqual({})
  })
  test('language: only ko/en pass, anything else is ignored (Korean by default)', () => {
    expect(parseStored(JSON.stringify({ v: 2, lang: 'en' })).lang).toBe('en')
    expect(parseStored(JSON.stringify({ v: 2, lang: 'ko' })).lang).toBe('ko')
    expect(parseStored(JSON.stringify({ v: 2, lang: 'fr' }))).toEqual({})
  })
  test('Play A octave: only 2/3/4 pass (A2 double bass, A3 cello, A4 violin/viola), anything else keeps A4', () => {
    for (const v of [2, 3, 4] as const) expect(parseStored(JSON.stringify({ v: 2, aOctave: v })).aOctave).toBe(v)
    for (const v of [1, 5, '3', null, 3.5]) expect(parseStored(JSON.stringify({ v: 2, aOctave: v }))).toEqual({})
  })
})

describe('parseStored hardening', () => {
  test('bpm clamped and rounded', () => {
    // 범위 밖 저장값은 CFG.metro 범위로 끌어들인다
    expect(parseStored(JSON.stringify({ v: 2, bpm: -5 })).bpm).toBe(40)
    expect(parseStored(JSON.stringify({ v: 2, bpm: 999 })).bpm).toBe(200)
    expect(parseStored(JSON.stringify({ v: 2, bpm: 20 })).bpm).toBe(40) // 옛 범위(20~220)로 저장된 값도 새 범위로 끌어들인다
    expect(parseStored(JSON.stringify({ v: 2, bpm: 220 })).bpm).toBe(200)
    expect(parseStored(JSON.stringify({ bpm: 80.6 })).bpm).toBe(81)
    expect(parseStored(JSON.stringify({ v: 2, bpm: 'x' })).bpm).toBeUndefined()
  })
  // 6/8 은 세분이 없다
  test('6/8 normalizes subDiv to 1 (v1 and v2)', () => {
    expect(parseStored(JSON.stringify({ v: 2, timeSig: 6, subDiv: 'd' }))).toMatchObject({ timeSig: 6, subDiv: 1 })
    expect(parseStored(JSON.stringify({ timeSig: 6, subDiv: 2, savedAt: 0 }))).toMatchObject({ timeSig: 6, subDiv: 1 })
    expect(parseStored(JSON.stringify({ v: 2, timeSig: 4, subDiv: 3 }))).toMatchObject({ timeSig: 4, subDiv: 3 })
  })
})
