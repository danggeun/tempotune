/** 녹음 보관 정책 — persist(삭제)와 ui(예고)가 같은 값을 본다. 순수 상수라 core 에 둔다 (설계서 §C1: ui 는 persist 를 직접 보지 않음) */
export const REC_TTL_DAYS = 30
export const REC_TTL = REC_TTL_DAYS * 24 * 60 * 60 * 1000
/** 삭제 예고를 보이기 시작하는 남은 일수 (정보는 있는 것만: 그 전엔 조용히) */
export const REC_WARN_DAYS = 7
