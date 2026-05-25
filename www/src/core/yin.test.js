import { describe, test, expect } from 'vitest'
import { yin } from './yin.js'

describe('yin', () => {
  test('returns -1 for silence', () => {
    const buf = new Float32Array(4096)
    expect(yin(buf, 44100)).toBe(-1)
  })

  test('detects 440 Hz sine wave within 2 Hz', () => {
    const buf = new Float32Array(4096)
    for (let i = 0; i < 4096; i++) buf[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 44100)
    const freq = yin(buf, 44100)
    expect(freq).toBeGreaterThan(438)
    expect(freq).toBeLessThan(442)
  })

  test('detects 220 Hz sine wave within 2 Hz', () => {
    const buf = new Float32Array(4096)
    for (let i = 0; i < 4096; i++) buf[i] = 0.5 * Math.sin(2 * Math.PI * 220 * i / 44100)
    const freq = yin(buf, 44100)
    expect(freq).toBeGreaterThan(218)
    expect(freq).toBeLessThan(222)
  })

  test('returns -1 for broadband noise (poor periodicity)', () => {
    // pseudo-random noise via simple LCG — deterministic, no DOM dependency
    const buf = new Float32Array(4096)
    let seed = 42
    for (let i = 0; i < 4096; i++) {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff
      buf[i] = (seed / 0x80000000) - 1
    }
    expect(yin(buf, 44100)).toBe(-1)
  })
})
