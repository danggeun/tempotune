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
  let lastResolved = -1 // 중음 붙잡기용 — 직전에 내보낸 주파수
const STICK_CENTS = 60 // 직전 음과 같은 음으로 볼 반음 이내 허용치
const K_MAX = 12 // f0 위로 조사할 배수 상한. 장2도(8:9)·단6도(5:8) 같은 중음까지 덮는다
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
      const p0 = peakNear(f0, 0.03).db
      // 한 옥타브 위로 틀린 경우: 진짜 기본음 f0/2 와 그 홀수 배음 3f0/2 가 f0 피크에 견줄 만큼(−15/−20 dB 이내) 존재한다.
      // 레벨 조건이 없으면 공명하는 개방현(−20 dB 아래)만으로 옥타브가 떨어진다 (리뷰 지적).
      if (present(f0 / 2) && present(f0 * 1.5) && peakNear(f0 / 2, 0.03).db >= p0 - 15 && peakNear(f0 * 1.5, 0.03).db >= p0 - 20) return f0 / 2

      // ── f0 위쪽 배수 자리 조사 ──
      // YIN 은 시간축 주기성만 본다. 두 음이 겹치면(중음) 합성 신호의 주기가 두 주파수의 최대공약수에서
      // 생기고, YIN 은 연주되지 않은 그 '가상 기본음' 을 높은 신뢰도로 보고한다. 실측(바이올린 중음 12종):
      // 완전5도 → 아래 음의 한 옥타브 밑, 장3도 → 두 옥타브 밑, 장6도·완전4도 → 그 사이.
      // 핵심: 가상 기본음은 두 음 모두의 하위 배음이므로 **실제 음은 그 정수배 자리에 있다.**
      const S: number[] = []
      for (let k = 1; k <= K_MAX; k++) { if (f0 * k >= sr / 2) break; if (present(f0 * k, 6)) S.push(k) }
      if (S.length === 0) return f0 // 아무 근거 없음 — 호출부가 신뢰도로 처리한다
      const m = S[0]!
      const other = S.find(k => k % m !== 0)
      // S 가 전부 m 의 배수 = 배음렬 하나 = 단음. 진짜 기본음은 m·f0 다.
      // (m=1 이면 그대로. m=2 는 기존의 '한 옥타브 아래로 틀린 경우' 를 포함한다 —
      //  기본음이 약한 저음현은 3f0 도 존재하므로 S 에 홀수가 들어가 여기 걸리지 않고 아래로 간다.)
      if (other === undefined) { lastResolved = f0 * m; return lastResolved }
      // m 의 배수가 아닌 자리가 있다 = 배음렬이 둘 = 두 음이 겹쳤다.
      // 기본은 위 성부 — 현악 중음에서 멜로디는 거의 항상 위쪽이고,
      // 공명하는 개방현이 섞였을 때도 연주자가 보고 싶은 것은 위 음이다.
      //
      // 다만 두 음이 동시에 울리는 동안 YIN 이 프레임마다 어느 쪽을 잡을지 흔들린다.
      // 매 프레임 독립적으로 고르면 바늘이 두 실음 사이를 오간다(실측: 라벨 유지 155 ms).
      // 그래서 **직전에 내보낸 음이 아직 후보 안에 있으면 그것을 유지한다** — 붙잡기.
      // 곡이 진행해 그 음이 후보에서 사라지면 조건이 저절로 풀려 위 성부로 돌아간다.
      const cands = [f0 * m, f0 * other]
      const stick = lastResolved > 0 ? cands.find(c => Math.abs(1200 * Math.log2(c / lastResolved)) < STICK_CENTS) : undefined
      lastResolved = stick ?? f0 * other
      return lastResolved
    },
    peakDbNear(hz, tolRatio = 0.03) { return peakNear(hz, tolRatio).db },
  }
}
