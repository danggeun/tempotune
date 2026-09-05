/**
 * 메트로놈 — AudioWorklet 안에서 샘플 단위로 클릭을 생성한다 (설계서 §B6).
 * 메인 스레드는 패턴을 보내고 클릭 이벤트를 받을 뿐이다: 화면이 꺼져도, 백그라운드여도 박자가 흔들리지 않는다.
 * BPM/볼륨 변경은 다음 틱부터 반영(재시작 없음). 박자·세분 변경은 마디를 처음부터 다시 센다.
 * UI(접힘, 버튼, 비트 표시)는 ui/metro.ts 가 metroStore 를 구독해 처리한다.
 */
import { metroStore, sessionStore, settingsStore, CFG, type SubDiv, type TimeSig } from '../state/index.ts'
import { totalTicks as _totalTicks } from '../core/metro/sequencer.ts'
import { getContext, micOpen, muteAnalysis, audioSupported } from './engine.ts'
import metroWorkletUrl from './metro.worklet.ts?worker&url'

let node: AudioWorkletNode | null = null
let nodeCtx: AudioContext | null = null
let loading: Promise<AudioWorkletNode> | null = null
let tickN = 0

export function totalTicks(): number { return _totalTicks(settingsStore.get()) }

function pattern() { const s = settingsStore.get(); return { bpm: s.bpm, timeSig: s.timeSig, subDiv: s.subDiv, volume: s.metroVol, muted: sessionStore.get().recording } }

async function ensureNode(): Promise<AudioWorkletNode> {
  const ac = getContext()
  if (node && nodeCtx === ac) return node
  if (loading) return loading
  loading = (async () => {
    await ac.audioWorklet.addModule(metroWorkletUrl)
    const n = new AudioWorkletNode(ac, 'gp-metro', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
    n.port.onmessage = (e: MessageEvent) => {
      const m = e.data; if (m?.type !== 'click' || !metroStore.get().playing) return
      // 시각 피드백은 실제 재생 시각에 맞춘다 (메시지는 렌더 시점에 먼저 온다)
      const delay = Math.max(0, (m.t - ac.currentTime) * 1000 + ac.baseLatency * 1000)
      setTimeout(() => { if (metroStore.get().playing) metroStore.set({ lastTick: { tick: m.tick, n: ++tickN } }) }, delay)
      // 클릭이 스피커→마이크로 누설되는 구간을 튜너 분석에서 제외: 클릭 −20 ms ~ 클릭 + 길이 + 분석 창 + 여유
      if (micOpen()) muteAnalysis(m.t - 0.02, m.t + m.dur + 4096 / ac.sampleRate + 0.08)
    }
    n.connect(ac.destination)
    n.port.postMessage({ type: 'pattern', pattern: pattern() })
    node = n; nodeCtx = ac; loading = null
    return n
  })()
  return loading
}

export type StartResult = { ok: true } | { ok: false; error: string }
export function startMetro(): StartResult {
  if (!audioSupported()) return { ok: false, error: '오디오를 시작할 수 없습니다' }
  metroStore.set({ playing: true })
  ensureNode().then(n => { if (metroStore.get().playing) { n.port.postMessage({ type: 'pattern', pattern: pattern() }); n.port.postMessage({ type: 'start' }) } })
    .catch(() => { metroStore.set({ playing: false }); toastFn?.('오디오를 시작할 수 없습니다') })
  return { ok: true }
}
export function stopMetro(): void { metroStore.set({ playing: false }); node?.port.postMessage({ type: 'stop' }) }
export function toggleMetro(): StartResult { return metroStore.get().playing ? (stopMetro(), { ok: true }) : startMetro() }
let toastFn: ((m: string) => void) | null = null
export function onMetroError(fn: (m: string) => void): void { toastFn = fn }

function pushPattern(): void { node?.port.postMessage({ type: 'pattern', pattern: pattern() }) }
function restartBar(): void { if (metroStore.get().playing && node) { node.port.postMessage({ type: 'pattern', pattern: pattern() }); node.port.postMessage({ type: 'start' }) } }

export function setBPM(v: number): void { settingsStore.set({ bpm: Math.max(CFG.metro.bpmMin, Math.min(CFG.metro.bpmMax, v)) }) } // 다음 틱부터 반영
export function adjBPM(d: number): void { setBPM(settingsStore.get().bpm + d) }
export function setTimeSig(v: TimeSig): void { const patch: { timeSig: TimeSig; subDiv?: SubDiv } = { timeSig: v }; if (v === 6) patch.subDiv = 1; settingsStore.set(patch); restartBar() }
export function setSubDiv(v: SubDiv): void { settingsStore.set({ subDiv: v }); restartBar() }
export function setMetroVol(v: number): void { settingsStore.set({ metroVol: v }) }

settingsStore.select(s => [s.bpm, s.metroVol].join(), pushPattern)
sessionStore.select(s => s.recording, pushPattern) // 녹음 중 클릭 무음 (시각 피드백은 유지)
