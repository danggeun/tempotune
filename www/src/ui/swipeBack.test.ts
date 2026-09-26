import { describe, test, expect } from 'vitest'
import { commitsBack } from './swipeBack.ts'

const W = 390

describe('commitsBack: edge swipe closes or springs back', () => {
  test('past 35 % of the width closes, however slow', () => {
    expect(commitsBack(W * 0.36, W, 0, 500)).toBe(true)
    expect(commitsBack(W * 0.34, W, 0, 500)).toBe(false)
  })
  test('a flick closes early: still moving fast when lifted', () => {
    expect(commitsBack(80, W, 1.2, 8)).toBe(true)
  })
  test('a fast drag that stopped before lifting springs back', () => {
    expect(commitsBack(80, W, 1.2, 40)).toBe(false)
    expect(commitsBack(80, W, 1.2, 150)).toBe(false)
  })
  test('too short or too slow to be a flick', () => {
    expect(commitsBack(40, W, 2, 8)).toBe(false)
    expect(commitsBack(80, W, 0.5, 8)).toBe(false)
  })
})
