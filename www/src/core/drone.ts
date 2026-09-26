/**
 * 드론 — 계속 울리는 사인파 한 음. 앱이 내는 소리라 주파수를 정확히 안다(같은 기기의 같은 시계).
 * 그래서 튜너는 학습·측정 없이 그 주파수 하나만 좁게 잘라내고 남은 소리(연주)를 읽는다.
 * 사인파라 배음이 없다 — 연주 음이 드론의 옥타브·5도 위여도 겹치는 성분이 없다.
 */
import { midiToHz } from './note.ts'

/** 모든 악기에서 4옥타브 (262–494 Hz). 폰 스피커는 이 아래에서 급격히 작아진다 — 드론은 음이름이 중요하지 옥타브는 아니다 */
export const DRONE_OCTAVE = 4
/** 사인파 진폭. 'A 듣기' 삼각파 0.22 와 같은 에너지(RMS): 0.22 × (1/√3) ÷ (1/√2) */
export const DRONE_GAIN = 0.18
/** 켜고 끌 때의 램프 — 없으면 '틱' 소리가 난다 */
export const DRONE_FADE_S = 0.03
/** 노치 Q. −3 dB 폭 ±25 ¢, 바로 옆 반음(100 ¢)은 −0.3 dB. 같은 시계라 주파수 오차가 없어 더 넓힐 이유가 없다 */
export const DRONE_NOTCH_Q = 35
/** 켜거나 음을 바꾼 뒤 노치가 자리 잡는 시간 (Q35 · 262 Hz 에서 60 dB). 이 동안 튜너는 '--' */
export const DRONE_SETTLE_S = 0.3
/** 끈 뒤에도 페이드아웃 + 여유만큼 계속 잘라낸다 */
export const DRONE_TAIL_S = 0.15
/** 잘라내고 남은 소리가 드론의 이 비율보다 작으면 '연주 없음'. 폰 스피커가 드론을 찌그러뜨려 만드는 배음은 최악 ~10 % */
export const DRONE_GATE = 0.12

/** 음 (0 = 도 … 11 = 시) → 드론 주파수. 기준음(A = refHz)을 따른다 */
export function droneHz(pitchClass: number, refHz: number): number {
  return midiToHz((DRONE_OCTAVE + 1) * 12 + pitchClass, refHz)
}

/** 노치 필터 (RBJ biquad). 청크 경계를 넘어 상태를 이어 간다 */
export interface Notch {
  readonly hz: number
  /** x → out(드론을 뺀 소리), removed(빠진 소리 = x − out). 세 배열은 길이가 같다 */
  process(x: Float32Array, out: Float32Array, removed: Float32Array): void
}
export function createNotch(sampleRate: number, hz: number, q = DRONE_NOTCH_Q): Notch {
  const w0 = 2 * Math.PI * hz / sampleRate, cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * q), a0 = 1 + alpha
  const b0 = 1 / a0, b1 = -2 * cos / a0, b2 = 1 / a0, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return {
    hz,
    process(x, out, removed) {
      for (let i = 0; i < x.length; i++) {
        const xi = x[i]!, yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2 = x1; x1 = xi; y2 = y1; y1 = yi
        out[i] = yi; removed[i] = xi - yi
      }
    },
  }
}

export function rms(x: ArrayLike<number>): number { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!; return Math.sqrt(s / (x.length || 1)) }
/** 남은 소리가 드론의 DRONE_GATE 미만이면 연주가 없는 것 (드론 + 스피커 찌그러짐뿐) */
export const onlyDrone = (residualRms: number, removedRms: number): boolean => residualRms < DRONE_GATE * removedRms
