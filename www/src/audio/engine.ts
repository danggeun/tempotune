/**
 * 오디오 엔진 — 단일 AudioContext(앱 수명 동안 유지)와 마이크 캡처 파이프라인의 생명주기.
 * 마이크 파이프라인: 마이크 → AudioWorklet(capture) → MessagePort → Worker(analysis) → tunerStore
 */
import { tunerStore, settingsStore } from '../state/index.ts'
import { isNative } from '../platform/index.ts'
import { t as tr } from '../core/i18n/index.ts'
import type { WorkerIn, WorkerOut } from './messages.ts'
import type { AnalyzerSettings } from '../core/pitch/analyzer.ts'
import { softClipCurve } from '../core/softclip.ts'
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

const stateListeners: Array<(s: AudioContextState | 'interrupted') => void> = []
/** 컨텍스트 상태 변화 구독 (running / suspended / interrupted / closed) */
export function onContextState(fn: (s: AudioContextState | 'interrupted') => void): void { stateListeners.push(fn) }
let frameHandler: ((m: WorkerOut) => void) | null = null
export function onWorkerMessage(fn: (m: WorkerOut) => void): void { frameHandler = fn }
let onFatal: ((msg: string) => void) | null = null
export function onEngineFatal(fn: (msg: string) => void): void { onFatal = fn }

const ACCtor = (): typeof AudioContext => (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)

/** iOS 오디오 세션 힌트 (W3C Audio Session · iOS 17 Safari+, 다른 플랫폼은 no-op). 'play-and-record' 상태면 iOS 가 출력을 감쇠하거나 수화기로 돌린다 */
type AudioSessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record'
function setAudioSession(type: AudioSessionType): void {
  const n = navigator as Navigator & { audioSession?: { type: AudioSessionType } }
  try { if (n.audioSession) n.audioSession.type = type } catch { /* 지원하지 않거나 거부 — 무해 */ }
}
export const audioSessionHint = (mic: boolean): void => setAudioSession(mic ? 'play-and-record' : 'playback')
export const audioSupported = (): boolean => typeof AudioWorkletNode !== 'undefined' && typeof Worker !== 'undefined' && !!ACCtor()

/** 단일 컨텍스트. 없으면 만든다. 사용자 제스처 안에서 부르면 바로 running, 밖이면 suspended 일 수 있다. */
export function getContext(): AudioContext {
  if (!A.ac || A.ac.state === 'closed') {
    audioSessionHint(!!A.micStream) // 컨텍스트를 만들기 전에 세션 의도를 선언한다
    A.ac = new (ACCtor())({ latencyHint: 'interactive' }); A.captureLoaded = false; A.sampleRate = A.ac.sampleRate
    // 전화·오디오 포커스 상실로 컨텍스트가 멈추면(iOS 'interrupted', Android 'suspended') 알린다
    A.ac.onstatechange = () => { for (const f of stateListeners) f(A.ac!.state as AudioContextState | 'interrupted') }
  }
  if (A.ac.state !== 'running') void A.ac.resume().catch(() => {}) // 'suspended' 뿐 아니라 iOS 'interrupted' 도
  return A.ac
}
/**
 * 앱이 내는 모든 소리(메트로놈·A 듣기·드론)가 모이는 출력. 소프트 리미터 하나를 함께 지나므로
 * 드론 위에 클릭이 겹쳐 합이 1.0 을 넘어도 찢어지지 않는다. 무릎(0.7) 아래는 항등 — 따로 울릴 때 소리는 그대로
 */
let outNode: WaveShaperNode | null = null, outCtx: AudioContext | null = null
export function output(): AudioNode {
  const ac = getContext()
  if (!outNode || outCtx !== ac) {
    outNode = ac.createWaveShaper(); outNode.curve = softClipCurve(); outNode.oversample = '2x'; outNode.connect(ac.destination); outCtx = ac
  }
  return outNode
}
/** 출력 지연 — Android 는 outputLatency(40–100 ms) ≫ baseLatency */
export const outputLatency = (ac: AudioContext): number => (ac as AudioContext & { outputLatency?: number }).outputLatency || ac.baseLatency || 0

/** 드론 주파수를 분석 워커에 알린다 — 튜너가 그 주파수만 잘라내고 읽는다. 마이크를 나중에 열어도 전해지게 기억한다 */
let droneForAnalysis: number | null = null
export function setAnalysisDrone(hz: number | null): void {
  droneForAnalysis = hz
  if (A.worker && A.ac) sendToWorker({ type: 'drone', hz, at: A.ac.currentTime + outputLatency(A.ac) })
}

