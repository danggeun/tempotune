import { describe, test, expect } from 'vitest'
import { createTracker } from './tracker.ts'

const A = 0.14
describe('tracker', () => {
  test('locks instantly on confident frame, holds through short dropouts, releases after releaseFrames', () => {
    const t = createTracker()
    expect(t.push(440, 0.95, true, A).midi).toBe(69)
    for (let i = 0; i < 6; i++) expect(t.push(-1, 0, false, A).midi).toBe(69) // 6 misses (≈140 ms) 동안 유지
    expect(t.push(-1, 0, false, A).midi).toBe(-1) // 7 → release
  })
  test('low-confidence needs two frames', () => {
    const t = createTracker()
    expect(t.push(440, 0.6, true, A).midi).toBe(-1)
    expect(t.push(440, 0.6, true, A).midi).toBe(69)
  })
  test('hysteresis: 순간적인 ±60¢ 튐은 음이름을 유지한다 (평활된 표시값이 아직 반음 절반 안)', () => {
    const t = createTracker()
    t.push(440, 0.95, true, A)
    const up60 = 440 * Math.pow(2, 60 / 1200)
    // 3프레임까지는 평활 때문에 표시값이 +40 ¢ 을 넘지 않는다 → 라벨 유지
    for (let i = 0; i < 3; i++) expect(t.push(up60, 0.95, true, A).midi).toBe(69)
  })
  test('hysteresis: 지속적인 +60¢ 는 결국 이웃 음으로 이름이 바뀐다 (그 음이 실제로 더 가깝다) — B14', () => {
    const t = createTracker()
    t.push(440, 0.95, true, A)
    const up60 = 440 * Math.pow(2, 60 / 1200)
    let last = 69
    for (let i = 0; i < 12; i++) last = t.push(up60, 0.95, true, A).midi
    expect(last).toBe(70) // 라♯4 −40 ¢ 으로 보이는 게 맞다. '라4 +60 ¢' 는 가장 가까운 음이 아니다
  })
  test('real change switches within 3 frames', () => {
    const t = createTracker()
    for (let i = 0; i < 6; i++) t.push(440, 0.95, true, A)
    expect(t.push(494, 0.7, true, A).midi).toBe(69) // 중앙값(3)이 아직 이전 음
    expect(t.push(494, 0.7, true, A).midi).toBe(69) // 1st outside frame
    expect(t.push(494, 0.7, true, A).midi).toBe(71) // 2nd → switch to B4 (총 3프레임 ≈ 70 ms)
  })
  test('outlier frame is rejected by weighted median', () => {
    const t = createTracker()
    t.push(440, 0.95, true, A); t.push(440, 0.95, true, A)
    const r = t.push(880, 0.6, true, A) // 한 프레임 옥타브 튐
    expect(r.midi).toBe(69); expect(Math.abs(1200 * Math.log2(r.hz / 440))).toBeLessThan(5)
  })
  test('adaptive smoothing: large step converges within a few frames', () => {
    const t = createTracker(); t.push(440, 0.95, true, A)
    let r = t.push(440, 0.95, true, A)
    for (let i = 0; i < 4; i++) r = t.push(466.16, 0.95, true, A) // +100¢ (A♯4)
    expect(r.midi).toBe(70); expect(Math.abs(1200 * Math.log2(r.hz / 466.16))).toBeLessThan(15)
  })

  test('표시 일관성: cents(= dispA − 라벨 중심)는 항상 ±50 ¢ 안 (B14)', () => {
    // 재현: 한 방향으로 4프레임 이상 움직이면 적응 부스트가 dispA 를 새 음까지 끌어다 놓는데,
    // 라벨은 switchFrames 만큼 기다린다 → 그 사이 화면에 두 음의 간격(100~190 ¢)이 찍혔다.
    const t = createTracker()
    const a = 1200 * Math.log2(440 / 440) // A4 = 0 ¢
    for (let i = 0; i < 20; i++) t.push(440, 0.95, true, 0.12)   // A4 지속
    let worst = 0
    // 레가토로 B4(+200 ¢)까지 한 방향 이동 — 부스트가 걸리는 조건
    for (let i = 1; i <= 12; i++) {
      const cents = a + Math.min(200, i * 25)
      const o = t.push(440 * Math.pow(2, cents / 1200), 0.95, true, 0.12)
      if (o.midi >= 0) worst = Math.max(worst, Math.abs(o.a - (o.midi - 69) * 100))
    }
    expect(worst).toBeLessThanOrEqual(50)
  })

  test('유지(held) 카운트: 끊긴 프레임마다 1씩 올라가고, 새 측정이면 0 (트레이스가 가로줄을 남기지 않게)', () => {
    const t = createTracker()
    for (let i = 0; i < 4; i++) expect(t.push(440, 0.95, true, A).held).toBe(0)
    expect(t.push(-1, 0, false, A).held).toBe(1)
    expect(t.push(-1, 0, false, A).held).toBe(2)
    expect(t.push(440, 0.95, true, A).held).toBe(0) // 다시 잡히면 0
  })
})
