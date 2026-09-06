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
  /** 프레임 간 상태(위 성부 유지) 초기화 — analyzer.reset() 과 침묵에서 호출 */
  reset(): void
}

export function createSpectrum(windowSize: number): Spectrum {
  const N = windowSize, H = N >> 1
  const fft = makeFFT(N), win = hannWindow(N)
  const re = new Float64Array(N), im = new Float64Array(N)
  const db = new Float64Array(H), lin = new Float64Array(H)
  let sr = 44100, binHz = sr / N, floorDb = -120, maxDb = -120
  let lastUpper = -1 // 마지막으로 확정한 위 성부(Hz). 검출은 엄격, 해제는 느슨하게 — 프레임마다 검출이 빠져 아래 음으로 떨어지는 흔들림 방지
// 위 성부 탐색 비율 (위/아래), 오름차순. 정수(옥타브)는 배음과 구분 불가라 제외. 단2도(16/15)는 f0 피크 스커트와 겹쳐 제외.
const UPPER_RATIOS = [9 / 8, 6 / 5, 5 / 4, 4 / 3, 7 / 5, 3 / 2, 8 / 5, 5 / 3, 9 / 5]
const UPPER_DB = 24 // 위 성부 피크가 최대 피크보다 이만큼 아래여도 인정 (아래 음이 6배(15.6 dB) 커도 잡히게)
const VETO_DB = 12 // 정합성 거부권을 가질 피크의 최소 세기 (최대 피크 대비)
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

  /** r 이 중음 간격(UPPER_RATIOS) 중 하나와 3 % 안에서 맞는가 */
  function isUpperRatio(r: number): boolean { return UPPER_RATIOS.some(u => Math.abs(r / u - 1) < 0.03) }
  /** 후보 기본음을 실제 피크에 맞춘다: 기본음 자리에서 보간해 어느 피크인지 확정한 뒤(빈이 굵은 저음에서
   *  f0×비율 은 이웃 피크를 가리킬 수 있다 — 4×C2=261.6 창에 B3 246.9 가 걸리던 것), 그 값의 가장 높은 존재
   *  배음에서 다시 보간해 k 로 나눈다(상위 배음은 빈 대비 정밀). */
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

  return {
    get binHz() { return binHz },
    reset() { lastUpper = -1 },
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
      if (m === 1) {
        // YIN 이 실제 음 하나를 직접 잡았다. 그 음이 아래 성부일 수 있다 — 개방현이 공명하거나 먼저 시작해
        // 아래 음이 크면 YIN 은 가상 기본음 대신 아래 음을 낸다(실측: 아래 음이 6배 크면 100 % 아래 음 표시).
        // 단음의 배음은 정수배 자리에만 있으므로, f0 위쪽 **비정수 단순 비율** 자리의 강한 피크는 다른 음의 기본음이다.
        // 가장 낮은 것이 그 음의 기본음(그 위는 그 음의 배음). 찾으면 위 성부를 돌려준다.
        // 저음에서는 빈(11.7 Hz)이 굵어 이웃 비율(G3 의 6/5 와 5/4 는 10 Hz 차)이 같은 빈에 잡힌다.
        // 그래서 '먼저 걸리는 비율' 이 아니라 **배음렬(2·3·4배)이 가장 잘 맞는 비율** 을 고른다 — 상위 배음은 빈 간격
        // 대비 충분히 벌어져 구분된다. 주파수도 존재하는 가장 높은 배음에서 포물선 보간해 k 로 나눠 정밀도를 얻는다.
        let bestF = -1, bestScore = 0
        for (const r of UPPER_RATIOS) {
          const f = f0 * r; if (f >= sr / 2) break
          if (!present(f, 6)) continue
          const pf = peakNear(f, 0.03).db
          if (pf < maxDb - UPPER_DB) continue
          // 후보가 다른 음의 배음이면 안 된다: YIN 이 *위* 음을 잡은 경우 아래 음의 2·3배음이 비정수 비율 자리에
          // 나타난다(D4+A4 에서 f0=A4 면 D4 의 2배음 587 Hz 가 4/3 자리). 후보의 절반·⅓ 자리에 그에 견줄 피크가
          // 있으면 후보는 배음이므로 건너뛴다. 진짜 위 성부의 절반 자리(아래 음보다 낮은 곳)에는 에너지가 없다.
          if (peakNear(f / 2, 0.03).db >= pf - 6 || peakNear(f / 3, 0.03).db >= pf - 6) continue
          // 저음에서는 ±1빈 창이 f0 자체나 그 옥타브 배음을 잡을 수 있다(C2 65 Hz 의 9/5 자리 창에 C3 130 Hz 가 걸림).
          // 실제 피크로 보간한 값이 f0 의 정수배면 그것은 f0 의 배음이지 다른 음이 아니다 → 기각.
          const fr = refine(f), kr = Math.round(fr / f0)
          if (kr >= 1 && Math.abs(fr / f0 - kr) < 0.03 * kr) continue
          // 배음렬 점수. 단, 아래 음(f0)의 배음과 겹치는 자리는 증거가 못 되므로 뺀다 —
          // 4/3 후보의 3배음(784 Hz)이 G3 의 4배음과 겹쳐 점수가 부풀던 것(실측: G3+B3 → C4 오답).
          let score = 1
          for (let k = 2; k <= 4; k++) {
            const fk = f * k; if (fk >= sr / 2) break
            const ratio = fk / f0, nearest = Math.round(ratio)
            if (Math.abs(ratio - nearest) < 0.03 * nearest) continue // f0 의 정수배 자리 — 겹침, 제외
            if (present(fk, 6)) score++
          }
          if (score > bestScore) { bestScore = score; bestF = f }
        }
        if (bestF > 0) { lastUpper = settle(bestF); return lastUpper }
        // 검출 실패. 직전에 확정한 위 성부가 아직 **약하게라도** 있으면(6 dB 문턱만) 유지한다 — 비브라토·활 바꿈으로
        // 한두 프레임 UPPER_DB 아래로 내려가도 화면이 아래 음으로 떨어지지 않게. 완전히 사라지면 해제.
        if (lastUpper > f0 * 1.04 && lastUpper < f0 * 1.96 && present(lastUpper, 6)) return settle(lastUpper)
        lastUpper = -1
        return f0
      }
      // 두 번째 배음렬 후보: m 의 배수가 아니면서 **m 과의 비율이 실제 중음 간격(옥타브 이내 단순 비율)** 인 자리.
      // 이 제한이 없으면 우연히 걸린 높은 k(예: E3 기준 G3 의 6배음이 k=7 에 2 % 오차로 걸림 → 7/2 = 옥타브+5도)가
      // 가짜 '두 번째 음' 이 되어 D6 같은 엉뚱한 음을 낸다. 10도 이상 벌어진 중음은 드물고, 그때는 아래 음을 보여준다.
      const other = S.find(k => k % m !== 0 && isUpperRatio(k / m))
      // S 가 전부 m 의 배수 = 배음렬 하나 = 단음. 진짜 기본음은 m·f0 다.
      // (m=1 이면 그대로. m=2 는 기존의 '한 옥타브 아래로 틀린 경우' 를 포함한다 —
      //  기본음이 약한 저음현은 3f0 도 존재하므로 S 에 홀수가 들어가 여기 걸리지 않고 아래로 간다.)
      if (other === undefined) { lastUpper = -1; return f0 * m }
      // 정합성: 정당한 중음이라면 S 의 모든 자리가 m 또는 other 의 배수여야 한다.
      // 그렇지 않은 자리(예: 5·7)가 있으면 이것은 두 배음렬이 아니라 f0 자체의 배음렬 —
      // 기본음이 마이크 롤오프 등으로 6 dB 문턱 아래로 떨어진 **단음**이다(첼로 C2, 베이스 E1).
      // 이 경우 f0 를 그대로 돌려준다(v2.0.0 동작 보존). 리뷰가 잡은 회귀: 이 검사가 없으면 C2 → G3.
      // 단, 거부권은 **강한** 피크에만 준다(최대 피크 −VETO_DB 이내). 실제 중음에는 활 잡음·공명으로
      // 문턱(6 dB)을 겨우 넘는 잡스러운 피크가 흔해서, 약한 피크까지 세면 실제 중음의 절반이 기각된다
      // (실측: 가짜음 3.1 % → 8.1 % 로 역행). 약한 기본음 단음의 5·7배음은 진짜 배음이라 강하다.
      if (S.some(k => k % m !== 0 && k % other !== 0 && peakNear(f0 * k, 0.03).db >= maxDb - VETO_DB)) { lastUpper = -1; return f0 }
      // m 의 배수가 아닌 자리가 있다 = 배음렬이 둘 = 두 음이 겹쳤다. **위 성부(멜로디)** 를 돌려준다.
      // 현악 중음에서 멜로디는 거의 항상 위쪽이고, 공명하는 개방현이 섞였을 때도 연주자가 보고 싶은 것은 위 음이다.
      // m=1 경로도 같은 정책이므로 YIN 이 어느 쪽을 잡든 출력이 같다 — 그래서 별도의 '붙잡기' 상태가 필요 없다.
      lastUpper = settle(f0 * other)
      return lastUpper
    },
    peakDbNear(hz, tolRatio = 0.03) { return peakNear(hz, tolRatio).db },
  }
}
