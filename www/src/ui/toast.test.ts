import { describe, test, expect } from 'vitest'
import { evictIndex } from './toast.ts'

describe('evictIndex — 토스트가 넘칠 때 무엇을 내보내는가', () => {
  test('액션 없는 가장 오래된 것부터', () => {
    expect(evictIndex([true, false, false])).toBe(1)
    expect(evictIndex([false, true, true])).toBe(0)
  })
  test('전부 액션이면 가장 오래된 것', () => expect(evictIndex([true, true, true])).toBe(0))
  test('빈 목록', () => expect(evictIndex([])).toBe(-1))
})
