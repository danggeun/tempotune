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
