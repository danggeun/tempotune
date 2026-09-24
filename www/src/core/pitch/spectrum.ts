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
  /** 직전 octaveCorrect 가 두 배음렬을 봤을 때 그 두 기본음 (lo 아래, up 위, 없으면 -1). 중음 표시용 */
  voices(): { lo: number; up: number }
  /** 빈 폭 (Hz) */
  readonly binHz: number
  /** 프레임 간 상태(위 성부 유지) 초기화 — analyzer.reset() 과 침묵에서 호출 */
  reset(): void
}

export function createSpectrum(windowSize: number): Spectrum {
  const N = windowSize, H = N >> 1
  const fft = makeFFT(N), win = hannWindow(N)
  const re = new Float64Array(N), im = new Float64Array(N)
  const db = new Float64Array(H), lin = new Float64Array(H)
  let sr = 44100, binHz = sr / N, floorDb = -120, maxDb = -120
  let pairLo = -1, pairUp = -1 // 직전 프레임에서 본 두 성부 (없으면 -1). 표시 경로만 읽는다
  let lastUpper = -1 // 마지막으로 확정한 위 성부(Hz). 검출은 엄격, 해제는 느슨하게
// 위 성부 탐색 비율 (위/아래), 오름차순. 정수(옥타브)는 배음과 구분 불가, 단2도(16/15)는 f0 피크 스커트와 겹쳐 제외
const UPPER_RATIOS = [9 / 8, 6 / 5, 5 / 4, 4 / 3, 7 / 5, 3 / 2, 8 / 5, 5 / 3, 9 / 5]
const UPPER_DB = 24 // 위 성부 피크가 최대 피크보다 이만큼 아래여도 인정 (아래 음이 6배 = 15.6 dB 커도)
const VETO_DB = 12 // 정합성 거부권을 가질 피크의 최소 세기 (최대 피크 대비)
const K_MAX = 12 // f0 위로 조사할 배수 상한. 장2도(8:9)·단6도(5:8) 중음까지 덮는다
const REL_DB = 40 // 배음으로 인정할 프레임 최대 피크 대비 상한 (창 누설 피크 배제)

  /** hz 근처(±max(1빈, tolRatio))의 국소 최대 빈. 이웃 피크의 창 누설 스커트는 단조 구간이라 제외된다 */
  function peakNear(hz: number, tolRatio: number): { db: number; bin: number } {
    const b = hz / binHz, half = Math.max(1, b * tolRatio)
    const lo = Math.max(1, Math.round(b - half)), hi = Math.min(H - 2, Math.round(b + half))
    let best = -Infinity, bb = -1
    for (let i = lo; i <= hi; i++) { const v = db[i]!; if (v > best && v >= db[i - 1]! && v >= db[i + 1]!) { best = v; bb = i } }
    if (bb === -1) return { db: -Infinity, bin: Math.round(b) }
    return { db: best, bin: bb }
  }
  /** 잡음 바닥 = 40–5000 Hz 밴드 dB 의 중앙값 (피크 주변 평균은 저음에서 이웃 배음을 포함한다 — C2 는 배음 간격 6 빈) */
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

  /** r 이 중음 간격(UPPER_RATIOS) 중 하나와 3 % 안에서 맞는가 */
  function isUpperRatio(r: number): boolean { return UPPER_RATIOS.some(u => Math.abs(r / u - 1) < 0.03) }
  /** 후보 기본음을 실제 피크에 맞춘다: 기본음 자리에서 보간해 피크를 확정한 뒤, 가장 높은 존재 배음에서 다시 보간해 k 로 나눈다 */
  function settle(fCand: number): number {
    const f1 = refine(fCand)
    for (let k = 4; k >= 2; k--) { const fk = f1 * k; if (fk < sr / 2 && present(fk, 6)) return refine(fk) / k }
    return f1
  }
  /** hz 근처 국소 최대의 포물선 보간 주파수 (Hann 창 dB 스펙트럼에서 ±0.1 빈 정도) */
  function refine(hz: number): number {
    const { bin } = peakNear(hz, 0.03); if (bin <= 0 || bin >= H - 1) return hz
    const a = db[bin - 1]!, b = db[bin]!, c = db[bin + 1]!
    const den = a - 2 * b + c; const d = den === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (a - c) / (2 * den)))
    return (bin + d) * binHz
  }

  /** 두 성부 기록. 기본음 자리만 포물선 보간 — 중음에서는 상위 배음이 겹쳐(4도: 아래×4 = 위×3) settle() 이 틀린다 */
  function setPair(lo: number, up: number): void { pairLo = refine(lo); pairUp = refine(up) }

  return {
    get binHz() { return binHz },
    reset() { lastUpper = -1; pairLo = -1; pairUp = -1 },
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
      pairLo = -1; pairUp = -1
      const p0 = peakNear(f0, 0.03).db
      // 한 옥타브 위로 틀린 경우: f0/2 와 3f0/2 가 f0 피크에 견줄 만큼(−15/−20 dB 이내) 있어야 한다 — 공명 개방현만으로 떨어지지 않게
      if (present(f0 / 2) && present(f0 * 1.5) && peakNear(f0 / 2, 0.03).db >= p0 - 15 && peakNear(f0 * 1.5, 0.03).db >= p0 - 20) return f0 / 2

      // f0 위쪽 배수 자리 조사. 중음이면 YIN 은 두 음의 최대공약수(가상 기본음)를 내고, 실제 음은 그 정수배 자리에 있다
      const S: number[] = []
      for (let k = 1; k <= K_MAX; k++) { if (f0 * k >= sr / 2) break; if (present(f0 * k, 6)) S.push(k) }
      if (S.length === 0) return f0 // 근거 없음 — 호출부가 신뢰도로 처리한다
      const m = S[0]!
      if (m === 1) {
        // YIN 이 실제 음 하나를 잡았고 그것이 아래 성부일 수 있다. f0 위쪽 비정수 단순 비율 자리의 강한 피크는 다른 음의 기본음.
        // 저음은 빈이 굵어 이웃 비율이 같은 빈에 잡히므로, 먼저 걸리는 비율이 아니라 배음렬(2·3·4배)이 가장 잘 맞는 비율을 고른다
        let bestF = -1, bestScore = 0
        for (const r of UPPER_RATIOS) {
          const f = f0 * r; if (f >= sr / 2) break
          if (!present(f, 6)) continue
          const pf = peakNear(f, 0.03).db
          if (pf < maxDb - UPPER_DB) continue
          // 후보의 절반·⅓ 자리에 견줄 피크가 있으면 후보는 아래 음의 배음이다 (YIN 이 위 음을 잡은 경우)
          if (peakNear(f / 2, 0.03).db >= pf - 6 || peakNear(f / 3, 0.03).db >= pf - 6) continue
          // 보간한 실제 피크가 f0 의 정수배면 f0 의 배음이지 다른 음이 아니다 (저음에서 ±1빈 창이 옥타브 배음을 잡는다)
          const fr = refine(f), kr = Math.round(fr / f0)
          if (kr >= 1 && Math.abs(fr / f0 - kr) < 0.03 * kr) continue
          // 배음렬 점수. f0 의 배음과 겹치는 자리는 증거가 못 되므로 뺀다
          let score = 1
          for (let k = 2; k <= 4; k++) {
            const fk = f * k; if (fk >= sr / 2) break
            const ratio = fk / f0, nearest = Math.round(ratio)
            if (Math.abs(ratio - nearest) < 0.03 * nearest) continue // f0 의 정수배 자리 — 겹침, 제외
            if (present(fk, 6)) score++
          }
          if (score > bestScore) { bestScore = score; bestF = f }
        }
        if (bestF > 0) { lastUpper = settle(bestF); setPair(f0, bestF); return lastUpper }
        // 검출 실패: 직전 위 성부가 약하게라도(6 dB) 남아 있으면 유지 — 비브라토·활 바꿈에 아래 음으로 떨어지지 않게
        if (lastUpper > f0 * 1.04 && lastUpper < f0 * 1.96 && present(lastUpper, 6)) { setPair(f0, lastUpper); return settle(lastUpper) }
        lastUpper = -1
        return f0
      }
      // 두 번째 배음렬 후보: m 의 배수가 아니면서 m 과의 비율이 중음 간격(옥타브 이내 단순 비율)인 자리 — 우연한 높은 k 배제
      const other = S.find(k => k % m !== 0 && isUpperRatio(k / m))
      // S 가 전부 m 의 배수 = 배음렬 하나 = 단음. 진짜 기본음은 m·f0
      if (other === undefined) { lastUpper = -1; return f0 * m }
      // 정합성: m·other 의 배수가 아닌 강한 피크(최대 −VETO_DB 이내)가 있으면 기본음이 약한 단음의 배음렬이다 (첼로 C2) → f0 유지.
      // 약한 피크까지 세면 활 잡음·공명 탓에 실제 중음의 절반이 기각된다
      if (S.some(k => k % m !== 0 && k % other !== 0 && peakNear(f0 * k, 0.03).db >= maxDb - VETO_DB)) { lastUpper = -1; return f0 }
      // 배음렬이 둘 = 두 음이 겹쳤다. 위 성부(멜로디)를 돌려준다 — m=1 경로와 같은 정책
      lastUpper = settle(f0 * other)
      setPair(f0 * m, f0 * other)
      return lastUpper
    },
    peakDbNear(hz, tolRatio = 0.03) { return peakNear(hz, tolRatio).db },
    voices() { return { lo: pairLo, up: pairUp } },
  }
}
