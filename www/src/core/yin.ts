/**
 * YIN 기본 음정 추정 (de Cheveigné & Kawahara, 2002).
 * 순수 함수 — 브라우저 API 없음. 워커/노드/테스트 어디서나 동일하게 동작.
 *
 * @param buf 시간 영역 샘플 (길이 N). 최대 탐지 주기는 N/2 샘플.
 * @param sr  샘플레이트 (Hz)
 * @param threshold 누적 평균 정규화 차분(CMND)의 절대 임계. 낮을수록 엄격.
 * @returns 추정 주파수 (Hz), 주기성이 없으면 -1
 *
 * 참고: v1 구현을 그대로 옮김. O(N²/4) 직접 계산 — Phase 2에서 FFT 기반으로 교체 예정.
 */
export function yin(buf: Float32Array, sr: number, threshold = 0.10): number {
  const N = buf.length, half = Math.floor(N / 2)
  const d = new Float32Array(half)
  for (let tau = 1; tau < half; tau++) {
    let s = 0
    for (let j = 0; j < half; j++) { const dif = buf[j]! - buf[j + tau]!; s += dif * dif }
    d[tau] = s
  }
  const c = new Float32Array(half); c[0] = 1; let run = 0
  for (let tau = 1; tau < half; tau++) {
    run += d[tau]!; c[tau] = run === 0 ? 0 : d[tau]! / (run / tau)
  }
  let t = -1
  for (let tau = 2; tau < half - 1; tau++) {
    if (c[tau]! < threshold) { while (tau + 1 < half && c[tau + 1]! < c[tau]!) tau++; t = tau; break }
  }
  if (t === -1) {
    let mn = Infinity
    for (let tau = 2; tau < half; tau++) { if (c[tau]! < mn) { mn = c[tau]!; t = tau } }
    if (t === -1 || mn > 0.5) return -1
  }
  const b = (t > 0 && t < half - 1) ? t + (c[t + 1]! - c[t - 1]!) / (2 * (2 * c[t]! - c[t - 1]! - c[t + 1]!)) : t
  return (b <= 0 || !isFinite(b)) ? -1 : sr / b
}
