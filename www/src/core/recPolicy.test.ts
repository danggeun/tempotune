import { describe, test, expect } from 'vitest'
import { expires, warnDaysLeft, REC_TTL } from './recPolicy.ts'

const NOW = 1_800_000_000_000
const day = 86400000

describe('expires', () => {
  test('31일 지난 미보관 항목은 삭제 대상', () => expect(expires(NOW - REC_TTL - day, false, true, NOW)).toBe(true))
  test('보관 중이면 삭제하지 않는다', () => expect(expires(NOW - REC_TTL - day, true, true, NOW)).toBe(false))
  test('자동 삭제가 꺼져 있으면 삭제하지 않는다', () => expect(expires(NOW - REC_TTL - day, false, false, NOW)).toBe(false))
  test('아직 30일이 안 됐으면 삭제하지 않는다', () => expect(expires(NOW - 29 * day, false, true, NOW)).toBe(false))
  test('ts 없는 구버전 행은 보관', () => expect(expires(undefined, false, true, NOW)).toBe(false))
})

describe('warnDaysLeft', () => {
  test('마지막 7일 경계 — 6일 남으면 예고, 7일 남으면 조용히', () => {
    expect(warnDaysLeft(NOW - 24 * day, false, true, NOW)).toBe(6)
    expect(warnDaysLeft(NOW - 23 * day, false, true, NOW)).toBe(null)
  })
  test('3일 남음', () => expect(warnDaysLeft(NOW - 27 * day, false, true, NOW)).toBe(3))
  test('오늘 삭제', () => expect(warnDaysLeft(NOW - 30 * day + 1000, false, true, NOW)).toBe(0))
  test('8일 남으면 조용히', () => expect(warnDaysLeft(NOW - 22 * day, false, true, NOW)).toBe(null))
  test('보관 중이면 예고 없음', () => expect(warnDaysLeft(NOW - 27 * day, true, true, NOW)).toBe(null))
  test('자동 삭제 꺼짐이면 예고 없음', () => expect(warnDaysLeft(NOW - 27 * day, false, false, NOW)).toBe(null))
})
