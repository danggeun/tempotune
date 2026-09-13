/**
 * 트레이스 히스토리 길이 환산. 순수.
 *
 * 분석 프레임률 = sampleRate / hop (워클릿이 hop 샘플마다 창을 보낸다 → 44.1 k 43.1 fps, 48 k 46.9 fps).
 * 창을 프레임 개수로 고정하면 기기마다 보는 **시간**이 달라진다 → 초로 정의하고 여기서 개수로 바꾼다.
 */
export function histLenFor(sampleRate: number, sec: number, hop = 1024): number {
  const sr = isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100
  return Math.max(8, Math.round(sec * sr / hop))
}
