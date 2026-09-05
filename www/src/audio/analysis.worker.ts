/**
 * 분석 워커 — 워클릿에서 청크를 받아 링버퍼에 쌓고, 청크마다(hop 1024) 최신 창(4096)을 분석기에 넣어 프레임을 메인에 보낸다.
 * 알고리즘은 전부 core/ (벤치마크와 동일 코드).
 */
import { createAnalyzer, type Analyzer } from '../core/pitch/analyzer.ts'
import type { WorkerIn, WorkerOut, ChunkMsg } from './messages.ts'

const WINDOW = 4096
let analyzer: Analyzer | null = null
const ring = new Float32Array(WINDOW * 4)
let ringPos = 0, filled = 0
const win = new Float32Array(WINDOW)
let muteUntil = -1

const post = (m: WorkerOut, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? [])

function onChunk(e: MessageEvent<ChunkMsg>): void {
  const m = e.data; if (!m || m.type !== 'chunk' || !analyzer) return
  const c = m.chunk
  for (let i = 0; i < c.length; i++) { ring[ringPos] = c[i]!; ringPos = (ringPos + 1) % ring.length }
  filled = Math.min(ring.length, filled + c.length)
  if (filled < WINDOW) return
  // 최신 WINDOW 샘플을 선형 버퍼로
  let src = (ringPos - WINDOW + ring.length) % ring.length
  for (let i = 0; i < WINDOW; i++) { win[i] = ring[src]!; src = (src + 1) % ring.length }
  if (m.t < muteUntil) return
  const t0 = performance.now()
  const frame = analyzer.process(win)
  post({ type: 'frame', frame, t: m.t, ms: performance.now() - t0 })
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data
  switch (m.type) {
    case 'init':
      analyzer = createAnalyzer({ sampleRate: m.sampleRate, windowSize: WINDOW, hzMin: 40, hzMax: 4200 })
      analyzer.setSettings(m.settings)
      ringPos = 0; filled = 0; muteUntil = -1
      m.port.onmessage = onChunk
      post({ type: 'ready' })
      break
    case 'settings': analyzer?.setSettings(m.settings); break
    case 'reset': analyzer?.reset(); filled = 0; break
    case 'muteUntil': muteUntil = Math.max(muteUntil, m.t); break
  }
}
