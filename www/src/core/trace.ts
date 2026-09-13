/**
 * 트레이스 세그먼트 연결 규칙. 순수.
 *
 * 트레이스의 가로축은 **절대 음정이 아니라 '지금 음에서 얼마나 벗어났나(cents)'** 다.
 * 그래서 음이 바뀌어도 그 오차는 이어지는 양이다 — 도를 +3 ¢ 로 짚고 레를 −4 ¢ 로 짚었으면
 * 화면에는 **가운데 근처에서 이어진 선**이 나와야 한다. 정확히 연주한 스케일이 점선으로 끊겨 보이면
 * "제대로 짚었다" 는 정보가 사라진다.
 *
 * 반대로 도를 −40 ¢, 레를 +45 ¢ 로 짚었다면 이 둘을 이은 선은 초록 띠 한가운데를 가로지른다 —
 * **있지도 않았던 '맞음' 순간**을 그리는 것이다. 그 경우에만 끊는다.
 *
 * 규칙:
 *   같은 음 안  → 항상 잇는다 (글리산도·포르타멘토·트래커 부스트 점프는 전부 실제 움직임)
 *   음이 바뀜   → 두 오차의 차이가 JOIN_MAX 이하면 잇고, 넘으면 끊는다
 *
 * 임계 근거 (실측, `scripts/sim-scale.mjs`): 80 BPM 스케일을 ±5 ¢ 정확도로 연주했을 때 전환 지점의
 * Δcents 는 **평균 22 ¢ · 최대 31 ¢**. 음정이 흔들린 연주(±40 ¢대)는 전환 Δ 가 85 ¢ 를 넘는다.
 *
 * X4(「v2.0.2 계획」)와 다른 점: 거기서 기각된 것은 **Δ 임계만으로 전환을 판정**하는 방식이었다
 * (정당한 빠른 슬라이드와 구분 불가). 여기서는 전환 여부를 `midi` 로 **정확히** 판정하고,
 * Δ 는 "이 전환을 이을지" 만 정한다 → 음 안의 빠른 이동은 절대 끊기지 않는다.
 */
export const TRACE_JOIN_MAX = 40

/** i 와 i+1 을 선으로 이을 것인가. null(무음)은 호출부가 먼저 거른다. */
export function joinSegment(c0: number, c1: number, m0: number | null, m1: number | null, joinMax = TRACE_JOIN_MAX): boolean {
  if (m0 === m1) return true
  return Math.abs(c1 - c0) <= joinMax
}

/**
 * 그릴 선분 목록 [i, j] 을 만든다.
 *
 * **경계에 걸친 프레임 한 개는 버린다.** 분석 창이 4096 샘플(93 ms)이라, 상태가 바뀌는 순간의 창 하나는
 * **두 상태에 걸친다** — 추정값이 둘 사이 어딘가로 나온다. 버리는 경계는 세 가지:
 *   · 음 → 다른 음  (레가토 전환)
 *   · 소리 → 무음    (음이 꺼지는 순간)
 *   · 무음 → 소리    (음이 시작하는 순간)
 *
 * 실측(`scripts/sim-scale.mjs`, 80 BPM 스케일을 ±5 ¢ 정확도로 연주): 전환마다 **정확히 한 프레임만**
 * +10~+21 ¢ 로 튀고 앞뒤는 ±2 ¢ 로 안정적이다. 음이 꺼질 때는 한 프레임이 +47 ¢ 까지 갔다.
 * 이 프레임들은 **연주가 아니라 창의 부작용**이라, 그리면 "음 바뀔 때마다 옆으로 튀는" 것으로만 보인다.
 * 21 ms 를 버리는 대신 앞뒤의 안정값이 곧바로 이어진다.
 *
 * 경계는 `midi`·`null` 로 **정확히** 판정한다(임계 추측이 아니다). 한 음 안에서는 아무것도 버리지 않는다.
 */
export interface TraceSegments {
  /** 그릴 선분 [i, j] */
  segs: Array<[number, number]>
  /** 음이 바뀌는데 오차 차이가 커서 **잇지 않은** 자리 수 (진단·테스트용). 경계 프레임 폐기는 여기 안 센다 */
  breaks: number
}
export function buildSegments(cents: ReadonlyArray<number | null>, midi: ReadonlyArray<number | null>, joinMax = TRACE_JOIN_MAX): TraceSegments {
  const n = cents.length
  const boundary = (i: number): boolean => {
    if (i + 1 >= n) return false                       // 버퍼 끝은 경계가 아니다 (아직 이어지는 중)
    if (cents[i + 1] == null) return true              // 소리 → 무음
    if (i > 0 && cents[i - 1] == null) return true     // 무음 → 소리 (시작 프레임)
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
