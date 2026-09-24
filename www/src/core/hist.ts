/** 트레이스 히스토리 길이(초 → 프레임 수). 프레임률 = sampleRate / hop (44.1 k 43.1 fps, 48 k 46.9 fps) */
export function histLenFor(sampleRate: number, sec: number, hop = 1024): number {
  const sr = isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100
  return Math.max(8, Math.round(sec * sr / hop))
}
