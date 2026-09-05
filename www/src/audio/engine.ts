/**
 * 오디오 엔진 — 단일 AudioContext 와 마이크 캡처 파이프라인의 생명주기 (설계서 §B1, §B7).
 *
 * 컨텍스트는 하나다. 처음 필요할 때(메트로놈 시작·기준음·마이크) 만들고 앱이 살아 있는 동안 유지한다.
 * 마이크를 끄면 소스/워클릿/워커만 정리하고 컨텍스트는 남긴다 → 메트로놈·기준음은 영향 없음.
 * 마이크 파이프라인: 마이크 → AudioWorklet(capture) → MessagePort → Worker(analysis) → tunerStore
 */
import { tunerStore, settingsStore } from '../state/index.ts'
import type { WorkerIn, WorkerOut } from './messages.ts'
import type { AnalyzerSettings } from '../core/pitch/analyzer.ts'
import captureWorkletUrl from './capture.worklet.ts?worker&url'

export interface EngineNodes {
  ac: AudioContext | null
  /** 이 컨텍스트에 캡처 워클릿 모듈이 로드됐는가 */
  captureLoaded: boolean
  micStream: MediaStream | null
  micSource: MediaStreamAudioSourceNode | null
  captureNode: AudioWorkletNode | null
  worker: Worker | null
  sampleRate: number
}
export const A: EngineNodes = { ac: null, captureLoaded: false, micStream: null, micSource: null, captureNode: null, worker: null, sampleRate: 44100 }

type Hook = () => void
const hooks = { afterOpen: [] as Hook[], beforeClose: [] as Hook[], afterClose: [] as Hook[] }
/** 다른 모듈(녹음/기준음/UI)이 마이크 생명주기에 끼어드는 지점 */
export function onMic(event: keyof typeof hooks, fn: Hook): void { hooks[event].push(fn) }

let frameHandler: ((m: WorkerOut) => void) | null = null
export function onWorkerMessage(fn: (m: WorkerOut) => void): void { frameHandler = fn }
let onFatal: ((msg: string) => void) | null = null
export function onEngineFatal(fn: (msg: string) => void): void { onFatal = fn }

const ACCtor = (): typeof AudioContext => (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
export const audioSupported = (): boolean => typeof AudioWorkletNode !== 'undefined' && typeof Worker !== 'undefined' && !!ACCtor()

/** 단일 컨텍스트. 없으면 만든다. 사용자 제스처 안에서 부르면 바로 running, 밖이면 suspended 일 수 있다. */
export function getContext(): AudioContext {
  if (!A.ac || A.ac.state === 'closed') { A.ac = new (ACCtor())({ latencyHint: 'interactive' }); A.captureLoaded = false; A.sampleRate = A.ac.sampleRate }
  if (A.ac.state === 'suspended') void A.ac.resume().catch(() => {})
  return A.ac
}
export const micOpen = (): boolean => !!A.micStream

/** 설정 → 분석기 설정 (평활 계수는 43 Hz 프레임 기준) */
export function analyzerSettings(): AnalyzerSettings {
  const s = settingsStore.get()
  return { rmsMin: s.rmsMin, smoothing: s.smoothing, refHz: s.refHz, tolCents: s.tolCents }
}
export function sendToWorker(m: WorkerIn, transfer?: Transferable[]): void { A.worker?.postMessage(m, transfer ?? []) }

function waitWorkerReady(w: Worker, timeoutMs: number): Promise<void> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('분석 워커가 응답하지 않습니다')), timeoutMs)
    const onMsg = (e: MessageEvent<WorkerOut>) => { if (e.data?.type === 'ready') { clearTimeout(t); w.removeEventListener('message', onMsg); res() } }
    w.addEventListener('message', onMsg)
    w.onerror = ev => { clearTimeout(t); rej(new Error('분석 워커 로드 실패: ' + (ev.message || ''))) }
  })
}

let opening = false
export type MicResult = { ok: true } | { ok: false; error: string }

export async function openMic(): Promise<MicResult> {
  if (opening) return { ok: false, error: 'busy' }
  if (A.micStream) return { ok: true }
  if (!audioSupported()) return { ok: false, error: '이 브라우저는 실시간 분석(AudioWorklet)을 지원하지 않습니다' }
  opening = true
  try {
    // 샘플레이트를 강제하지 않는다 — 기기 기본값(44.1/48 kHz)을 쓰고 분석기가 sr 을 받는다 (§B1)
    A.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
    const ac = getContext()
    if (!A.captureLoaded) { await ac.audioWorklet.addModule(captureWorkletUrl); A.captureLoaded = true }
    A.captureNode = new AudioWorkletNode(ac, 'gp-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 })
    const w = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    A.worker = w
    const ch = new MessageChannel()
    w.postMessage({ type: 'init', sampleRate: ac.sampleRate, port: ch.port1, settings: analyzerSettings() } satisfies WorkerIn, [ch.port1])
    await waitWorkerReady(w, 3000)
    // 세션마다 워커를 캡처 — 종료 직전 큐에 남은 이전 세션 프레임이 새 세션에 섞이지 않게
    w.onmessage = (e: MessageEvent<WorkerOut>) => { if (A.worker === w) frameHandler?.(e.data) }
    w.onerror = () => { if (A.worker === w) { closeMic(); onFatal?.('분석 워커 오류로 마이크를 껐습니다') } }
    A.captureNode.port.postMessage({ type: 'port', port: ch.port2 }, [ch.port2])
    A.micSource = ac.createMediaStreamSource(A.micStream); A.micSource.connect(A.captureNode)
    // 장치가 빠지거나 다른 앱이 마이크를 가져가면 (track ended) 정리
    A.micStream.getAudioTracks()[0]?.addEventListener('ended', () => { if (A.micStream) { closeMic(); onFatal?.('마이크 연결이 끊겼습니다') } })
    tunerStore.set({ micReady: true, running: true })
    opening = false
    for (const h of hooks.afterOpen) h()
    return { ok: true }
  } catch (e) {
    opening = false
    teardownMic()
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function teardownMic(): void {
  A.micStream?.getTracks().forEach(t => t.stop())
  A.micSource?.disconnect(); A.captureNode?.disconnect(); A.worker?.terminate()
  A.micStream = null; A.micSource = null; A.captureNode = null; A.worker = null
}
export function closeMic(): void {
  tunerStore.set({ running: false, micReady: false, playing: false })
  for (const h of hooks.beforeClose) h()
  teardownMic()
  for (const h of hooks.afterClose) h()
}

/** 화면 복귀 시 컨텍스트 재개 + 백그라운드 동안 쌓인 청크 폐기 */
export function resumeIfRunning(): void {
  if (!A.ac) return
  void A.ac.resume().catch(() => {})
  if (tunerStore.get().running) sendToWorker({ type: 'reset', afterT: A.ac.currentTime })
}
/** 메트로놈 클릭 구간을 워커에 알려 그 창의 프레임을 버리게 한다 (같은 컨텍스트 시계) */
export function muteAnalysis(fromT: number, untilT: number): void { if (A.worker) sendToWorker({ type: 'mute', from: fromT, until: untilT }) }

settingsStore.subscribe(() => { if (A.worker) sendToWorker({ type: 'settings', settings: analyzerSettings() }) })
