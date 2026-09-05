// 벤치마크 하네스 자체 검증 — 하네스가 틀리면 모든 숫자가 무의미하므로
import { describe, test, expect } from 'vitest'
import { makeFFT } from './fft.mjs'
import { createV1 } from './adapter-v1.mjs'

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