/** 아무도 컨텍스트를 쓰지 않으면(마이크 off·메트로놈 정지·기준음·드론 없음) 일시정지 — Android 오디오 포커스 반환, 배터리 */
let idleCheck: (() => boolean) | null = null
export function setIdleCheck(fn: () => boolean): void { idleCheck = fn }
export function suspendIfIdle(): void { if (A.ac && A.ac.state === 'running' && !A.micStream && idleCheck?.()) void A.ac.suspend().catch(() => {}) }
export const micOpen = (): boolean => !!A.micStream

/** 설정 → 분석기 설정 (평활 계수는 43 Hz 프레임 기준) */
export function analyzerSettings(): AnalyzerSettings {
  const s = settingsStore.get()
  return { rmsMin: s.rmsMin, smoothing: s.smoothing, refHz: s.refHz, tolCents: s.tolCents }
}
export function sendToWorker(m: WorkerIn, transfer?: Transferable[]): void { A.worker?.postMessage(m, transfer ?? []) }

function waitWorkerReady(w: Worker, timeoutMs: number): Promise<void> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(tr('mic.errWorkerTimeout'))), timeoutMs)
    const onMsg = (e: MessageEvent<WorkerOut>) => { if (e.data?.type === 'ready') { clearTimeout(t); w.removeEventListener('message', onMsg); res() } }
    w.addEventListener('message', onMsg)
    w.onerror = ev => { clearTimeout(t); rej(new Error(tr('mic.errWorkerLoad', { e: ev.message || '' }))) }
  })
}

let opening = false
let micGen = 0 // 세션 토큰: openMic 도중 closeMic 이 끼어들면 늦게 깨어난 await 가 옛 세션을 이어가지 않게
export type MicResult = { ok: true } | { ok: false; error: string }

/** 지금 getUserMedia 를 기다리는 중인가 — 숨김·편집기가 끼어들면 cancelOpen() 으로 무효화한다 */
export const isOpening = (): boolean => opening
/** 진행 중인 openMic 을 무효화한다. 늦게 깨어난 gUM 은 gen 이 바뀐 걸 보고 트랙을 끄고 'busy' 로 끝난다 */
export function cancelOpen(): void { if (opening) micGen++ }
/** 진행 중인 열기가 끝날 때까지 (최대 maxMs). 'busy' 를 받은 쪽이 기다렸다가 한 번 더 연다 */
export function untilOpenSettled(maxMs = 6000): Promise<void> {
  return new Promise(res => { const t0 = Date.now(); const tick = (): void => { if (!opening || Date.now() - t0 > maxMs) res(); else setTimeout(tick, 50) }; tick() })
}
export async function openMic(): Promise<MicResult> {
  if (opening) return { ok: false, error: 'busy' }
  if (A.micStream) return { ok: true }
  if (!audioSupported()) return { ok: false, error: tr('mic.errNoWorklet') }
  opening = true
  const gen = ++micGen
  const stale = () => gen !== micGen || !A.micStream
  try {
    // iOS: getUserMedia 전에 'play-and-record' 선언. 'playback' 상태면 캡처가 거부된다
    audioSessionHint(true)
    // 샘플레이트를 강제하지 않는다 — 기기 기본값(44.1/48 kHz)을 분석기가 받는다
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
    if (gen !== micGen) { stream.getTracks().forEach(t => t.stop()); opening = false; return { ok: false, error: 'busy' } }
    A.micStream = stream
    const ac = getContext()
    if (!A.captureLoaded) { await ac.audioWorklet.addModule(captureWorkletUrl); A.captureLoaded = true }
    if (stale()) throw new Error('busy')
    A.captureNode = new AudioWorkletNode(ac, 'gp-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 })
    const w = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    A.worker = w
    const ch = new MessageChannel()
    w.postMessage({ type: 'init', sampleRate: ac.sampleRate, port: ch.port1, settings: analyzerSettings() } satisfies WorkerIn, [ch.port1])
    await waitWorkerReady(w, 8000)
    if (stale()) throw new Error('busy')
    // 세션마다 워커를 캡처 — 종료 직전 큐에 남은 이전 세션 프레임이 새 세션에 섞이지 않게
    w.onmessage = (e: MessageEvent<WorkerOut>) => { if (A.worker === w) frameHandler?.(e.data) }
    w.onerror = () => { if (A.worker === w) { closeMic(); onFatal?.(tr('mic.errWorkerCrash')) } }
    A.captureNode.port.postMessage({ type: 'port', port: ch.port2 }, [ch.port2])
    A.micSource = ac.createMediaStreamSource(stream); A.micSource.connect(A.captureNode)
    // 장치가 빠지거나 다른 앱이 마이크를 가져가면 (track ended) 정리 — 자기 스트림일 때만 (이전 세션의 늦은 ended 가 새 세션을 닫지 않게)
    stream.getAudioTracks()[0]?.addEventListener('ended', () => { if (A.micStream === stream) { closeMic(); onFatal?.(tr('mic.errEnded')) } })
    if (droneForAnalysis !== null) sendToWorker({ type: 'drone', hz: droneForAnalysis, at: ac.currentTime }) // 이미 울리는 드론 — 지금부터 잘라낸다
    tunerStore.set({ micReady: true, running: true, sampleRate: ac.sampleRate }) // 샘플레이트는 트레이스 창을 초 단위로 유지하는 데 쓰인다
    opening = false
    for (const h of hooks.afterOpen) h()
    return { ok: true }
  } catch (e) {
    opening = false
    if (e instanceof Error && e.message === 'busy') return { ok: false, error: 'busy' } // 도중에 닫힘 — closeMic 이 세션도 이미 되돌렸다
    teardownMic()
    audioSessionHint(false) // 실패 시 재생 전용으로 되돌린다 — 'play-and-record' 로 남기면 iOS 가 출력을 감쇠한다
    return { ok: false, error: micErrorMessage(e) }
  }
}
/** getUserMedia 오류를 사용자가 행동할 수 있는 문장으로 */
export function micErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : ''
  const msg = e instanceof Error ? e.message : String(e)
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return tr(isNative() ? 'mic.errDeniedNative' : 'mic.errDeniedWeb')
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return tr('mic.errNotFound')
  if (name === 'NotReadableError' || name === 'TrackStartError') return tr('mic.errBusy')
  if (name === 'SecurityError') return tr('mic.errInsecure')
  // iOS 세션 카테고리 충돌 — 보이면 openMic 의 세션 선언 순서가 깨진 것
  if (/audio session/i.test(msg)) return tr('mic.errSession')
  return msg || tr('mic.errUnknown')
}
export const isPermissionError = (msg: string): boolean => /권한|차단/.test(msg)

