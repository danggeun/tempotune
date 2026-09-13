/**
 * 프레임 분석기 — 창(window) 하나를 받아 튜너/연주감지 결과를 낸다. 순수 (워커·벤치마크 공용).
 * 파이프라인: RMS → YIN(FFT) + conf → 스펙트럼(옥타브 교정, 배음, 평탄도) → 트래커 → 표시값, 감지기 → playing
 */
import { createYinFast } from './yinFast.ts'
import { createSpectrum } from './spectrum.ts'
import { createTracker, DEFAULT_TRACKER, type TrackerParams } from './tracker.ts'
import { createDetector, DEFAULT_DETECTOR, type DetectorParams } from '../playing/detector.ts'
import { createDual, DEFAULT_DUAL, type DualParams } from './dual.ts'

export interface AnalyzerParams {
  sampleRate: number
  windowSize?: number
  hzMin?: number
  hzMax?: number
  yinThreshold?: number
  tracker?: Partial<TrackerParams>
  detector?: Partial<DetectorParams>
  dual?: Partial<DualParams>
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
  /** 트래커가 직전 값을 그대로 내보낸 횟수 (0 = 새로 측정한 값). 트레이스는 이 값이 쌓인 프레임을 그리지 않는다 */
  held: number
  /** 중음일 때 **화면에 안 나오는 쪽(아래 성부)** 의 Hz, 중음이 아니면 -1 (B17). core/pitch/dual.ts 참고 */
  dualHz: number
  /** 그 음의 음이름(midi)과 기준음 기준 cents. dualHz 가 -1 이면 각각 -1 / 0 */
  dualMidi: number
  dualCents: number
}

export interface Analyzer {
  readonly windowSize: number
  /** @param muted 이 창에 메트로놈 클릭이 섞여 있음 — 버리지 않고 신뢰도만 낮춰 트래커 가중 중앙값에서 밀려나게 하고, 감지기는 상태를 유지한다 */
  process(buf: Float32Array | Float64Array, muted?: boolean): Frame
  setSettings(s: Partial<AnalyzerSettings>): void
  getSettings(): AnalyzerSettings
  reset(): void
}

/**
 * 표시용 신뢰도 하한 — 주장한 기본음 자리에 에너지가 없는 프레임은 트래커에서 배제한다.
 *
 * 왜: YIN 은 시간축 주기성만 본다. 두 음이 겹치면(더블스톱) 합성 신호의 주기가 두 주파수의
 * 최대공약수에서 생기고, YIN 은 연주되지 않은 그 '가상 기본음' 을 매우 높은 신뢰도로 보고한다
 * (실제 바이올린 녹음 실측: 신뢰도 중앙값 0.945, 그중 76.5 % 가 0.9 초과 — 정상 프레임 0.991 과 구분 불가).
 * 신뢰도가 '얼마나 주기적인가' 를 재고 있어 '맞는가' 를 말해주지 못하는 것이 원인이다.
 *
 * 대처: 스펙트럼에서 f0 자리의 피크 존재 여부로 정합성을 확인하고, 없으면 표시 경로에서만 배제한다.
 * 실측(6분 51초 · 19,292 프레임): 가짜음 23.96 % → 8.47 %, 중음 구간 55.69 % → 22.36 %.
 * 비용은 원래 맞던 프레임의 1.2 % (화면에서 사라진 49 초 중 93.1 % 가 가짜였다).
 *
 * ★ 이 페널티는 트래커에만 간다. 감지기(연주 시간)에는 원본 신뢰도가 그대로 들어간다 —
 *   중음 구간에서 연주가 '멈춘 것' 으로 판정되면 가장 열심히 연주한 시간이 통째로 빠지기 때문.
 *   analyzer.test.ts 가 감지기 출력 동일성을 프레임 단위로 고정한다.
 */
const SPEC_MIN_DB = 6 // f0 피크가 잡음 바닥보다 이만큼 솟아야 '있다'. octaveCorrect 의 기준과 같은 값

