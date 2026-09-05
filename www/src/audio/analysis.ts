/**
 * 워커 프레임 → tunerStore. 메인 스레드는 결과만 받아 상태에 쓴다 (분석은 analysis.worker.ts / core).
 * 메트로놈 클릭 구간은 워커가 오디오 시계 기준으로 버린다(engine.muteAnalysis) — v1 의 벽시계 isClick 추정을 대체.
 */
import { tunerStore } from '../state/index.ts'
import { A, onWorkerMessage, sendToWorker } from './engine.ts'
import type { WorkerOut } from './messages.ts'

let lastMs = 0
/** 최근 프레임의 워커 처리 시간(ms) — 성능 표시/디버그용 */
export const lastFrameMs = (): number => lastMs

function onFrame(m: WorkerOut): void {
  if (m.type !== 'frame') return
  const st = tunerStore.get(); if (!st.running) return
  lastMs = m.ms
  const f = m.frame
  if (f.hz === -1) tunerStore.set({ frame: st.frame + 1, hz: -1, midi: -1, cents: 0, inTune: false, conf: 0, playing: f.playing })
  else tunerStore.set({ frame: st.frame + 1, hz: f.hz, midi: f.midi, cents: f.cents, inTune: f.inTune, conf: f.conf, playing: f.playing, lastActivityMs: Date.now() })
}

export function startAnalysis(): void { onWorkerMessage(onFrame) }
export function stopAnalysis(): void { /* 워커는 engine.closeMic 이 종료한다 */ }
/** 감지 상태 즉시 리셋 (설정 변경 등) */
export function resetPlayingDetection(): void { sendToWorker({ type: 'reset', afterT: A.ac?.currentTime ?? 0 }); tunerStore.set({ playing: false }) }
