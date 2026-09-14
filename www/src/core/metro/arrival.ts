/**
 * 메트로놈 클릭 **도착 시각 자가 보정** (v2.0.3 M1). 순수.
 *
 * 문제(실측, scripts/metro-blip.mjs): 클릭이 마이크로 되돌아오는 구간(mute)을 `예약 시각 + 출력 지연` 으로만 잡는다.
 * 그런데 소리는 `출력 지연 + 공기 + **입력 지연**` 을 거쳐 돌아오고, 입력 지연은 Web Audio 에 표준 API 가 없어
 * 알 수 없다(안드로이드 20~80 ms+, 블루투스 100 ms+). 구간이 +80 ms 만 어긋나도 클릭이 창 밖으로 새어
 * 정박마다 라6(1760 Hz = 강박 클릭 음높이)이 떴다 사라진다.
 *
 * 해법: 마이크 신호에서 **클릭이 실제로 도착한 시각**을 찾아 오차를 잰다. 클릭은 1.5 ms 잡음 버스트 + 단단한
 * 어택이라 **인접 샘플 차분 에너지(고역)** 가 순간적으로 치솟는다 — 활 소리는 그렇지 않다. 예약 시각 근처
 * [−before, +after] 에서 그 스파이크를 찾고, 창 안 중앙값 대비 충분히 도드라질 때만 후보로 인정한다.
 *
 * 오검출 방어 (이어폰이면 클릭이 마이크에 안 들어온다 — 그때 활 소리 어택을 클릭으로 오인하면 안 된다):
 *   · 후보는 최근 `ring` 개를 모아 **중앙값**을 쓰고,
 *   · 그중 `minAgree` 개 이상이 중앙값 ±`agreeTol` 안에 모여야만 보정을 적용한다. 흩어져 있으면 0(= 지금 동작).
 *   · 범위 밖(음수 크게·300 ms 초과)은 버린다.
 */
export interface ArrivalParams {
  /** 예약 시각 앞뒤 탐색 폭(초) */
  searchBefore: number; searchAfter: number
  /** 스파이크 에너지가 탐색 창 중앙값의 몇 배여야 클릭으로 보나 */
  minProminence: number
  /** 최근 후보 보관 개수 · 그중 합의해야 하는 개수 · 합의 허용 오차(초) */
  ring: number; minAgree: number; agreeTol: number
  /** 인정할 오차 범위(초) */
  clampMin: number; clampMax: number
  /** 에너지 이력 보관 시간(초) */
  keepSec: number
}
/**
 * ring 6 · minAgree 3: 80 BPM 에서 **3박(2.3 초) 안에** 수렴. 침묵 중에는 가짜 스파이크가 없어 3개면 충분하고,
 * 연주 중에는 클릭이 활 소리에 묻혀 후보가 아예 안 나온다(실측) — 그래서 못 찾은 박은 후보를 **밀어내지 않는다**.
 * 밀어내면 한 프레이즈 연주할 때마다 보정이 사라져 쉴 때마다 다시 라6 이 뜬다.
 */
export const DEFAULT_ARRIVAL: ArrivalParams = { searchBefore: 0.05, searchAfter: 0.30, minProminence: 6, ring: 6, minAgree: 3, agreeTol: 0.03, clampMin: -0.03, clampMax: 0.30, keepSec: 2 }

/** 기다리는 클릭 예정 시각의 상한 — 실제로는 몇 개면 충분하다. 넘치면 가장 오래된 것부터 버린다 (R8) */
const MAX_PENDING = 64

export interface Arrival {
  /** 블록 하나의 차분 에너지 (t = 블록 끝 시각, 오디오 시계 초) */
  pushEnergy(t: number, e: number): void
  /** 클릭이 마이크에 닿을 것으로 **예상한** 시각 (예약 + 출력 지연) */
  expect(at: number): void
  /** 진단/테스트: 아직 평가되지 않은 예상 시각의 개수 */
  pendingCount(): number
  /** 시각이 now 까지 왔다 — 탐색 창이 다 지난 예상 시각들을 평가한다 */
  update(now: number): void
  /** 적용할 보정(초). 합의가 없으면 0 */
  offset(): number
  reset(): void
  diag(): { offset: number; candidates: number[]; applied: boolean }
}

export function createArrival(p: ArrivalParams = DEFAULT_ARRIVAL): Arrival {
  const T: number[] = [], E: number[] = []      // 에너지 이력 (시간순)
  const pending: number[] = []                  // 아직 평가 안 한 예상 시각
  const cands: number[] = []                    // 최근 후보 오차
  let off = 0, applied = false

  function evaluate(at: number): number | null {
    const lo = at - p.searchBefore, hi = at + p.searchAfter
    let i0 = -1, i1 = -1
    for (let i = 0; i < T.length; i++) { if (T[i]! >= lo && i0 < 0) i0 = i; if (T[i]! <= hi) i1 = i }
    if (i0 < 0 || i1 < i0 || i1 - i0 < 8) return null
    let best = -1, bi = -1; const sorted: number[] = []
    for (let i = i0; i <= i1; i++) { const e = E[i]!; sorted.push(e); if (e > best) { best = e; bi = i } }
    sorted.sort((a, b) => a - b); const med = sorted[sorted.length >> 1]!
    if (!(best > med * p.minProminence) || best <= 0) return null
    const d = T[bi]! - at
    return d < p.clampMin || d > p.clampMax ? null : d
  }
  /** cands = 최근 ring 개의 **찾은** 후보. 중앙값 ±agreeTol 에 minAgree 개가 모이면 그 합의 집합의 중앙값을 쓴다.
   *  (이어폰으로 바꿔 클릭이 안 들어오면 후보가 안 생겨 마지막 보정이 남는다 — 무해: 어차피 새는 클릭이 없고,
   *   창이 연주 프레임에 걸리는 비용은 보정이 없던 지금과 같다. 스피커로 돌아오면 새 후보가 옛것을 밀어낸다) */
  function recompute(): void {
    if (cands.length < p.minAgree) { off = 0; applied = false; return }
    const s = [...cands].sort((a, b) => a - b), m = s[s.length >> 1]!
    const agree = cands.filter(c => Math.abs(c - m) <= p.agreeTol).sort((a, b) => a - b)
    if (agree.length >= p.minAgree) { off = agree[agree.length >> 1]!; applied = true } else { off = 0; applied = false }
  }
  return {
    pushEnergy(t, e) {
      T.push(t); E.push(e)
      const cut = t - p.keepSec; let k = 0; while (k < T.length && T[k]! < cut) k++
      if (k) { T.splice(0, k); E.splice(0, k) }
    },
    expect(at) { pending.push(at); if (pending.length > MAX_PENDING) pending.shift() }, // 오디오가 멈춰 update 가 안 오면 무한히 쌓인다 (R8)
    pendingCount: () => pending.length,
    update(now) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const at = pending[i]!
        if (now < at + p.searchAfter + 0.02) continue
        pending.splice(i, 1)
        const d = evaluate(at)
        if (d === null) continue // 못 찾음(연주 중·이어폰): 후보를 밀어내지 않는다
        cands.push(d); if (cands.length > p.ring) cands.shift()
        recompute()
      }
    },
    offset() { return off },
    reset() { T.length = 0; E.length = 0; pending.length = 0; cands.length = 0; off = 0; applied = false },
    diag() { return { offset: off, candidates: [...cands], applied } },
  }
}
