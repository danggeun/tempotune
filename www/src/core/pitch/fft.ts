/**
 * 실수/복소 radix-2 FFT. 의존성 없음, Float64 정밀도.
 * 워커(분석)와 노드(벤치마크)에서 같은 코드를 쓴다.
 */
export interface FFT {
  readonly size: number
  /** in-place 정변환 */
  transform(re: Float64Array, im: Float64Array): void
  /** in-place 역변환 (1/N 스케일 포함) */
  inverse(re: Float64Array, im: Float64Array): void
}

export function makeFFT(n: number): FFT {
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('FFT size must be a power of 2')
  const levels = Math.log2(n) | 0
  const cosT = new Float64Array(n / 2), sinT = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / n); sinT[i] = Math.sin(2 * Math.PI * i / n) }
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) { let x = i, r = 0; for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>>= 1 } rev[i] = r }
  function transform(re: Float64Array, im: Float64Array): void {
    for (let i = 0; i < n; i++) { const j = rev[i]!; if (j > i) { let t = re[i]!; re[i] = re[j]!; re[j] = t; t = im[i]!; im[i] = im[j]!; im[j] = t } }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half, c = cosT[k]!, s = sinT[k]!
          const tre = re[l]! * c + im[l]! * s
          const tim = -re[l]! * s + im[l]! * c
          re[l] = re[j]! - tre; im[l] = im[j]! - tim
          re[j] = re[j]! + tre; im[j] = im[j]! + tim
        }
      }
    }
  }
  return {
    size: n, transform,
    inverse(re, im) { transform(im, re); for (let i = 0; i < n; i++) { re[i] = re[i]! / n; im[i] = im[i]! / n } },
  }
}

/** Hann 창 (사전 계산) */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)
  return w
}
