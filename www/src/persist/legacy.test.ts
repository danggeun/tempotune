import { describe, test, expect, beforeEach, vi } from 'vitest'
import { clearLegacyStorage } from './legacy.ts'
import { LEGACY_REC_DB } from './recordingsDb.ts'
import { LEGACY_SETTINGS_KEYS } from './settings.ts'
import { SETTINGS_KEY } from './settings.ts'

/** 사용자 데이터를 지우는 코드다. "옛 것만 지우고, 한 번만 돌고, 실패해도 안 죽는다" 를 못 박는다. */
describe('버려진 저장소 청소', () => {
  let store: Record<string, string>
  let deleted: string[]
  beforeEach(() => {
    store = {}
    deleted = []
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    })
    vi.stubGlobal('indexedDB', { deleteDatabase: (n: string) => { deleted.push(n) } })
  })

  test('옛 키와 옛 DB 를 지운다', () => {
    for (const k of LEGACY_SETTINGS_KEYS) store[k] = 'x'
    clearLegacyStorage()
    for (const k of LEGACY_SETTINGS_KEYS) expect(store[k]).toBeUndefined()
    expect(deleted).toEqual([LEGACY_REC_DB])
  })

  test('새 키는 건드리지 않는다', () => {
    store[SETTINGS_KEY] = 'keep-me'
    store['tempotune_rec'] = 'keep-me-too'
    clearLegacyStorage()
    expect(store[SETTINGS_KEY]).toBe('keep-me')
    expect(store['tempotune_rec']).toBe('keep-me-too')
    expect(deleted).not.toContain('tempotune_rec')
  })

  test('두 번째 실행부터는 아무것도 하지 않는다 (매번 IndexedDB 를 열지 않게)', () => {
    clearLegacyStorage()
    expect(deleted.length).toBe(1)
    deleted.length = 0
    clearLegacyStorage()
    expect(deleted).toEqual([])
  })

  test('저장소를 못 쓰는 환경(사생활 보호 모드 등)에서도 예외를 던지지 않는다', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
    expect(() => clearLegacyStorage()).not.toThrow()
  })

  test('IndexedDB 삭제가 실패해도 예외를 던지지 않는다', () => {
    vi.stubGlobal('indexedDB', { deleteDatabase: () => { throw new Error('blocked') } })
    expect(() => clearLegacyStorage()).not.toThrow()
  })
})
