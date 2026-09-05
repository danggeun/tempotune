import { describe, test, expect } from 'vitest'
import { parseStored } from './settings.ts'

describe('parseStored', () => {
  test('empty / broken → {}', () => { expect(parseStored(null)).toEqual({}); expect(parseStored('{oops')).toEqual({}); expect(parseStored('"x"')).toEqual({}) })
  test('v1 format migrates (TTL 무시)', () => {
    const v1 = { cents: 10, rms: .008, smooth: .05, wakelock: false, aimode: true, bpm: 120, timeSig: 3, subDiv: 'd', refHz: 415, vol: .5, savedAt: 0 }
    expect(parseStored(JSON.stringify(v1))).toEqual({ tolCents: 10, rmsMin: .008, smoothing: .06, wakeLock: false, bpm: 120, timeSig: 3, subDiv: 'd', refHz: 415, metroVol: .5 })
  })
  test('v1 unknown rms level ignored', () => expect(parseStored(JSON.stringify({ rms: .5 }))).toEqual({}))
  test('v2 round trip', () => {
    const v2 = { v: 2, tolCents: 5, rmsMin: .014, smoothing: .20, wakeLock: true, bpm: 60, timeSig: 6, subDiv: 1, refHz: 442, metroVol: 1 }
    const { v, ...rest } = v2
    expect(parseStored(JSON.stringify(v2))).toEqual(rest)
  })
  test('v2 rejects bad timeSig', () => expect(parseStored(JSON.stringify({ v: 2, timeSig: 5 }))).toEqual({}))
})

describe('parseStored hardening', () => {
  test('bpm clamped and rounded', () => {
    expect(parseStored(JSON.stringify({ v: 2, bpm: -5 })).bpm).toBe(20)
    expect(parseStored(JSON.stringify({ v: 2, bpm: 999 })).bpm).toBe(220)
    expect(parseStored(JSON.stringify({ bpm: 80.6 })).bpm).toBe(81)
    expect(parseStored(JSON.stringify({ v: 2, bpm: 'x' })).bpm).toBeUndefined()
  })
})
