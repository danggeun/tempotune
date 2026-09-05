// 실수 입력 radix-2 FFT (벤치마크/코어 공용). 의존성 없음.
// 왜: AnalyserNode 없이 노드 환경에서 스펙트럼을 계산하고, 이후 core/로 옮겨 워커에서도 쓴다.
export function makeFFT(n) {
  if ((n & (n - 1)) !== 0) throw new Error('FFT size must be power of 2')
  const levels = Math.log2(n) | 0
  const cosT = new Float32Array(n / 2), sinT = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / n); sinT[i] = Math.sin(2 * Math.PI * i / n) }
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) { let x = i, r = 0; for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>>= 1 } rev[i] = r }
  return {
    size: n,
    /** in-place: re, im 길이 n */
    transform(re, im) {
      for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t } }
      for (let size = 2; size <= n; size *= 2) {
        const half = size / 2, step = n / size
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l = j + half
            const tre = re[l] * cosT[k] + im[l] * sinT[k]
            const tim = -re[l] * sinT[k] + im[l] * cosT[k]
            re[l] = re[j] - tre; im[l] = im[j] - tim
            re[j] += tre; im[j] += tim
          }
        }
      }
    },
    /** 역변환 (스케일 포함) */
    inverse(re, im) {
      this.transform(im, re)
      for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
    },
  }
}

/** 파워 스펙트럼 (dB), Hann 창. 반환 길이 n/2 */
export function powerSpectrumDb(fft, x, out) {
  const n = fft.size; const re = new Float32Array(n), im = new Float32Array(n)
  for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n))
  fft.transform(re, im)
  for (let i = 0; i < n / 2; i++) { const p = (re[i] * re[i] + im[i] * im[i]) / (n * n); out[i] = 10 * Math.log10(p + 1e-20) }
  return out
}
