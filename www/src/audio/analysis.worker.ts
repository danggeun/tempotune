/**
 * 분석 워커 — 워클릿에서 청크를 받아 링버퍼에 쌓고, 청크마다(hop 1024) 최신 창(4096)을 분석기에 넣어 프레임을 메인에 보낸다.
 * 알고리즘은 전부 core/ (벤치마크와 동일 코드).
 *
 * 런타임 보호(리뷰 반영):
 *  - reset.afterT 이전 청크는 버린다 — 백그라운드에서 워클릿이 계속 쌓아둔 청크가 복귀 시 폭주하지 않게
 *  - 백프레셔: 청크 도착 지연(벽시계 − 오디오 시계)이 기준선보다 100 ms 이상 커지면 분석을 건너뛰고 링만 채운다
 *  - mute 구간(메트로놈 클릭)에 걸치는 창은 분석하지 않는다
 *  - 다 쓴 청크 버퍼는 워클릿에 반납한다
 */
import { createAnalyzer, type Analyzer } from '../core/pitch/analyzer.ts'
import type { WorkerIn, WorkerOut, ChunkMsg, RecycleMsg } from './messages.ts'

const WINDOW = 4096
let analyzer: Analyzer | null = null
let sr = 44100
const ring = new Float32Array(WINDOW * 4)
let ringPos = 0, filled = 0
const win = new Float32Array(WINDOW)
let dropBefore = -1
let port: MessagePort | null = null
const mutes: Array<{ from: number; until: number }> = []
let minOffset = Infinity // 벽시계 − 오디오시계 의 최소값(기준선). 지연이 커지면 이보다 커진다
let skipped = 0

const post = (m: WorkerOut, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? [])

function onChunk(e: MessageEvent<ChunkMsg>): void {
  const m = e.data; if (!m || m.type !== 'chunk' || !analyzer) return
  const c = m.chunk
  const recycle = () => { const buf = c.buffer as ArrayBuffer; port?.postMessage({ type: 'recycle', buf } satisfies RecycleMsg, [buf]) }
  if (m.t < dropBefore) { recycle(); return }
  for (let i = 0; i < c.length; i++) { ring[ringPos] = c[i]!; ringPos = (ringPos + 1) % ring.length }
  filled = Math.min(ring.length, filled + c.length)
  recycle()
  if (filled < WINDOW) return
  // 백프레셔
  const offset = performance.now() - m.t * 1000
  if (offset < minOffset) minOffset = offset
  else minOffset += 0.5 // 기준선은 천천히 따라 올라간다 (시계 드리프트)
  if (offset - minOffset > 100) { skipped++; return }
  // 뮤트 구간: 창 [t − WINDOW/sr, t] 가 클릭 구간과 겹치면 '클릭 섞임' 으로 표시 (버리지 않는다 — 버리면 120 bpm 세분에서 튜너가 얼어붙는다, 리뷰)
  const t0 = m.t - WINDOW / sr
  let muted = false
  for (let i = mutes.length - 1; i >= 0; i--) { const r = mutes[i]!; if (r.until < t0 - 1) mutes.splice(i, 1); else if (t0 < r.until && m.t > r.from) muted = true }
  // 최신 WINDOW 샘플을 선형 버퍼로
  let src = (ringPos - WINDOW + ring.length) % ring.length
  for (let i = 0; i < WINDOW; i++) { win[i] = ring[src]!; src = (src + 1) % ring.length }
  const t0w = performance.now()
  const frame = analyzer.process(win, muted)
  post({ type: 'frame', frame, t: m.t, ms: performance.now() - t0w, skipped })
  skipped = 0
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data
  switch (m.type) {
    case 'init':
      sr = m.sampleRate
      analyzer = createAnalyzer({ sampleRate: sr, windowSize: WINDOW, hzMin: 40, hzMax: 4200 })
      analyzer.setSettings(m.settings)
      ringPos = 0; filled = 0; dropBefore = -1; minOffset = Infinity; mutes.length = 0
      port = m.port; port.onmessage = onChunk
      post({ type: 'ready' })
      break
    case 'settings': analyzer?.setSettings(m.settings); break
    case 'reset': analyzer?.reset(); filled = 0; dropBefore = m.afterT; minOffset = Infinity; break
    case 'mute': mutes.push({ from: m.from, until: m.until }); if (mutes.length > 64) mutes.shift(); break
  }
}
