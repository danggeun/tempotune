/**
 * 중음(더블스톱) 판정 — 지금 소리에 **연주된 두 음**이 같이 있나, 그리고 화면에 안 나오는 쪽은 무엇인가. (B17)
 *
 * 왜 필요한가 (실측):
 *   중음을 연습할 때 화면은 위 성부만 보여준다(v2.0.1 정책 — 멜로디가 거의 항상 위쪽이라 옳다).
 *   그런데 아래 음을 25~30 ¢ 틀리게 짚어도 화면은 위 음을 0 ¢ · 초록으로 "완벽" 이라고 말한다.
 *   즉 **아래 현이 틀린 것을 튜너가 맞다고 보증**한다. 중음 연습에서 이건 그냥 틀린 정보다.
 *
 * 어떻게 (오검출을 막는 근거):
 *   두 배음렬이 보이는 것만으로는 중음이 아니다 — 한 음만 켜도 옆 개방현이 따라 울린다(공명).
 *   구분되는 특징은 **두 기본음의 세기 차이**다. 실측(합성 바이올린, 기본음 피크 dB 차의 중앙값):
 *     · 진짜 중음(두 현을 같이 켬): 0.9 ~ 9.0 dB (활 배분이 한쪽으로 −10 dB 까지 치우쳐도)
 *     · 공명(아래 현이 울림): 성부 쌍 자체가 검출되지 않음 (후보를 f0 **위쪽**에서만 찾으므로)
 *     · 공명(위 현이 울림): 1/4 세기 11.2 dB · 1/6 14.7 dB · 1/10 19.1 dB — 흔한 범위는 모두 12 dB 이상
 *     · 단음(공명 없음): 성부 쌍 미검출
 *   그래서 문턱은 **10 dB**. 남는 구멍은 '1/2 세기(−6 dB)로 매우 강하게 울리는 개방현'(5.1 dB)인데,
 *   그 현은 실제로 울리고 있고 **개방현이라 음정이 맞으므로** 잘못 뜨더라도 초록을 빼앗지 않는다(아래 판정 규칙).
 *   반대로 한쪽이 −14 dB 이상 묻힌 진짜 중음(13.1 dB)은 놓친다 — 놓치면 v2.0.1 과 같은 화면이라 무해하다.
 *
 * 이 모듈은 **표시 경로만** 쓴다. 음높이·연주 감지·녹음에는 들어가지 않는다.
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
/**
 * onFrames 5 (≈116 ms) 인 이유: 실녹음에서 **강하게 울리는 개방현**이 짧게 10 dB 안에 들어오는 일이 있다
 * (「펜타포트 15」 29초에 7회, 중앙값 149 ms). 확정을 116 ms 로 늦추면 그중 절반이 사라지고,
 * 지속되는 진짜 중음 검출률은 98 % → 95 % 로만 준다. 더 늦추면(232 ms) 진짜 중음 손실이 커진다.
 */
export const DEFAULT_DUAL: DualParams = { dbMax: 10, onFrames: 5, offFrames: 5, medianLen: 5, newNoteCents: 60 }

/** 한 프레임의 두 성부 (spectrum.voices() + 각 기본음 피크 dB) */
export interface DualIn { lo: number; up: number; dbLo: number; dbUp: number }

export interface Dual {
  /**
   * @param i 이 프레임의 성부 쌍. 없거나(단음) 표시가 유효하지 않으면 null.
   * @returns 화면에 안 나오는 쪽(= 아래 성부)의 Hz. 중음이 아니면 -1.
   */
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
