/** 정수 초 → "MM:SS" (타이머용, 60분 이상은 분이 두 자리를 넘음) */
export function fmt(s: number): string {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
}

/** 실수 초 → "MM:SS" (재생 위치용, 비정상 값은 00:00) */
export function fmtT(s: number): string {
  if (!isFinite(s) || isNaN(s) || s < 0) return '00:00'
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0')
}
