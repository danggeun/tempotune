/**
 * 중음(더블스톱) 판정 — 연주된 두 음이 같이 있는지와 화면에 안 나오는 아래 성부. 표시 경로만 쓴다.
 * 두 배음렬만으로는 공명(개방현 울림)과 구분이 안 되어 두 기본음의 세기 차이로 가른다: 진짜 중음 0.9~9 dB, 공명 12 dB 이상.
 */
export interface DualParams {
  /** 두 기본음 피크 세기 차이(dB) 상한 — 넘으면 공명으로 본다 */
  dbMax: number
  /** 이 프레임 수만큼 연속으로 중음 후보면 '중음' 으로 확정 */
  onFrames: number
  /** 확정 후 후보가 이 프레임 수만큼 끊기면 해제 (활 바꿈·비브라토로 한두 프레임 빠지는 것 허용) */
  offFrames: number
  /** 표시용 중앙값 창 (프레임) */
  medianLen: number
  /** 직전 중앙값에서 이만큼(cents) 벗어난 값이 오면 다른 음으로 보고 창을 비운다 */
  newNoteCents: number
}
/** onFrames 5 ≈ 116 ms: 강하게 울리는 개방현이 짧게 10 dB 안에 드는 일(중앙값 149 ms)의 절반을 거른다 */
export const DEFAULT_DUAL: DualParams = { dbMax: 10, onFrames: 5, offFrames: 5, medianLen: 5, newNoteCents: 60 }

/** 한 프레임의 두 성부 (spectrum.voices() + 각 기본음 피크 dB) */
export interface DualIn { lo: number; up: number; dbLo: number; dbUp: number }

export interface Dual {
  /** @param i 이 프레임의 성부 쌍 (단음·표시 무효면 null) @returns 아래 성부의 Hz, 중음이 아니면 -1 */
  push(i: DualIn | null): number
  reset(): void
}

export function createDual(p: DualParams = DEFAULT_DUAL): Dual {
  const ring: number[] = []
  let run = 0, miss = 0, on = false, held = -1
  const median = (): number => { const b = [...ring].sort((x, y) => x - y); return b[b.length >> 1]! }
  function reset(): void { ring.length = 0; run = 0; miss = 0; on = false; held = -1 }
  return {
    reset,
    push(i) {
      const cand = i !== null && i.lo > 0 && i.up > i.lo && isFinite(i.dbLo) && isFinite(i.dbUp) && Math.abs(i.dbUp - i.dbLo) <= p.dbMax
      if (!cand) {
        run = 0
        if (!on) { ring.length = 0; return -1 }
        if (++miss > p.offFrames) { reset(); return -1 }
        return held // 짧은 끊김은 유지 — 활 바꿈마다 둘째 음이 사라지지 않게
      }
      miss = 0; run++
      const lo = i!.lo
      if (ring.length && Math.abs(1200 * Math.log2(lo / median())) > p.newNoteCents) ring.length = 0 // 다른 음으로 넘어갔다
      ring.push(lo); if (ring.length > p.medianLen) ring.shift()
      if (!on && run >= p.onFrames) on = true
      if (!on) return -1
      held = median()
      return held
    },
  }
}
