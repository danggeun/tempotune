/**
 * 스펙트럼 특징 — 하모닉 수, 스펙트럼 평탄도, 옥타브 후보 점수.
 * 한 프레임에 FFT 1회(Hann 창) 후 여러 질의를 받는다. AnalyserNode 대체.
 */
import { makeFFT, hannWindow } from './fft.ts'

export interface Spectrum {
  /** 프레임 갱신 (buf 길이 = windowSize) */
  update(buf: Float32Array | Float64Array, sr: number): void
  /** f0 의 배음 k=1..maxK 중 국소 바닥보다 minDb 이상 솟은 피크 개수 */
  harmonicCount(f0: number, maxK?: number, minDb?: number): number
  /** 밴드 내 스펙트럼 평탄도 (0=순음/배음 구조, 1=백색잡음) */
  flatness(loHz?: number, hiHz?: number): number
  /** f0/2, f0, 2f0 중 배음 구조 점수가 가장 높은 후보 (f0 에 약간의 편향). 반환은 보정된 주파수 */
  octaveCorrect(f0: number): number
  /** 특정 주파수 근처(±tol 비율)의 최대 크기(dB) */
  peakDbNear(hz: number, tolRatio?: number): number
  /** 빈 폭 (Hz) */
  readonly binHz: number
}

export function createSpectrum(windowSize: number): Spectrum {
  const N = windowSize, H = N >> 1
  const fft = makeFFT(N), win = hannWindow(N)
  const re = new Float64Array(N), im = new Float64Array(N)
  const db = new Float64Array(H), lin = new Float64Array(H)
  let sr = 44100, binHz = sr / N, floorDb = -120, maxDb = -120
const REL_DB = 40 // 배음으로 인정하려면 프레임 최대 피크 대비 이 값 이내여야 함 (창 누설 피크 배제)

  /** hz 근처(±max(1빈, tolRatio))에서 국소 최대(local max)인 빈. 이웃 피크의 창 누설 스커트는 단조 구간이라 제외된다. */
  function peakNear(hz: number, tolRatio: number): { db: number; bin: number } {
    const b = hz / binHz, half = Math.max(1, b * tolRatio)
    const lo = Math.max(1, Math.round(b - half)), hi = Math.min(H - 2, Math.round(b + half))
    let best = -Infinity, bb = -1
    for (let i = lo; i <= hi; i++) { const v = db[i]!; if (v > best && v >= db[i - 1]! && v >= db[i + 1]!) { best = v; bb = i } }
    if (bb === -1) return { db: -Infinity, bin: Math.round(b) }
    return { db: best, bin: bb }
  }
  /** 잡음 바닥 = 40–5000 Hz 밴드 dB 의 중앙값. 배음 신호에서는 대부분의 빈이 피크가 아니므로 배음 사이의 바닥이 된다.
   *  (피크 주변 ±k 빈 평균은 저음에서 이웃 배음을 포함해 틀렸다 — C2 65 Hz 는 배음 간격이 6 빈) */
  let medianDb = -120
  const sortBuf = new Float64Array(H)
  function computeFloor(): void {
    const lo = Math.max(1, Math.floor(40 / binHz)), hi = Math.min(H - 1, Math.ceil(5000 / binHz))
    const n = hi - lo + 1; for (let i = 0; i < n; i++) sortBuf[i] = db[lo + i]!
    const v = sortBuf.subarray(0, n).sort(); medianDb = v[n >> 1]!
  }
  function localFloor(_bin: number): number { return medianDb }
  /** 국소 바닥 대비 minDb 이상 솟고, 프레임 최대 피크 대비 REL_DB 이내인 피크가 hz 근처에 있는가 */
  function present(hz: number, minDb = 12): boolean {
    if (hz < 20 || hz >= sr / 2) return false
    const p = peakNear(hz, 0.03)
    return p.db - localFloor(p.bin) >= minDb && p.db >= maxDb - REL_DB
  }

  return {
    get binHz() { return binHz },
    update(buf, s) {
      sr = s; binHz = sr / N
      for (let i = 0; i < N; i++) { re[i] = buf[i]! * win[i]!; im[i] = 0 }
      fft.transform(re, im)
      floorDb = Infinity; maxDb = -Infinity
      for (let i = 0; i < H; i++) { const p = (re[i]! * re[i]! + im[i]! * im[i]!) / (N * N); lin[i] = p; const v = 10 * Math.log10(p + 1e-20); db[i] = v; if (v < floorDb) floorDb = v; if (i >= 2 && v > maxDb) maxDb = v }
      computeFloor()
    },
    harmonicCount(f0, maxK = 8, minDb = 12) {
      let n = 0
      for (let k = 1; k <= maxK; k++) { if (f0 * k >= sr / 2) break; if (present(f0 * k, minDb)) n++ }
      return n
    },
    flatness(loHz = 60, hiHz = 5000) {
      const lo = Math.max(1, Math.floor(loHz / binHz)), hi = Math.min(H - 1, Math.ceil(hiHz / binHz))
      let logSum = 0, sum = 0, n = 0
      for (let i = lo; i <= hi; i++) { const p = lin[i]! + 1e-20; logSum += Math.log(p); sum += p; n++ }
      if (!n) return 1
      return Math.exp(logSum / n) / (sum / n)
    },
    octaveCorrect(f0) {
      // 한 옥타브 위로 틀린 경우: 진짜 기본음 f0/2 와 그 홀수 배음 3f0/2 가 실제로 존재한다
      if (present(f0 / 2) && present(f0 * 1.5)) return f0 / 2
      // 한 옥타브 아래로 틀린 경우: f0 자리에 에너지가 없고 2f0 부터 배음이 있다
      if (!present(f0, 6) && present(f0 * 2) && present(f0 * 4)) return f0 * 2
      return f0
    },
    peakDbNear(hz, tolRatio = 0.03) { return peakNear(hz, tolRatio).db },
  }
}
