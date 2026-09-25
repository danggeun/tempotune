import { describe, test, expect } from 'vitest'
import { evictIndex } from './toast.ts'

describe('evictIndex — which toast goes when there are too many', () => {
  test('oldest one without an action first', () => {
    expect(evictIndex([true, false, false])).toBe(1)
    expect(evictIndex([false, true, true])).toBe(0)
  })
  test('oldest one when all have actions', () => expect(evictIndex([true, true, true])).toBe(0))
  test('empty list', () => expect(evictIndex([])).toBe(-1))
})
