/**
 * 음 추적기 — 프레임별 (hz, conf) 를 받아 표시할 음/센트를 결정한다.
 * 신뢰도 가중 중앙값 → 음이름 히스테리시스(±switchCents, switchFrames 연속이면 전환) → 표시용 지수 평활.
 * 모든 계산은 A4=440 기준 절대 cents (a = 1200·log2(hz/440)). 기준음(refHz) 보정은 호출부에서.
 */
export interface TrackerParams {
  /** 후보로 인정할 최소 신뢰도 */
  confMin: number
  /** 첫 프레임에 즉시 락을 허용하는 신뢰도 */
  confInstant: number
  /** 가중 중앙값 창 길이 (프레임) */
  medianLen: number
  /** 현재 음에서 이만큼(cents) 벗어나면 "다른 음 후보" */
  switchCents: number
  /** 다른 음 후보가 이 프레임 수만큼 연속되면 전환 */
  switchFrames: number
  /** 유효 프레임이 끊긴 뒤 표시를 유지하는 프레임 수 */
  releaseFrames: number
}
/** cents 는 가장 가까운 음에서의 편차이므로 정의상 이 값을 넘을 수 없다 */
const HALF_SEMITONE = 50
export const DEFAULT_TRACKER: TrackerParams = { confMin: 0.5, confInstant: 0.85, medianLen: 3, switchCents: 65, switchFrames: 2, releaseFrames: 6 }

/** @property held 유효 프레임이 끊겨 직전 값을 그대로 다시 내보낸 횟수 (0 = 방금 측정한 값). 트레이스가 유지 프레임을 구분하는 데 쓴다 */
export interface TrackOut { hz: number; midi: number; a: number; held: number }
const NONE: TrackOut = { hz: -1, midi: -1, a: NaN, held: 0 }

export interface Tracker {
  /** @param hz 원시 추정 (-1 없음) @param conf 0..1 @param valid RMS 게이트 등 외부 조건 @param alpha 평활 계수 */
  push(hz: number, conf: number, valid: boolean, alpha: number): TrackOut
  reset(): void
}

export function createTracker(p: TrackerParams = DEFAULT_TRACKER): Tracker {
  const candA: number[] = [], candW: number[] = []
  let midi = -1, dispA = NaN, outside = 0, miss = 0, validRun = 0, errSign = 0, sameSignRun = 0
  let last: TrackOut = NONE

  function weightedMedian(): number {
    const idx = candA.map((_, i) => i).sort((i, j) => candA[i]! - candA[j]!)
    const total = candW.reduce((s, w) => s + w, 0); let acc = 0
    for (const i of idx) { acc += candW[i]!; if (acc >= total / 2) return candA[i]! }
    return candA[idx[idx.length - 1]!]!
  }
  function reset(): void { candA.length = 0; candW.length = 0; midi = -1; dispA = NaN; outside = 0; miss = 0; validRun = 0; errSign = 0; sameSignRun = 0; last = NONE }
  const out = (): TrackOut => { last = { hz: 440 * Math.pow(2, dispA / 1200), midi, a: dispA, held: 0 }; return last }

  return {
    reset,
    push(hz, conf, valid, alpha) {
      const ok = valid && hz > 0 && conf >= p.confMin
      if (!ok) {
        validRun = 0
        if (midi === -1) return NONE
        if (++miss > p.releaseFrames) { reset(); return NONE }
        return { ...last, held: miss } // 짧은 끊김은 마지막 표시 유지 (몇 번째 유지인지 알려준다)
      }
      miss = 0; validRun++
      const a = 1200 * Math.log2(hz / 440)
      candA.push(a); candW.push(conf); if (candA.length > p.medianLen) { candA.shift(); candW.shift() }
      const med = weightedMedian()
      if (midi === -1) {
        if (conf < p.confInstant && validRun < 2) return NONE // 낮은 신뢰도는 두 프레임 확인
        midi = Math.round(med / 100) + 69; dispA = med; outside = 0
        return out()
      }
      // 표시값은 항상 중앙값을 따라가고(평활), 음이름 라벨만 히스테리시스로 바뀐다.
      // 적응 평활: 오차가 크고 한 방향으로 4프레임 이상 계속될 때만 빠르게 따라붙는다 — 비브라토는 부호가 3–4프레임마다 바뀐다
      const diff = med - dispA, err = Math.abs(diff), sign = diff > 0 ? 1 : diff < 0 ? -1 : 0
      sameSignRun = sign !== 0 && sign === errSign ? sameSignRun + 1 : 1; errSign = sign
      const boost = sameSignRun >= 4 ? Math.min(1, Math.max(0, (err - 30) / 60)) : 0
      dispA += diff * (alpha + (1 - alpha) * boost)
      const dev = med - (midi - 69) * 100
      if (Math.abs(dev) <= p.switchCents) outside = 0
      else {
        if (++outside >= p.switchFrames) { midi = Math.round(med / 100) + 69; dispA = med; outside = 0 }
      }
      // 표시 일관성: 부스트가 dispA 를 한 프레임에 새 음까지 옮겨도 라벨은 switchFrames 를 기다리므로, ±50 ¢ 를 넘으면 라벨을 즉시 맞춘다
      if (Math.abs(dispA - (midi - 69) * 100) > HALF_SEMITONE) { midi = Math.round(dispA / 100) + 69; outside = 0 }
      return out()
    },
  }
}
