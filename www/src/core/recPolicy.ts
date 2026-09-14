/** 녹음 보관 정책 — persist(삭제)와 ui(예고)가 같은 값을 본다. 순수 상수라 core 에 둔다 (설계서 §C1: ui 는 persist 를 직접 보지 않음) */
export const REC_TTL_DAYS = 30
export const REC_TTL = REC_TTL_DAYS * 24 * 60 * 60 * 1000
/** 삭제 예고를 보이기 시작하는 남은 일수 (정보는 있는 것만: 그 전엔 조용히) */
export const REC_WARN_DAYS = 7

/**
 * 이 녹음이 지금 자동 삭제 대상인가 (F2). persist(실제 삭제)와 ui(예고문)가 **같은 함수**를 본다 —
 * 두 곳에 같은 계산을 따로 두면 "곧 삭제" 라 써놓고 안 지우거나 그 반대가 된다 (설계서 §C1).
 * - autoDelete 가 꺼져 있으면 지우지 않는다 (설정 '계속 보관')
 * - keep(개별 보관)이 켜져 있으면 지우지 않는다
 * - ts 가 없는 구버전 행은 나이를 알 수 없으므로 지우지 않는다
 * 순수.
 */
export function expires(ts: number | undefined, keep: boolean | undefined, autoDelete: boolean, now: number): boolean {
  if (!autoDelete || keep || typeof ts !== 'number') return false
  return now - ts > REC_TTL
}

/**
 * 삭제 예고에 쓸 남은 일수. 예고할 때가 아니면 null (마지막 REC_WARN_DAYS 일만 알린다 — 정보는 있는 것만).
 * floor 이라 24시간 미만은 0 = '오늘'. 순수.
 */
export function warnDaysLeft(ts: number | undefined, keep: boolean | undefined, autoDelete: boolean, now: number): number | null {
  if (!autoDelete || keep || typeof ts !== 'number') return null
  const d = Math.max(0, Math.floor((ts + REC_TTL - now) / 86400000))
  return d < REC_WARN_DAYS ? d : null
}
