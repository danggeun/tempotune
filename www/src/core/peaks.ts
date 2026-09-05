/** 파형 미니맵 — 채널 데이터를 bins 개 구간의 절대 피크로 요약 (0..1, 최대값 기준 정규화). 순수. */
export function computePeaks(channels: Float32Array[], bins = 600): Float32Array {
  const out = new Float32Array(bins)
  const len = channels[0]?.length ?? 0; if (!len) return out
  const per = len / bins
  for (let b = 0; b < bins; b++) {
    const s0 = Math.floor(b * per), s1 = Math.min(len, Math.floor((b + 1) * per)) || s0 + 1
    let m = 0
    for (const ch of channels) for (let i = s0; i < s1; i++) { const v = Math.abs(ch[i]!); if (v > m) m = v }
    out[b] = m
  }
  let max = 0; for (let b = 0; b < bins; b++) if (out[b]! > max) max = out[b]!
  if (max > 0) for (let b = 0; b < bins; b++) out[b] = out[b]! / max
  return out
}
