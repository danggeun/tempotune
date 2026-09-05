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
}
export const A: EngineNodes = { micStream: null, micAC: null, metroAC: null, captureNode: null, worker: null, sampleRate: 44100 }

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

/** 워커가 'ready' 를 보낼 때까지 기다린다. 스크립트 404/미지원은 동기 예외가 아니라 error 이벤트로 오므로 여기서 잡는다. */
function waitWorkerReady(w: Worker, timeoutMs: number): Promise<void> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('분석 워커가 응답하지 않습니다')), timeoutMs)
    const onMsg = (e: MessageEvent<WorkerOut>) => { if (e.data?.type === 'ready') { clearTimeout(t); w.removeEventListener('message', onMsg); res() } }
    w.addEventListener('message', onMsg)
    w.onerror = ev => { clearTimeout(t); rej(new Error('분석 워커 로드 실패: ' + (ev.message || ''))) }
  })
}

export async function openMic(): Promise<MicResult> {
  if (opening) return { ok: false, error: 'busy' }
  if (A.micAC) return { ok: true } // 이미 열려 있음 — 중복 스트림/워커 생성 방지
  if (typeof AudioWorkletNode === 'undefined' || typeof Worker === 'undefined') return { ok: false, error: '이 브라우저는 실시간 분석(AudioWorklet)을 지원하지 않습니다' }
  opening = true
  try {
    // 샘플레이트를 강제하지 않는다 — 기기 기본값(44.1/48 kHz)을 쓰고 분석기가 sr 을 받는다 (§B1)
    A.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
    const ac = new (AC())({ latencyHint: 'interactive' }); A.micAC = ac; A.sampleRate = ac.sampleRate
    await ac.audioWorklet.addModule(workletUrl)
    // resume() 은 자동재생 정책에 걸리면 제스처까지 pending 이라 await 하지 않는다 — suspended 면 main 의 "탭하여 시작" 경로가 처리
    if (ac.state === 'suspended') void ac.resume().catch(() => {})
    A.captureNode = new AudioWorkletNode(ac, 'gp-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 })
    const w = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    A.worker = w
    const ch = new MessageChannel()
    w.postMessage({ type: 'init', sampleRate: A.sampleRate, port: ch.port1, settings: analyzerSettings() } satisfies WorkerIn, [ch.port1])
    await waitWorkerReady(w, 3000)
    // 세션마다 워커를 캡처 — 종료 직전 큐에 남은 이전 세션 프레임이 새 세션에 섞이지 않게
    w.onmessage = (e: MessageEvent<WorkerOut>) => { if (A.worker === w) frameHandler?.(e.data) }
    w.onerror = () => { if (A.worker === w) { closeMic(); onFatal?.('분석 워커 오류로 마이크를 껐습니다') } }
    A.captureNode.port.postMessage({ type: 'port', port: ch.port2 }, [ch.port2])
    ac.createMediaStreamSource(A.micStream).connect(A.captureNode)
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
let onFatal: ((msg: string) => void) | null = null
/** 실행 중 치명 오류(워커 크래시 등) 알림 수신자 — UI 가 토스트 */
export function onEngineFatal(fn: (msg: string) => void): void { onFatal = fn }

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

/** 화면 복귀 시 컨텍스트 재개 + 백그라운드 동안 쌓인 청크 폐기 (v1 visibilitychange) */
export function resumeIfRunning(): void {
  if (!tunerStore.get().running || !A.micAC) return
  void A.micAC.resume().catch(() => {})
  sendToWorker({ type: 'reset', afterT: A.micAC.currentTime })
}
/** 메트로놈 클릭 구간을 워커에 알려 그 창의 프레임을 버리게 한다 (마이크와 클릭이 같은 컨텍스트 시계를 쓴다) */
export function muteAnalysis(fromT: number, untilT: number): void { if (A.worker) sendToWorker({ type: 'mute', from: fromT, until: untilT }) }

// 설정이 바뀌면 워커에 전달
settingsStore.subscribe(() => { if (A.worker) sendToWorker({ type: 'settings', settings: analyzerSettings() }) })
