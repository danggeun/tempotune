// 벤치마크 하네스 자체 검증 — 하네스가 틀리면 모든 숫자가 무의미하므로
import { describe, test, expect } from 'vitest'
import { makeFFT } from './fft.mjs'
import { createV1 } from './adapter-v1.mjs'
import { harmonicRel } from './metrics.mjs'

describe('fft', () => {
  test('matches naive DFT on random input', () => {
    const n = 64, fft = makeFFT(n)
    const x = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + Math.cos(i * 1.1) * 0.5)
    const re = Float32Array.from(x), im = new Float32Array(n); fft.transform(re, im)
    for (let k = 0; k < n; k += 7) {
      let dr = 0, di = 0
      for (let t = 0; t < n; t++) { dr += x[t] * Math.cos(2 * Math.PI * k * t / n); di -= x[t] * Math.sin(2 * Math.PI * k * t / n) }
      expect(re[k]).toBeCloseTo(dr, 3); expect(im[k]).toBeCloseTo(di, 3)
    }
  })
  test('inverse(transform(x)) == x', () => {
    const n = 256, fft = makeFFT(n)
    const x = Float32Array.from({ length: n }, () => Math.random() - .5)
    const re = Float32Array.from(x), im = new Float32Array(n); fft.transform(re, im); fft.inverse(re, im)
    for (let i = 0; i < n; i += 13) expect(re[i]).toBeCloseTo(x[i], 4)
  })
})

describe('adapter-v1', () => {
  test('pure 440 Hz sine → within 0.5 cents after lock', () => {
    const sr = 44100, ad = createV1({ sampleRate: sr }), W = 4096
    const x = Float32Array.from({ length: sr }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / sr))
    let last = null
    for (let end = W; end <= x.length; end += 1024) last = ad.process(x.subarray(end - W, end))
    expect(last.hz).toBeGreaterThan(0)
    expect(Math.abs(1200 * Math.log2(last.hz / 440))).toBeLessThan(0.5)
  })
  test('silence → no note', () => {
    const ad = createV1({ sampleRate: 44100 })
    expect(ad.process(new Float32Array(4096)).hz).toBe(-1)
  })
})

describe('metrics — 배음 관계 판정 (실측 발견 B3)', () => {
  test('정상 오차는 배음 관계가 아니다', () => {
    expect(harmonicRel(440, 440)).toBe(null)
    expect(harmonicRel(445, 440)).toBe(null)      // +20 ¢
    expect(harmonicRel(415.3, 440)).toBe(null)    // −100 ¢ (이웃 반음) — 배음 아님
    expect(harmonicRel(391.99, 440)).toBe(null)   // −200 ¢
  })
  test('옥타브 오류 (양방향)', () => {
    expect(harmonicRel(220, 440)).toBe('÷2')
    expect(harmonicRel(880, 440)).toBe('×2')
  })
  test('이전 하네스가 놓치던 것들', () => {
    expect(harmonicRel(110, 440)).toBe('÷4')      // 2옥타브 — 실제 오류의 29 %
    expect(harmonicRel(440 / 3, 440)).toBe('÷3')  // 옥타브+5도 — 8 %
    expect(harmonicRel(440 / 5, 440)).toBe('÷5')
    expect(harmonicRel(440 * 3, 440)).toBe('×3')
  })
  test('겹친 음의 5도 관계', () => {
    expect(harmonicRel(660, 440)).toBe('×3/2')
    expect(harmonicRel(440 * 2 / 3, 440)).toBe('÷3/2')
  })
  test('경계: 허용치 안쪽은 배음, 바깥은 아님', () => {
    expect(harmonicRel(220 * Math.pow(2, 49 / 1200), 440)).toBe('÷2')   // +49 ¢
    expect(harmonicRel(220 * Math.pow(2, 51 / 1200), 440)).toBe(null)   // +51 ¢
  })
  test('무효 입력', () => {
    expect(harmonicRel(-1, 440)).toBe(null)
    expect(harmonicRel(440, 0)).toBe(null)
  })
})
