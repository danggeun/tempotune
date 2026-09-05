// v2 어댑터 — core/pitch/analyzer.ts (워커와 같은 코드) 를 벤치마크에 연결
import { createAnalyzer } from '../../www/src/core/pitch/analyzer.ts'

function make(sr, opts = {}) {
  const a = createAnalyzer({ sampleRate: sr, ...opts })
  a.setSettings({ rmsMin: .014, smoothing: .14, refHz: 440, tolCents: 15 })
  return {
    name: 'v2', windowSize: 4096,
    process(buf) { const t0 = performance.now(); const f = a.process(buf); return { hz: f.hz, conf: f.conf, playing: f.playing, ms: performance.now() - t0 } },
  }
}
export const adapters = {
  v2: sr => make(sr),
}
