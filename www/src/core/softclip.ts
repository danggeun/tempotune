/**
 * 소프트 리미터 곡선 (WaveShaperNode 용). 순수. 무릎 k 아래는 항등, 위는 tanh 압축.
 * |x| ≤ k → y = x · |x| > k → y = k + (C−k)·tanh((|x|−k)/(C−k)). x=k 에서 값·기울기 연속(tanh'(0)=1)
 */
export const SOFT_KNEE = 0.7
/** 출력 천장 (−0.009 dBFS). tanh 는 float64 에서 x≳19 면 정확히 1.0 이라 C=1 이면 |y|=1 에 닿는다 */
export const SOFT_CEIL = 0.999

export function softClip(x: number, knee = SOFT_KNEE): number {
  const a = Math.abs(x)
  if (a <= knee) return x
  const span = SOFT_CEIL - knee
  const y = knee + span * Math.tanh((a - knee) / span)
  return x < 0 ? -y : y
}

/** WaveShaperNode.curve 용 샘플 배열 (−1..1 을 n 점으로). */
export function softClipCurve(n = 2048, knee = SOFT_KNEE): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(n * 4))
  for (let i = 0; i < n; i++) c[i] = softClip((i / (n - 1)) * 2 - 1, knee)
  return c
}
