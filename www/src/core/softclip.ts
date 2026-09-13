/**
 * 소프트 리미터 곡선 (WaveShaperNode 용). 순수.
 *
 * 왜: 메트로놈 클릭을 크게 하면 세분음 꼬리와 다음 박이 겹치는 순간 합이 1.0 을 넘는다.
 * 하드 클리핑은 "칙" 소리(고조파 왜곡)를 내고 폰 스피커에서 특히 거칠다.
 * 무릎(knee) 아래는 **완전한 항등 함수**라 기존 음색이 변하지 않고, 위만 압축한다.
 *
 *   |x| ≤ k          → y = x                         (건드리지 않음)
 *   |x| > k          → y = k + (C−k)·tanh((|x|−k)/(C−k))
 *
 * x=k 에서 값·기울기가 모두 연속(tanh'(0)=1)이라 이음새가 들리지 않는다.
 * 천장 C 를 1 보다 살짝 아래로 두어 **아무리 큰 입력에도 |y| < 1 이 수학적으로 보장**된다
 * (tanh 는 float64 에서 x≳19 면 정확히 1.0 이 되므로 C=1 이면 경계에 닿는다).
 */
export const SOFT_KNEE = 0.7
/** 출력 천장 (−0.009 dBFS). 1.0 에 닿지 않게 */
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
