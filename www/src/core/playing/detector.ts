/**
 * 연주 감지기 — 악기 소리가 지속되고 있는가. 특징: 주기성(conf), 레벨, 배음 수, 스펙트럼 평탄도.
 * OFF→ON 은 조건 프레임 누적이 attackFrames 에 도달(미달은 missPenalty 감점), ON→OFF 는 미달이 holdFrames 연속. 노래·휘파람도 잡힌다.
 */
export interface DetectorParams {
  confMin: number; harmonicsMin: number; flatnessMax: number
  /** ON 이 되기 위한 누적 카운터 목표 (프레임). 조건 프레임 +1 */
  attackFrames: number
  /** 조건 미달 프레임마다 카운터 감소량 — 1프레임 흔들림은 살아남고 음절 사이 공백(2+프레임)은 사실상 리셋 */
  missPenalty: number
  /** ON 상태에서 조건 미달을 버티는 프레임 수 (≈250 ms: 활 바꿈·짧은 쉼표) */
  holdFrames: number
  /** 한 연속 구간에서 피치가 이만큼(cents) 이상 단조 이동하면 말소리 억양으로 보고 attack 누적을 버린다. 비브라토는 왕복이라 기울기 ≈ 0 */
  driftMaxCents: number
}
/** 기본: 음악 우선 — 스타카토(150 ms 음 + 100 ms 공백)도 잡는다. 대화 음절도 대부분 연주로 센다 (speech fPlay ≈ 90%) */
export const DEFAULT_DETECTOR: DetectorParams = { confMin: 0.6, harmonicsMin: 2, flatnessMax: 0.5, attackFrames: 6, missPenalty: 2, holdFrames: 11, driftMaxCents: 60 }
/** 엄격: 대화 음절(≤300 ms)을 거른다 (speech fPlay 0%). 스타카토·피치카토 런은 시작하지 못한다. 현재 미사용 */
export const STRICT_DETECTOR: DetectorParams = { ...DEFAULT_DETECTOR, attackFrames: 14, missPenalty: 5, holdFrames: 6 }

export interface DetectorInput { conf: number; rmsOk: boolean; harmonics: number; flatness: number; /** 절대 cents (1200·log2(hz/440)), 없으면 NaN */ cents?: number }
export interface Detector { push(f: DetectorInput): boolean; reset(): void; readonly on: boolean }

export function createDetector(p: DetectorParams = DEFAULT_DETECTOR): Detector {
  let run = 0, holdLeft = 0, on = false
  const ys: number[] = [] // 현재 연속 구간의 cents (억양 드리프트 검사용)
  function drift(): number { // 최소제곱 기울기 × 길이 = 구간 전체의 단조 이동량(cents)
    const n = ys.length; if (n < 4) return 0
    let sx = 0, sy = 0, sxx = 0, sxy = 0
    for (let i = 0; i < n; i++) { const y = ys[i]!; sx += i; sy += y; sxx += i * i; sxy += i * y }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    return slope * (n - 1)
  }
  return {
    get on() { return on },
    reset() { run = 0; holdLeft = 0; on = false; ys.length = 0 },
    push(f) {
      // 하모닉스(플라졸렛)처럼 배음이 거의 없어도 주기성이 매우 높으면 인정
      const harmOk = f.harmonics >= p.harmonicsMin || (f.harmonics >= 1 && f.conf >= 0.9)
      let q = f.rmsOk && f.conf >= p.confMin && harmOk && f.flatness <= p.flatnessMax
      if (q && f.cents !== undefined && !Number.isNaN(f.cents)) {
        ys.push(f.cents); if (ys.length > 24) ys.shift()
        if (!on && Math.abs(drift()) > p.driftMaxCents) { q = false; run = 0 } // 억양처럼 흐르는 피치는 시작 조건에서 제외 (ON 이후엔 포르타멘토 허용)
      } else ys.length = 0
      run = q ? run + 1 : Math.max(0, run - p.missPenalty)
      if (!on && run >= p.attackFrames) { on = true; holdLeft = p.holdFrames }
      else if (on) { if (q) holdLeft = p.holdFrames; else if (--holdLeft <= 0) on = false }
      return on
    },
  }
}
