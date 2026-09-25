import { describe, test, expect, beforeEach, vi } from 'vitest'
import { clearLegacyStorage } from './legacy.ts'
import { LEGACY_REC_DB } from './recordingsDb.ts'
import { LEGACY_SETTINGS_KEYS } from './settings.ts'
import { SETTINGS_KEY } from './settings.ts'

/** 사용자 데이터를 지우는 코드다. "옛 것만 지우고, 한 번만 돌고, 실패해도 안 죽는다" 를 못 박는다. */
describe('cleaning up abandoned storage', () => {
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

  test('removes old keys and the old DB', () => {
    for (const k of LEGACY_SETTINGS_KEYS) store[k] = 'x'
    clearLegacyStorage()
    for (const k of LEGACY_SETTINGS_KEYS) expect(store[k]).toBeUndefined()
    expect(deleted).toEqual([LEGACY_REC_DB])
  })

  test('leaves the new keys alone', () => {
    store[SETTINGS_KEY] = 'keep-me'
    store['tempotune_rec'] = 'keep-me-too'
    clearLegacyStorage()
    expect(store[SETTINGS_KEY]).toBe('keep-me')
    expect(store['tempotune_rec']).toBe('keep-me-too')
    expect(deleted).not.toContain('tempotune_rec')
  })

  test('does nothing from the second launch on (doesn’t open IndexedDB every time)', () => {
    clearLegacyStorage()
    expect(deleted.length).toBe(1)
    deleted.length = 0
    clearLegacyStorage()
    expect(deleted).toEqual([])
  })

  test('doesn’t throw where storage is unavailable (private mode etc.)', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
    expect(() => clearLegacyStorage()).not.toThrow()
  })

  test('doesn’t throw when deleting IndexedDB fails', () => {
    vi.stubGlobal('indexedDB', { deleteDatabase: () => { throw new Error('blocked') } })
    expect(() => clearLegacyStorage()).not.toThrow()
  })
})
