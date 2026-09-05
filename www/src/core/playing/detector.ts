/**
 * 연주 감지기 — "악기 소리가 지속되고 있는가" (YAMNet 대체, 설계서 §B5).
 * 프레임 특징: 주기성(conf), 레벨(rms), 배음 수, 스펙트럼 평탄도. 판정은 지속 시간 기반 상태기계:
 *   OFF → ON : 조건을 만족하는 프레임이 attackFrames 연속 (말소리는 음절마다 끊겨 도달하기 어렵다)
 *   ON  → OFF: 조건 미달이 holdFrames 연속 (활 바꿈·현 이동의 짧은 공백은 유지)
 * 한계: 노래·휘파람도 잡힌다. 혼자 연습 상황에서는 문제되지 않는다 (진행 상태 결정 로그).
 */
export interface DetectorParams { confMin: number; harmonicsMin: number; flatnessMax: number; attackFrames: number; holdFrames: number }
export const DEFAULT_DETECTOR: DetectorParams = { confMin: 0.6, harmonicsMin: 2, flatnessMax: 0.5, attackFrames: 14, holdFrames: 6 }

export interface DetectorInput { conf: number; rmsOk: boolean; harmonics: number; flatness: number }
export interface Detector { push(f: DetectorInput): boolean; reset(): void; readonly on: boolean }

export function createDetector(p: DetectorParams = DEFAULT_DETECTOR): Detector {
  let run = 0, holdLeft = 0, on = false
  return {
    get on() { return on },
    reset() { run = 0; holdLeft = 0; on = false },
    push(f) {
      const q = f.rmsOk && f.conf >= p.confMin && f.harmonics >= p.harmonicsMin && f.flatness <= p.flatnessMax
      run = q ? run + 1 : 0
      if (!on && run >= p.attackFrames) { on = true; holdLeft = p.holdFrames }
      else if (on) { if (q) holdLeft = p.holdFrames; else if (--holdLeft <= 0) on = false }
      return on
    },
  }
}
