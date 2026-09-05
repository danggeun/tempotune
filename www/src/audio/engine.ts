/**
 * 오디오 엔진 — 마이크 스트림, AudioContext, 캡처 워클릿 + 분석 워커의 생명주기.
 * 파이프라인(설계서 §B1): 마이크 → AudioWorklet(capture) → MessagePort → Worker(analysis) → tunerStore
 * 메인 스레드는 오디오 샘플을 만지지 않는다. ScriptProcessorNode / AnalyserNode / YAMNet 은 제거됐다.
 *
 * 구조 메모(Phase 2): 마이크용 micAC 와 메트로놈 전용 metroAC 두 컨텍스트는 아직 v1 그대로 — Phase 3 에서 단일화(§B7).
 */
import { tunerStore, settingsStore } from '../state/index.ts'
import type { WorkerIn, WorkerOut } from './messages.ts'
import type { AnalyzerSettings } from '../core/pitch/analyzer.ts'
import workletUrl from './capture.worklet.ts?worker&url'

export interface EngineNodes {
  micStream: MediaStream | null
  micAC: AudioContext | null
  /** 마이크 없이 메트로놈만 쓸 때의 전용 컨텍스트 */
  metroAC: AudioContext | null
  captureNode: AudioWorkletNode | null
  worker: Worker | null
  sampleRate: number
  /** 메트로놈 클릭이 울리는 순간 — 튜너 프레임을 버린다 */
  isClick: boolean
}
export const A: EngineNodes = { micStream: null, micAC: null, metroAC: null, captureNode: null, worker: null, sampleRate: 44100, isClick: false }

type Hook = () => void
const hooks = { afterOpen: [] as Hook[], beforeClose: [] as Hook[], afterClose: [] as Hook[] }
/** 다른 모듈(메트로놈/녹음/기준음/UI)이 마이크 생명주기에 끼어드는 지점 */
export function onMic(event: keyof typeof hooks, fn: Hook): void { hooks[event].push(fn) }

/** 워커가 보내는 프레임의 수신자 (analysis.ts) */
let frameHandler: ((m: WorkerOut) => void) | null = null
export function onWorkerMessage(fn: (m: WorkerOut) => void): void { frameHandler = fn }

const AC = (): typeof AudioContext => (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
export function getAC(): AudioContext | null { return A.micAC || A.metroAC }

/** 설정 → 분석기 설정 (평활 계수는 43 Hz 프레임 기준) */
export function analyzerSettings(): AnalyzerSettings {
  const s = settingsStore.get()
  return { rmsMin: s.rmsMin, smoothing: s.smoothing, refHz: s.refHz, tolCents: s.tolCents }
}
export function sendToWorker(m: WorkerIn, transfer?: Transferable[]): void { A.worker?.postMessage(m, transfer ?? []) }

let opening = false
export type MicResult = { ok: true } | { ok: false; error: string }

export async function openMic(): Promise<MicResult> {
  if (opening) return { ok: false, error: 'busy' }
  opening = true
  try {
    // 샘플레이트를 강제하지 않는다 — 기기 기본값(44.1/48 kHz)을 쓰고 분석기가 sr 을 받는다 (§B1)
    A.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
    A.micAC = new (AC())({ latencyHint: 'interactive' }); A.sampleRate = A.micAC.sampleRate
    await A.micAC.audioWorklet.addModule(workletUrl)
    if (A.micAC.state === 'suspended') await A.micAC.resume()
    A.captureNode = new AudioWorkletNode(A.micAC, 'gp-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 })
    A.worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    A.worker.onmessage = (e: MessageEvent<WorkerOut>) => frameHandler?.(e.data)
    const ch = new MessageChannel()
    A.worker.postMessage({ type: 'init', sampleRate: A.sampleRate, port: ch.port1, settings: analyzerSettings() } satisfies WorkerIn, [ch.port1])
    A.captureNode.port.postMessage({ type: 'port', port: ch.port2 }, [ch.port2])
    A.micAC.createMediaStreamSource(A.micStream).connect(A.captureNode)
    tunerStore.set({ micReady: true, running: true })
    opening = false
    for (const h of hooks.afterOpen) h()
    return { ok: true }
  } catch (e) {
    opening = false
    teardown()
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function teardown(): void {
  A.micStream?.getTracks().forEach(t => t.stop())
  A.captureNode?.disconnect(); A.worker?.terminate(); A.micAC?.close()
  A.micStream = null; A.micAC = null; A.captureNode = null; A.worker = null
}
export function closeMic(): void {
  tunerStore.set({ running: false, micReady: false, playing: false })
  for (const h of hooks.beforeClose) h()
  teardown()
  for (const h of hooks.afterClose) h()
}

/** 메트로놈 전용 컨텍스트 확보 (마이크가 없을 때). 실패 시 null */
export function ensureMetroAC(): AudioContext | null {
  if (A.micAC) return A.micAC
  try {
    if (!A.metroAC || A.metroAC.state === 'closed') A.metroAC = new (AC())()
    if (A.metroAC.state === 'suspended') A.metroAC.resume()
    return A.metroAC
  } catch { return null }
}
export function closeMetroAC(): void { if (A.metroAC && !A.micAC) { A.metroAC.close(); A.metroAC = null } }

/** 화면 복귀 시 컨텍스트 재개 + 오래된 링버퍼 폐기 (v1 visibilitychange) */
export function resumeIfRunning(): void { if (tunerStore.get().running) { A.micAC?.resume(); sendToWorker({ type: 'reset' }) } }

// 설정이 바뀌면 워커에 전달
settingsStore.subscribe(() => { if (A.worker) sendToWorker({ type: 'settings', settings: analyzerSettings() }) })
