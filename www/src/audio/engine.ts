/**
 * 오디오 엔진 — 마이크 스트림, AudioContext, 분석 노드의 생명주기.
 * v1의 A(micStream/micAC/metroAC/analyser·scriptProc/pcm16k) + openMic/closeMic 를 옮겼다.
 *
 * 구조 메모(Phase 1): v1과 동일하게 마이크용 micAC 와 메트로놈 전용 metroAC 두 컨텍스트를 쓴다.
 * Phase 3에서 단일 컨텍스트로 통합 예정(설계서 §B7). ScriptProcessorNode 도 Phase 2에서 워클릿으로 교체.
 */
import { CFG, tunerStore } from '../state/index.ts'

export interface EngineNodes {
  micStream: MediaStream | null
  micAC: AudioContext | null
  /** 마이크 없이 메트로놈만 쓸 때의 전용 컨텍스트 */
  metroAC: AudioContext | null
  analyserFFT: AnalyserNode | null
  analyserTD: AnalyserNode | null
  fftBuf: Float32Array<ArrayBuffer> | null
  tdBuf: Float32Array<ArrayBuffer> | null
  binCount: number
  sampleRate: number
  scriptProc: ScriptProcessorNode | null
  /** YAMNet 입력용 16 kHz 링버퍼 */
  pcm16k: Float32Array<ArrayBuffer>
  pcmPos: number
  /** 메트로놈 클릭이 울리는 순간 — 튜너 분석을 잠시 멈춘다 */
  isClick: boolean
}

export const A: EngineNodes = {
  micStream: null, micAC: null, metroAC: null, analyserFFT: null, analyserTD: null, fftBuf: null, tdBuf: null,
  binCount: 0, sampleRate: 44100, scriptProc: null, pcm16k: new Float32Array(31200), pcmPos: 0, isClick: false,
}

type Hook = () => void
const hooks = { afterOpen: [] as Hook[], beforeClose: [] as Hook[], afterClose: [] as Hook[] }
/** 다른 모듈(메트로놈/녹음/기준음/UI)이 마이크 생명주기에 끼어드는 지점 */
export function onMic(event: keyof typeof hooks, fn: Hook): void { hooks[event].push(fn) }

const AC = (): typeof AudioContext => (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)

/** 현재 오디오 출력에 쓸 컨텍스트 (마이크 우선, 없으면 메트로놈 전용) */
export function getAC(): AudioContext | null { return A.micAC || A.metroAC }

let opening = false
export type MicResult = { ok: true } | { ok: false; error: string }

export async function openMic(): Promise<MicResult> {
  if (opening) return { ok: false, error: 'busy' }
  opening = true
  try {
    A.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: 44100 } })
    A.micAC = new (AC())(); A.sampleRate = A.micAC.sampleRate
    A.analyserFFT = A.micAC.createAnalyser(); A.analyserFFT.fftSize = CFG.detect.fftSize; A.analyserFFT.smoothingTimeConstant = CFG.detect.fftSmooth
    A.binCount = A.analyserFFT.frequencyBinCount; A.fftBuf = new Float32Array(A.binCount)
    A.analyserTD = A.micAC.createAnalyser(); A.analyserTD.fftSize = CFG.tuner.fftSize; A.analyserTD.smoothingTimeConstant = 0; A.tdBuf = new Float32Array(CFG.tuner.fftSize)
    A.scriptProc = A.micAC.createScriptProcessor(4096, 1, 1)
    const ratio = A.sampleRate / 16000
    A.scriptProc.onaudioprocess = e => {
      const inp = e.inputBuffer.getChannelData(0)
      for (let i = 0; i < inp.length; i += ratio) { A.pcm16k[A.pcmPos % A.pcm16k.length] = inp[Math.floor(i)]!; A.pcmPos++ }
    }
    if (A.micAC.state === 'suspended') await A.micAC.resume()
    const src = A.micAC.createMediaStreamSource(A.micStream)
    src.connect(A.analyserFFT); src.connect(A.analyserTD); src.connect(A.scriptProc); A.scriptProc.connect(A.micAC.destination)
    tunerStore.set({ micReady: true, running: true })
    opening = false
    for (const h of hooks.afterOpen) h()
    return { ok: true }
  } catch (e) {
    opening = false
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function closeMic(): void {
  tunerStore.set({ running: false, micReady: false, playing: false })
  for (const h of hooks.beforeClose) h()
  A.micStream?.getTracks().forEach(t => t.stop()); A.scriptProc?.disconnect(); A.micAC?.close()
  A.micStream = null; A.micAC = null; A.analyserFFT = null; A.analyserTD = null; A.scriptProc = null; A.pcmPos = 0
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

/** 화면 복귀 시 컨텍스트 재개 (v1 visibilitychange) */
export function resumeIfRunning(): void { if (tunerStore.get().running) A.micAC?.resume() }