/**
 * 표시 안정성 게이트 — **최근 원시 추정이 옥타브 단위로 흩어져 있으면 표시하지 않는다.**
 *
 * 왜 (B16): 중음이 빠르게 이어지는 패시지에서 YIN 은 두 음의 최대공약수(가상 기본음)와 실제 음 사이를
 * 프레임마다 오간다. 실측(사용자 바이올린 「레전드」 6분 51초, 19,289 프레임): 바이올린이 **낼 수 없는 음**이
 * 표시 프레임의 5.1 %, 나쁜 30초 구간에서는 20.5 %. 음이름이 **초당 9~11회** 바뀌어 읽을 수가 없다.
 * 신뢰도로는 못 거른다 — 그 프레임들의 신뢰도 중앙값이 **0.932** 다(B2 가 지적한 그대로).
 *
 * 거를 수 있는 특징은 따로 있다: **값이 프레임마다 옥타브씩 튄다.** 한 음을 실제로 켜고 있으면 절대 그러지 않고,
 * 빠른 스케일도 반음~온음 단위로 움직일 뿐이다. 그래서 '최근 몇 프레임의 원시 추정이 한 옥타브 넘게 벌어져 있으면
 * 이 순간은 무엇을 보여줄지 모르는 상태' 로 보고 표시를 비운다. 연주자는 그 구간에서 튜너를 읽지 않는다 —
 * 틀린 이름을 바쁘게 띄우는 것보다 조용한 편이 낫다.
 *
 * ★ 감지기(연주 시간)에는 영향이 없다. SPEC_MIN_DB 와 같은 자리에서 **표시용 신뢰도만** 깎는다.
 */
const RAW_RING = 4, RAW_SPREAD_MAX = 1.9

