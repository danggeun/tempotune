import { describe, test, expect } from 'vitest'
import { createAnalyzer } from './analyzer.ts'

const sr = 44100, N = 4096
const tone = (f: number, harm = 4) => Float32Array.from({ length: N }, (_, i) => { let s = 0; for (let h = 1; h <= harm; h++) s += Math.sin(2 * Math.PI * f * h * i / sr) / h; return 0.3 * s })

/** 같은 창을 여러 번 넣어 트래커가 음이름을 확정하게 한 뒤 마지막 프레임 */
function settle(refHz: number, playedHz: number) {
  const an = createAnalyzer({ sampleRate: sr, windowSize: N }); an.setSettings({ refHz, tolCents: 15, rmsMin: .008 })
  let f = an.process(tone(playedHz)); for (let i = 0; i < 12; i++) f = an.process(tone(playedHz)); return f
}

describe('analyzer: 기준음(refHz) 보정', () => {
  // 리뷰에서 잡은 결함: 트래커 격자가 A=440 이라 |오프셋| > 50 ¢ (바로크 415, 466) 에서 이웃 반음으로 라벨링됐다
  test.each([[442, 442], [440, 440], [432, 432], [425, 425], [415, 415], [466, 466], [410, 410]])('refHz=%i 에서 그 주파수는 라4 0 ¢', (ref, hz) => {
    const f = settle(ref, hz)
    expect(f.midi).toBe(69); expect(Math.abs(f.cents)).toBeLessThanOrEqual(2); expect(f.inTune).toBe(true)
    expect(Math.abs(1200 * Math.log2(f.hz / hz))).toBeLessThan(3) // 표시 주파수는 실제 값으로 되돌려진다
  })
  test('refHz=415 에서 A 현을 440 으로 켜면 라4 +102 ¢ 가 아니라 라♯4 근처 (+2 ¢)', () => {
    const f = settle(415, 440)
    expect(f.midi).toBe(70); expect(Math.abs(f.cents)).toBeLessThanOrEqual(3)
  })
  test('refHz=442 에서 440 은 라4 −8 ¢ (in-tune ±15)', () => {
    const f = settle(442, 440)
    expect(f.midi).toBe(69); expect(f.cents).toBe(-8); expect(f.inTune).toBe(true)
  })
  test('첼로 C2 (65.4 Hz) 는 refHz 와 무관하게 도2', () => {
    for (const ref of [415, 442, 466]) { const f = settle(ref, 65.41 * ref / 440); expect(f.midi).toBe(36) }
  })
})

describe('스펙트럼 정합 페널티 (실측 발견 B2)', () => {
  /** 두 음이 겹친 신호 — 가상 기본음이 생기는 상황을 합성으로 재현 */
  function doubleStop(sr: number, n: number, f1: number, f2: number): Float32Array {
    const x = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / sr
      // 각 음은 기본음 + 배음 몇 개 (현악기처럼)
      for (const [f, a] of [[f1, .5], [f2, .5]] as const)
        for (let k = 1; k <= 5; k++) x[i] = x[i]! + a / k * Math.sin(2 * Math.PI * f * k * t)
    }
    return x
  }

  test('겹친 음에서 연주하지 않은 낮은 음을 표시하지 않는다', () => {
    const sr = 48000, N = 4096
    const a = createAnalyzer({ sampleRate: sr })
    a.setSettings({ rmsMin: .014, smoothing: .14, refHz: 440, tolCents: 15 })
    // A4(440) + E5(659.26) — 완전5도. 가상 기본음은 약 220 Hz(A3) 자리에 생길 수 있다.
    const x = doubleStop(sr, sr, 440, 659.26)
    const shown: number[] = []
    for (let end = N; end <= x.length; end += 1024) shown.push(a.process(x.subarray(end - N, end)).hz)
    const last = shown.slice(-10).filter(h => h > 0)
    // 표시된 값이 있다면 실제로 연주한 두 음 중 하나여야 한다 (그 아래 옥타브가 아니라)
    for (const h of last) expect(h).toBeGreaterThan(400)
  })

  test('★ 감지기(연주 시간)는 페널티의 영향을 받지 않는다 — 순수 단음에서도 겹친 음에서도', () => {
    const sr = 48000, N = 4096
    // 페널티가 감지기 경로에 새면 이 값이 달라진다. 두 신호 모두에서 연주로 판정되어야 한다.
    for (const x of [
      Float32Array.from({ length: sr }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 440 * i / sr) + 0.2 * Math.sin(2 * Math.PI * 880 * i / sr)),
      doubleStop(sr, sr, 440, 659.26),
    ]) {
      const a = createAnalyzer({ sampleRate: sr })
      a.setSettings({ rmsMin: .014, smoothing: .14, refHz: 440, tolCents: 15 })
      let playingFrames = 0, total = 0
      for (let end = N; end <= x.length; end += 1024) { total++; if (a.process(x.subarray(end - N, end)).playing) playingFrames++ }
      expect(playingFrames / total).toBeGreaterThan(0.6) // 연주 중인 신호는 연주로 잡혀야 한다
    }
  })

  test('정상 단음은 페널티에 걸리지 않는다', () => {
    const sr = 48000, N = 4096
    const a = createAnalyzer({ sampleRate: sr })
    a.setSettings({ rmsMin: .014, smoothing: .14, refHz: 440, tolCents: 15 })
    const x = Float32Array.from({ length: sr }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 440 * i / sr) + 0.15 * Math.sin(2 * Math.PI * 880 * i / sr))
    let last = -1
    for (let end = N; end <= x.length; end += 1024) last = a.process(x.subarray(end - N, end)).hz
    expect(Math.abs(1200 * Math.log2(last / 440))).toBeLessThan(5)
  })
})
