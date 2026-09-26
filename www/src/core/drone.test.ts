import { describe, test, expect } from 'vitest'
import { droneHz, createNotch, rms, onlyDrone, DRONE_SETTLE_S, DRONE_GAIN } from './drone.ts'
import { createAnalyzer } from './pitch/analyzer.ts'

const sr = 48000, N = 4096, HOP = 1024
const hzOf = (semisFromA: number, ref = 442) => ref * Math.pow(2, semisFromA / 12)

/** 현악기 비슷한 소리: 기본음 + 배음 6개(1/h) */
const string = (f: number, amp = 0.3) => (i: number) => { let s = 0; for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * f * h * i / sr) / h; return amp * s }
/** 드론(사인) + 스피커 찌그러짐(2·3배음) */
const drone = (f: number, dist = 0, amp = DRONE_GAIN) => (i: number) =>
  amp * (Math.sin(2 * Math.PI * f * i / sr) + dist * (0.6 * Math.sin(2 * Math.PI * 2 * f * i / sr + 0.3) + 0.4 * Math.sin(2 * Math.PI * 3 * f * i / sr + 1.1)))

/** 신호를 워커처럼 청크로 노치에 흘리고, 마지막 창들을 분석기에 넣은 결과 */
function run(sig: (i: number) => number, droneF: number, seconds = 1.2) {
  const total = Math.round(seconds * sr), x = new Float32Array(total), y = new Float32Array(total), rem = new Float32Array(total)
  for (let i = 0; i < total; i++) x[i] = sig(i)
  const notch = createNotch(sr, droneF)
  for (let p = 0; p < total; p += HOP) notch.process(x.subarray(p, p + HOP), y.subarray(p, p + HOP), rem.subarray(p, p + HOP))
  const an = createAnalyzer({ sampleRate: sr, windowSize: N }); an.setSettings({ refHz: 442, tolCents: 15, rmsMin: .005 })
  let f = an.process(y.subarray(total - N - 12 * HOP, total - 12 * HOP))
  for (let k = 11; k >= 0; k--) f = an.process(y.subarray(total - N - k * HOP, total - k * HOP))
  const tail = (a: Float32Array) => a.subarray(total - N)
  return { frame: f, residual: rms(tail(y)), removed: rms(tail(rem)) }
}
const mix = (...fs: Array<(i: number) => number>) => (i: number) => fs.reduce((s, f) => s + f(i), 0)

describe('drone: pitch', () => {
  test('octave 4 at the reference pitch — 라 is the reference itself, 도 is middle C', () => {
    expect(droneHz(9, 442)).toBeCloseTo(442, 6)
    expect(droneHz(0, 440)).toBeCloseTo(261.63, 2)
    expect(droneHz(2, 442)).toBeCloseTo(442 * Math.pow(2, -7 / 12), 6)
  })
})

describe('drone: notch', () => {
  const gain = (droneF: number, toneF: number) => {
    const total = Math.round((DRONE_SETTLE_S + 0.2) * sr), x = new Float32Array(total), y = new Float32Array(total), r = new Float32Array(total)
    for (let i = 0; i < total; i++) x[i] = Math.sin(2 * Math.PI * toneF * i / sr)
    createNotch(sr, droneF).process(x, y, r)
    return 20 * Math.log10(rms(y.subarray(total - N)) / rms(x.subarray(total - N)))
  }
  test('removes the drone by at least 40 dB once settled', () => {
    for (const s of [-9, -7, 0, 2]) expect(gain(hzOf(s), hzOf(s))).toBeLessThan(-40)
  })
  test('the next semitone up or down passes almost untouched (< 0.5 dB)', () => {
    for (const s of [-9, -7, 0, 2]) { expect(gain(hzOf(s), hzOf(s + 1))).toBeGreaterThan(-0.5); expect(gain(hzOf(s), hzOf(s - 1))).toBeGreaterThan(-0.5) }
  })
})

describe('drone: the tuner reads the player, not the drone', () => {
  const D4 = hzOf(-7)
  test.each([
    ['레5 over a 레4 drone (octave)', hzOf(5), 74],
    ['라4 over a 레4 drone (fifth)', hzOf(0), 69],
    ['파♯4 over a 레4 drone (third)', hzOf(-3), 66],
    ['미4 over a 레4 drone (second)', hzOf(-5), 64],
  ])('%s', (_, playF, midi) => {
    for (const dist of [0, 0.05]) {
      const r = run(mix(string(playF), drone(D4, dist)), D4)
      expect(r.frame.midi).toBe(midi)
      expect(Math.abs(r.frame.cents)).toBeLessThanOrEqual(3)
      expect(onlyDrone(r.residual, r.removed)).toBe(false)
    }
  })
  test('unison +15 ¢ reads +15 ¢ from the player’s overtones', () => {
    const r = run(mix(string(hzOf(-7 + 0.15)), drone(D4, 0.05)), D4)
    expect(r.frame.midi).toBe(62); expect(Math.abs(r.frame.cents - 15)).toBeLessThanOrEqual(3)
  })
  test('drone alone — even with 10 % speaker distortion — counts as no playing', () => {
    for (const dist of [0, 0.05, 0.10]) { const r = run(drone(D4, dist), D4); expect(onlyDrone(r.residual, r.removed)).toBe(true) }
  })
})
