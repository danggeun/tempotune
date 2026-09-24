import { describe, test, expect } from 'vitest'
import { joinSegment, buildSegments, TRACE_JOIN_MAX, keepInTrace, TRACE_HELD_MAX } from './trace.ts'

describe('joinSegment', () => {
  test('같은 음 안에서는 아무리 크게 움직여도 잇는다 (글리산도·부스트 점프는 실제 움직임)', () => {
    expect(joinSegment(-48, 49, 69, 69)).toBe(true)
    expect(joinSegment(0, 40, 69, 69)).toBe(true)
  })
  test('정확히 짚은 스케일의 전환은 잇는다 — 실측 전환 Δ 평균 22 ¢ · 최대 31 ¢', () => {
    expect(joinSegment(3, -4, 69, 71)).toBe(true)   // Δ7
    expect(joinSegment(12, -10, 62, 64)).toBe(true) // Δ22
    expect(joinSegment(-20, 11, 66, 64)).toBe(true) // Δ31 (실측 최댓값)
  })
  test('오차가 크게 튀는 전환은 끊는다 — 이으면 초록 띠를 가로질러 없던 "맞음"을 그린다', () => {
    expect(joinSegment(-40, 45, 69, 71)).toBe(false) // Δ85
    expect(joinSegment(48, -45, 69, 67)).toBe(false) // Δ93
  })
  test('같은 쪽으로 계속 벗어나 있으면 음이 바뀌어도 잇는다 (일관되게 낮게 짚은 것도 정보다)', () => {
    expect(joinSegment(-35, -38, 69, 71)).toBe(true) // Δ3
  })
  test('임계 경계', () => {
    expect(joinSegment(0, TRACE_JOIN_MAX, 69, 71)).toBe(true)
    expect(joinSegment(0, TRACE_JOIN_MAX + 1, 69, 71)).toBe(false)
  })
})

describe('buildSegments', () => {
  const seg = (c: Array<number | null>, m: Array<number | null>) => buildSegments(c, m).segs
  const brk = (c: Array<number | null>, m: Array<number | null>) => buildSegments(c, m).breaks
  test('한 음 안에서는 모든 프레임이 이어진다', () => {
    expect(seg([1, 2, 3, 4], [69, 69, 69, 69])).toEqual([[0, 1], [1, 2], [2, 3]])
  })
  test('음이 바뀌기 직전 프레임(창이 두 음에 걸친 프레임)은 버리고 앞뒤를 잇는다 — 실측 +21 ¢ 아티팩트', () => {
    // 실제 분석기 출력: −2 −2 −1 +21 | −3 −3 −2  (전환 @1.90 s, 64→66)
    const c = [-2, -2, -1, 21, -3, -3, -2], m = [64, 64, 64, 64, 66, 66, 66]
    const s = seg(c, m)
    expect(s.some(([, j]) => j === 3)).toBe(false)   // 튄 프레임은 그리지 않는다
    expect(s.some(([i, j]) => i === 2 && j === 4)).toBe(true) // −1 → −3 이 직접 이어진다
  })
  test('버린 뒤에도 오차가 크면 끊는다 (가짜 통과선 방지)', () => {
    const c = [-40, -40, 10, 45, 45], m = [69, 69, 69, 71, 71]
    expect(seg(c, m).some(([i, j]) => i === 1 && j === 3)).toBe(false) // Δ85 → 끊김
    expect(brk(c, m)).toBe(1)
  })
  test('무음(null)에서 끊긴다', () => {
    expect(seg([1, null, 2], [69, null, 69])).toEqual([])
  })
  test('소리가 꺼지는 직전 프레임도 버린다 — 창이 소리/무음에 걸쳐 +47 ¢ 까지 튀었다 (실측)', () => {
    const c = [4, 5, 4, 5, 47, null, null], m = [62, 62, 62, 62, 62, null, null]
    const s = seg(c, m)
    expect(s.some(([, j]) => j === 4)).toBe(false)     // +47 프레임은 그리지 않는다
    expect(s[s.length - 1]).toEqual([2, 3])
  })
  test('소리가 시작되는 첫 프레임도 버린다 (창이 무음/소리에 걸친다)', () => {
    const c = [null, 30, 3, 3, 3], m = [null, 69, 69, 69, 69]
    const s = seg(c, m)
    expect(s.some(([i]) => i === 1)).toBe(false)
    expect(s[0]).toEqual([2, 3])
  })
  test('빠른 트릴(음당 6프레임)에서도 음당 하나만 버린다', () => {
    const c: number[] = [], m: number[] = []
    for (let k = 0; k < 4; k++) for (let i = 0; i < 6; i++) { c.push(i === 5 ? 20 : 2); m.push(k % 2 ? 69 : 71) }
    const s = seg(c, m)
    expect(s.length).toBeGreaterThan(15)  // 대부분 이어진다
    expect(s.length).toBeLessThan(c.length - 1) // 전환마다 1프레임씩 빠진다
  })
})


describe('keepInTrace — 유지 프레임 허용 폭', () => {
  test('무음은 안 쌓는다', () => { expect(keepInTrace(-1, 0)).toBe(false) })
  test('방금 측정한 값은 쌓는다', () => { expect(keepInTrace(440, 0)).toBe(true) })
  test('활 바꿈 수준의 짧은 유지(≤ TRACE_HELD_MAX)는 잇는다', () => {
    for (let h = 1; h <= TRACE_HELD_MAX; h++) expect(keepInTrace(440, h)).toBe(true)
  })
  test('소리가 끝난 뒤 꼬리(releaseFrames 6 까지 이어지는 유지)는 비운다', () => {
    for (let h = TRACE_HELD_MAX + 1; h <= 6; h++) expect(keepInTrace(440, h)).toBe(false)
  })
  test('TRACE_HELD_MAX 는 2 — 46 ms. 스타카토 실측 69 % → 86 % 가 이 값에서 나왔다', () => { expect(TRACE_HELD_MAX).toBe(2) })
})
