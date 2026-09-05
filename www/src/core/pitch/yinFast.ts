/**
 * FFT 기반 YIN — 차분 함수 d(τ) 를 O(N log N) 으로 계산하고 신뢰도를 함께 반환한다.
 *
 *   d(τ) = Σ_{j<W} (x[j] − x[j+τ])²  = Σ_{j<W} x[j]² + Σ_{j<W} x[j+τ]² − 2·r(τ),   r(τ) = Σ_{j<W} x[j]·x[j+τ]
 *
 * 첫 두 항은 누적합, r(τ) 는 길이 W 구간과 전체 창의 상호상관을 FFT(크기 2N, 순환 방지)로 얻는다.
 * 이후 CMND(누적 평균 정규화), 임계 탐색, 포물선 보간은 core/yin.ts(직접 계산)와 동일한 규칙.
 * 반환 conf = 1 − CMND(τ*) : 0(비주기) ~ 1(완전 주기). v1 은 이 값을 버렸다(설계서 §B3).
 */
import { makeFFT, type FFT } from './fft.ts'

export interface YinResult { hz: number; conf: number; tau: number }

export interface YinFast {
  /** buf 길이는 생성 시 windowSize 와 같아야 한다 */
  process(buf: Float32Array | Float64Array, sr: number): YinResult
}

export function createYinFast(windowSize: number, opts: { threshold?: number; hzMin?: number; hzMax?: number } = {}): YinFast {
  const N = windowSize, W = N >> 1
  const threshold = opts.threshold ?? 0.10
  const M = N * 2
  const fft: FFT = makeFFT(M)
  const aRe = new Float64Array(M), aIm = new Float64Array(M), xRe = new Float64Array(M), xIm = new Float64Array(M)
  const cum = new Float64Array(N + 1), d = new Float64Array(W), c = new Float64Array(W)
  const NONE: YinResult = { hz: -1, conf: 0, tau: -1 }

  return {
    process(buf, sr) {
      if (buf.length !== N) throw new Error(`buffer length must be ${N}`)
      // 탐색 범위 (샘플 단위). hzMin 이 낮을수록 tauMax 가 커진다 — W 를 넘지 못한다.
      const tauMin = Math.max(2, Math.floor(sr / (opts.hzMax ?? sr / 2)))
      const tauMax = Math.min(W - 2, Math.ceil(sr / (opts.hzMin ?? 1)))
      // 누적 제곱합
      cum[0] = 0; for (let i = 0; i < N; i++) cum[i + 1] = cum[i]! + buf[i]! * buf[i]!
      const e0 = cum[W]!
      // 상호상관 r(τ) = IFFT( conj(FFT(a)) · FFT(x) ),  a = x[0..W)
      aRe.fill(0); aIm.fill(0); xRe.fill(0); xIm.fill(0)
      for (let i = 0; i < W; i++) aRe[i] = buf[i]!
      for (let i = 0; i < N; i++) xRe[i] = buf[i]!
      fft.transform(aRe, aIm); fft.transform(xRe, xIm)
      for (let k = 0; k < M; k++) { // conj(A)·X
        const ar = aRe[k]!, ai = -aIm[k]!, xr = xRe[k]!, xi = xIm[k]!
        xRe[k] = ar * xr - ai * xi; xIm[k] = ar * xi + ai * xr
      }
      fft.inverse(xRe, xIm)
      // 차분 함수 + CMND
      d[0] = 0; c[0] = 1; let run = 0
      for (let tau = 1; tau < W; tau++) {
        const eTau = cum[tau + W]! - cum[tau]!
        let v = e0 + eTau - 2 * xRe[tau]!; if (v < 0) v = 0 // 수치 오차
        d[tau] = v; run += v
        c[tau] = run === 0 ? 0 : v / (run / tau)
      }
      // 절대 임계 탐색 (직접 YIN 과 동일 규칙: 임계 아래 첫 골짜기의 국소 최소)
      let t = -1
      for (let tau = tauMin; tau < tauMax; tau++) {
        if (c[tau]! < threshold) { while (tau + 1 < tauMax && c[tau + 1]! < c[tau]!) tau++; t = tau; break }
      }
      if (t === -1) {
        let mn = Infinity
        for (let tau = tauMin; tau < tauMax; tau++) { if (c[tau]! < mn) { mn = c[tau]!; t = tau } }
        if (t === -1 || mn > 0.35) return NONE // 0.5 면 conf 가 정확히 confMin(0.5)이 되어 폴백 프레임이 항상 트래커에 들어간다 (리뷰)
      }
      const b = (t > 0 && t < W - 1) ? t + (c[t + 1]! - c[t - 1]!) / (2 * (2 * c[t]! - c[t - 1]! - c[t + 1]!)) : t
      if (b <= 0 || !isFinite(b)) return NONE
      const conf = Math.max(0, Math.min(1, 1 - c[t]!))
      return { hz: sr / b, conf, tau: b }
    },
  }
}
