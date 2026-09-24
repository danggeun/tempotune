/** 녹음 재생 보정 게인. 순수. 마이크는 autoGainControl:false 라 −20 dBFS 대 녹음을 meta 의 피크로 되돌린다 */
/** 목표 피크 (−1 dBFS). 디코더/리샘플러 오버슈트 여유 */
export const TARGET_PEAK = 0.89
/** 상한 (+18 dB). 이 위로는 마이크 잡음 바닥이 올라온다 */
export const MAX_GAIN = 8
/** 피크 정보가 없는 녹음의 기본 부스트. 뒤의 소프트 리미터가 클리핑을 막는다 */
export const LEGACY_GAIN = 2.5

/** @param peak 원시 절대 피크 (0..1). 없거나 이상하면 LEGACY_GAIN */
export function playbackGain(peak: number | undefined): number {
  if (typeof peak !== 'number' || !isFinite(peak) || peak <= 0) return LEGACY_GAIN
  if (peak >= TARGET_PEAK) return 1
  return Math.min(MAX_GAIN, TARGET_PEAK / peak)
}
