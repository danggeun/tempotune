/**
 * 트레이스 세그먼트 연결 규칙. 순수. 가로축은 cents 오차라 음이 바뀌어도 이어지는 양이다.
 * 같은 음 안은 항상 잇고, 음이 바뀌면 두 오차의 차이가 TRACE_JOIN_MAX 이하일 때만 잇는다.
 */
/** 정확한 스케일의 전환 Δcents 는 평균 22 ¢ · 최대 31 ¢, 흔들린 연주(±40 ¢대)는 85 ¢ 초과 */
export const TRACE_JOIN_MAX = 40

/** 유지(held) 프레임 허용 수 — held ≤ 이 값이면 그린다. 0 이면 활 바꿈의 한두 프레임 유지가 선을 점선으로 끊는다 */
export const TRACE_HELD_MAX = 2

/** 이 프레임을 트레이스에 쌓을 것인가. hz -1(무음)·유지 초과는 빈칸. 바늘·음이름은 이 규칙과 무관 */
export function keepInTrace(hz: number, held: number, heldMax = TRACE_HELD_MAX): boolean {
  return hz !== -1 && held <= heldMax
}

/** i 와 i+1 을 선으로 이을 것인가. null(무음)은 호출부가 먼저 거른다 */
export function joinSegment(c0: number, c1: number, m0: number | null, m1: number | null, joinMax = TRACE_JOIN_MAX): boolean {
  if (m0 === m1) return true
  return Math.abs(c1 - c0) <= joinMax
}

/**
 * 그릴 선분 목록 [i, j]. 경계(음→다른 음, 소리→무음, 무음→소리)에 걸친 프레임 한 개는 버린다 —
 * 4096 샘플(93 ms) 창이 두 상태에 걸쳐 추정값이 그 사이로 튄다. 경계는 midi·null 로 판정한다.
 */
export interface TraceSegments {
  /** 그릴 선분 [i, j] */
  segs: Array<[number, number]>
  /** 음이 바뀌는데 오차 차이가 커서 잇지 않은 자리 수 (진단·테스트용). 경계 프레임 폐기는 안 센다 */
  breaks: number
}
export function buildSegments(cents: ReadonlyArray<number | null>, midi: ReadonlyArray<number | null>, joinMax = TRACE_JOIN_MAX): TraceSegments {
  const n = cents.length
  const boundary = (i: number): boolean => {
    if (i + 1 >= n) return false                       // 버퍼 끝은 경계가 아니다
    if (cents[i + 1] == null) return true              // 소리 → 무음
    if (i > 0 && cents[i - 1] == null) return true     // 무음 → 소리
    return midi[i] !== midi[i + 1]                     // 음 → 다른 음
  }
  const segs: Array<[number, number]> = []
  let prev = -1, breaks = 0
  for (let i = 0; i < n; i++) {
    if (cents[i] == null) { prev = -1; continue }
    if (boundary(i)) continue
    if (prev >= 0) {
      if (joinSegment(cents[prev]!, cents[i]!, midi[prev] ?? null, midi[i] ?? null, joinMax)) segs.push([prev, i])
      else breaks++
    }
    prev = i
  }
  return { segs, breaks }
}
