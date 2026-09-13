/**
 * 녹음 재생 보정 게인. 순수.
 *
 * 왜 (B12c): 마이크는 `autoGainControl:false` 로 열린다 — 튜너에는 옳지만, 보면대 옆 1 m 바이올린은
 * 파일이 −20 dBFS 대로 녹음된다. 재생은 `new Audio().play()` 였으므로 1.0 을 넘을 방법이 없었다.
 * 녹음할 때 실제 피크를 알고 있으면(recorder 가 meta 에 저장) 그만큼 되돌려 준다.
 */
/** 목표 피크 (−1 dBFS). 0 dBFS 에 붙이지 않는 건 디코더/리샘플러 오버슈트 여유 */
export const TARGET_PEAK = 0.89
/** 상한 (+18 dB). 이 위로 올리면 마이크 자체 잡음 바닥이 올라온다 */
export const MAX_GAIN = 8
/** 피크 정보가 없는 옛 녹음(v2.0.1 이전)에 쓰는 기본 부스트. 소프트 리미터가 뒤에 있어 클리핑은 안 난다 */
export const LEGACY_GAIN = 2.5

/** @param peak 원시 절대 피크 (0..1). 없거나 이상하면 LEGACY_GAIN */
export function playbackGain(peak: number | undefined): number {
  if (typeof peak !== 'number' || !isFinite(peak) || peak <= 0) return LEGACY_GAIN
  if (peak >= TARGET_PEAK) return 1 // 이미 충분히 큰 녹음은 건드리지 않는다
  return Math.min(MAX_GAIN, TARGET_PEAK / peak)
}
