import { describe, test, expect } from 'vitest'
import { createDetector, DEFAULT_DETECTOR } from './detector.ts'

const good = { conf: 0.9, rmsOk: true, harmonics: 4, flatness: 0.1 }
const bad = { conf: 0.2, rmsOk: true, harmonics: 0, flatness: 0.8 }
describe('detector', () => {
  test('turns on only after attackFrames of continuous qualifying frames', () => {
    const d = createDetector()
    for (let i = 0; i < DEFAULT_DETECTOR.attackFrames - 1; i++) expect(d.push(good)).toBe(false)
    expect(d.push(good)).toBe(true)
  })
  test('speech-like bursts shorter than attack never turn on', () => {
    const d = createDetector()
    for (let k = 0; k < 10; k++) { for (let i = 0; i < DEFAULT_DETECTOR.attackFrames - 2; i++) d.push(good); expect(d.push(bad)).toBe(false) }
  })
  test('holds through gaps shorter than holdFrames, then off', () => {
    const d = createDetector(); for (let i = 0; i < DEFAULT_DETECTOR.attackFrames; i++) d.push(good)
    for (let i = 0; i < DEFAULT_DETECTOR.holdFrames - 1; i++) expect(d.push(bad)).toBe(true)
    expect(d.push(bad)).toBe(false)
  })
  test('noise (flat spectrum) never qualifies even if periodic-ish', () => {
    const d = createDetector(); for (let i = 0; i < 40; i++) expect(d.push({ conf: 0.7, rmsOk: true, harmonics: 3, flatness: 0.7 })).toBe(false)
  })
})