export function createAnalyzer(p: AnalyzerParams): Analyzer {
  const N = p.windowSize ?? 4096, sr = p.sampleRate
  const yin = createYinFast(N, { threshold: p.yinThreshold ?? 0.10, hzMin: p.hzMin ?? 40, hzMax: p.hzMax ?? 4200 })
  const spec = createSpectrum(N)
  const tracker = createTracker({ ...DEFAULT_TRACKER, ...p.tracker })
  const det = createDetector({ ...DEFAULT_DETECTOR, ...p.detector })
  const dual = createDual({ ...DEFAULT_DUAL, ...p.dual })
  const s: AnalyzerSettings = { rmsMin: .014, smoothing: .14, refHz: 442, tolCents: 15 }
  const rawRing: number[] = []
  /** 최근 원시 추정이 옥타브 안에 모여 있는가 */
  function rawStable(hz: number): boolean {
    if (hz > 0) { rawRing.push(hz); if (rawRing.length > RAW_RING) rawRing.shift() }
    if (rawRing.length < RAW_RING) return true // 아직 판단할 근거가 없으면 막지 않는다
    let lo = Infinity, hi = 0
    for (const v of rawRing) { if (v < lo) lo = v; if (v > hi) hi = v }
    return hi / lo <= RAW_SPREAD_MAX
  }
  const EMPTY = (rms: number): Frame => ({ rawHz: -1, conf: 0, rms, harmonics: 0, flatness: 1, hz: -1, midi: -1, cents: 0, inTune: false, playing: det.on, held: 0, dualHz: -1, dualMidi: -1, dualCents: 0 })

  return {
    windowSize: N,
    setSettings(patch) { Object.assign(s, patch) },
    getSettings() { return { ...s } },
    reset() { tracker.reset(); det.reset(); spec.reset(); dual.reset(); rawRing.length = 0 },
    process(buf, muted = false) {
      let e = 0; for (let i = 0; i < N; i++) e += buf[i]! * buf[i]!
      const rms = Math.sqrt(e / N), rmsOk = rms >= s.rmsMin
      if (!rmsOk) { // 게이트 아래: 트래커/감지기에 "무효" 프레임을 알린다. 중음 붙잡기 기억도 지운다(쉼표 뒤 첫 중음이 옛 음에 붙지 않게)
        spec.reset(); dual.reset(); rawRing.length = 0
        const t = tracker.push(-1, 0, false, s.smoothing); const playing = det.push({ conf: 0, rmsOk: false, harmonics: 0, flatness: 1 })
        const f = EMPTY(rms); f.playing = playing
        if (t.hz > 0) { fill(f, t.hz, t.midi); f.held = t.held }
        return f
      }
      const y = yin.process(buf, sr)
      spec.update(buf, sr)
      let rawHz = y.hz
      if (rawHz > 0) rawHz = spec.octaveCorrect(rawHz)
      const harmonics = rawHz > 0 ? spec.harmonicCount(rawHz) : 0
      const flatness = spec.flatness()
      // 클릭이 섞인 창: 감지기는 건드리지 않고(짧은 클릭으로 연주 시간이 끊기지 않게), 트래커에는 낮은 가중치로만 준다
      const playing = muted ? det.on : det.push({ conf: y.conf, rmsOk, harmonics, flatness, cents: rawHz > 0 ? 1200 * Math.log2(rawHz / 440) : NaN })
      // 표시용 신뢰도: 스펙트럼 정합성 실패면 0 (트래커의 confMin 게이트에서 걸러진다). 위 감지기 줄은 건드리지 않는다.
      const specOk = rawHz > 0 && spec.harmonicCount(rawHz, 1, SPEC_MIN_DB) > 0
      const dispConf = specOk && rawStable(rawHz) ? y.conf : 0
      // 중음 판정: 표시가 유효한 프레임에서만 본다 (음이름이 안 뜨는데 둘째 음만 뜨면 앞뒤가 안 맞는다).
      // 스펙트럼이 이미 계산해 둔 두 성부를 읽는 것뿐 — 위 줄들의 음높이·감지기 입력에는 영향이 없다.
      const v = dispConf > 0 ? spec.voices() : { lo: -1, up: -1 }
      const dualHz = dual.push(v.lo > 0 && v.up > 0 ? { lo: v.lo, up: v.up, dbLo: spec.peakDbNear(v.lo), dbUp: spec.peakDbNear(v.up) } : null)
      // 트래커의 음이름 격자는 A=440 기준이므로 기준음(refHz)만큼 주파수를 정규화해 넣는다 — 안 그러면 |오프셋| > 50 ¢(≈ 427 Hz 미만·453 Hz 초과, 바로크 415 포함)에서 이웃 반음으로 라벨링된다
      const t = tracker.push(rawHz / refK(), muted ? dispConf * 0.25 : dispConf, true, s.smoothing)
      const f: Frame = { rawHz, conf: y.conf, rms, harmonics, flatness, hz: -1, midi: -1, cents: 0, inTune: false, playing, held: t.held, dualHz, dualMidi: -1, dualCents: 0 }
      if (t.hz > 0) fill(f, t.hz, t.midi)
      // 둘째 성부는 트래커를 타지 않는다(히스테리시스 대상이 아님) — 가장 가까운 음으로 바로 읽는다
      if (dualHz > 0 && t.hz > 0) { const norm = dualHz / refK(); const m = Math.round(69 + 12 * Math.log2(norm / 440))
        f.dualMidi = m; f.dualCents = Math.round(1200 * Math.log2(norm / (440 * Math.pow(2, (m - 69) / 12)))) }
      else f.dualHz = -1 // 표시가 없으면 둘째 음도 없다
      return f
    },
  }
  function refK(): number { return s.refHz / 440 }
  /** hzNorm 은 440 격자로 정규화된 값. 표시 주파수는 되돌리고, cents 는 정규화 공간에서 440 격자 기준으로 계산하면 곧 refHz 기준 cents 다 */
  function fill(f: Frame, hzNorm: number, midi: number): void {
    const ref440 = 440 * Math.pow(2, (midi - 69) / 12)
    f.hz = hzNorm * refK(); f.midi = midi; f.cents = Math.round(1200 * Math.log2(hzNorm / ref440)); f.inTune = Math.abs(f.cents) <= s.tolCents
  }
}
