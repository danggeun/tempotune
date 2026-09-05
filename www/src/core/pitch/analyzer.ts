/**
 * 프레임 분석기 — 창(window) 하나를 받아 튜너/연주감지 결과를 낸다. 순수 (워커·벤치마크 공용).
 * 파이프라인: RMS → YIN(FFT) + conf → 스펙트럼(옥타브 교정, 배음, 평탄도) → 트래커 → 표시값, 감지기 → playing
 */
import { createYinFast } from './yinFast.ts'
import { createSpectrum } from './spectrum.ts'
import { createTracker, DEFAULT_TRACKER, type TrackerParams } from './tracker.ts'
import { createDetector, DEFAULT_DETECTOR, type DetectorParams } from '../playing/detector.ts'

export interface AnalyzerParams {
  sampleRate: number
  windowSize?: number
  hzMin?: number
  hzMax?: number
  yinThreshold?: number
  tracker?: Partial<TrackerParams>
  detector?: Partial<DetectorParams>
}
/** 런타임에 바뀌는 사용자 설정 */
export interface AnalyzerSettings { rmsMin: number; smoothing: number; refHz: number; tolCents: number }

export interface Frame {
  /** 원시 YIN 추정 (옥타브 교정 후), 없으면 -1 */
  rawHz: number
  conf: number
  rms: number
  harmonics: number
  flatness: number
  /** 표시 주파수 (트래커 출력), 없으면 -1 */
  hz: number
  midi: number
  cents: number
  inTune: boolean
  playing: boolean
}

export interface Analyzer {
  readonly windowSize: number
  process(buf: Float32Array | Float64Array): Frame
  setSettings(s: Partial<AnalyzerSettings>): void
  getSettings(): AnalyzerSettings
  reset(): void
}

export function createAnalyzer(p: AnalyzerParams): Analyzer {
  const N = p.windowSize ?? 4096, sr = p.sampleRate
  const yin = createYinFast(N, { threshold: p.yinThreshold ?? 0.10, hzMin: p.hzMin ?? 40, hzMax: p.hzMax ?? 4200 })
  const spec = createSpectrum(N)
  const tracker = createTracker({ ...DEFAULT_TRACKER, ...p.tracker })
  const det = createDetector({ ...DEFAULT_DETECTOR, ...p.detector })
  const s: AnalyzerSettings = { rmsMin: .014, smoothing: .14, refHz: 442, tolCents: 15 }
  const EMPTY = (rms: number): Frame => ({ rawHz: -1, conf: 0, rms, harmonics: 0, flatness: 1, hz: -1, midi: -1, cents: 0, inTune: false, playing: det.on })

  return {
    windowSize: N,
    setSettings(patch) { Object.assign(s, patch) },
    getSettings() { return { ...s } },
    reset() { tracker.reset(); det.reset() },
    process(buf) {
      let e = 0; for (let i = 0; i < N; i++) e += buf[i]! * buf[i]!
      const rms = Math.sqrt(e / N), rmsOk = rms >= s.rmsMin
      if (!rmsOk) { // 게이트 아래: 트래커/감지기에 "무효" 프레임을 알린다
        const t = tracker.push(-1, 0, false, s.smoothing); const playing = det.push({ conf: 0, rmsOk: false, harmonics: 0, flatness: 1 })
        const f = EMPTY(rms); f.playing = playing
        if (t.hz > 0) fill(f, t.hz, t.midi)
        return f
      }
      const y = yin.process(buf, sr)
      spec.update(buf, sr)
      let rawHz = y.hz
      if (rawHz > 0) rawHz = spec.octaveCorrect(rawHz)
      const harmonics = rawHz > 0 ? spec.harmonicCount(rawHz) : 0
      const flatness = spec.flatness()
      const playing = det.push({ conf: y.conf, rmsOk, harmonics, flatness, cents: rawHz > 0 ? 1200 * Math.log2(rawHz / 440) : NaN })
      const t = tracker.push(rawHz, y.conf, true, s.smoothing)
      const f: Frame = { rawHz, conf: y.conf, rms, harmonics, flatness, hz: -1, midi: -1, cents: 0, inTune: false, playing }
      if (t.hz > 0) fill(f, t.hz, t.midi)
      return f
    },
  }
  function fill(f: Frame, hz: number, midi: number): void {
    const ref = s.refHz * Math.pow(2, (midi - 69) / 12)
    f.hz = hz; f.midi = midi; f.cents = Math.round(1200 * Math.log2(hz / ref)); f.inTune = Math.abs(f.cents) <= s.tolCents
  }
}