function teardownMic(): void {
  micGen++ // 진행 중인 openMic 세션 무효화
  A.micStream?.getTracks().forEach(t => t.stop())
  A.captureNode?.port.postMessage({ type: 'stop' }) // 프로세서 수거 (process → false)
  A.micSource?.disconnect(); A.captureNode?.disconnect(); A.worker?.terminate()
  A.micStream = null; A.micSource = null; A.captureNode = null; A.worker = null
}
export function closeMic(): void {
  tunerStore.set({ running: false, micReady: false, playing: false, hz: -1 }) // hz 도 비운다 — 닫기 직전 프레임의 그리기가 늦게 돌아도 옛 음을 다시 그리지 않게
  for (const h of hooks.beforeClose) h()
  teardownMic()
  audioSessionHint(false) // 마이크가 없으면 재생 전용 — iOS 가 출력을 감쇠하지 않게
  for (const h of hooks.afterClose) h()
  suspendIfIdle()
}

/** 화면 복귀 시 컨텍스트 재개 + 백그라운드 동안 쌓인 청크 폐기 */
export function resumeIfRunning(): void {
  if (!A.ac) return
  if (A.micStream || !(idleCheck?.() ?? true)) void A.ac.resume().catch(() => {})
  if (tunerStore.get().running) sendToWorker({ type: 'reset', afterT: A.ac.currentTime })
}
/** 메트로놈 클릭 구간을 워커에 알려 그 창의 프레임을 버리게 한다 (같은 컨텍스트 시계) */
export function muteAnalysis(fromT: number, untilT: number, at: number): void { if (A.worker) sendToWorker({ type: 'mute', from: fromT, until: untilT, at }) }

settingsStore.select(s => `${s.rmsMin}|${s.smoothing}|${s.refHz}|${s.tolCents}`, () => { if (A.worker) sendToWorker({ type: 'settings', settings: analyzerSettings() }) }) // 무관한 설정 변경마다 워커에 보내지 않는다
