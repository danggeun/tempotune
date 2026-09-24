/**
 * 녹음 재생 경로 — <audio> → MediaElementSource → Gain(보정) → WaveShaper(소프트 리미터) → destination.
 * autoGainControl:false 로 녹음돼 작은 파일을 녹음 시 피크(item.peak)로 보정한다. 게인이 필요할 때만 그래프를 만든다.
 */
import { softClipCurve } from '../core/softclip.ts'
import { playbackGain } from '../core/playbackGain.ts'
import { getContext, audioSupported } from './engine.ts'

interface Chain { src: MediaElementAudioSourceNode; gain: GainNode; shaper: WaveShaperNode }
const chains = new WeakMap<HTMLAudioElement, Chain>()
const routed = new WeakSet<HTMLAudioElement>()
const active = new Set<HTMLAudioElement>()

/** 재생 중인 요소가 하나라도 있는가 (유휴 suspend 방지) */
export const playbackActive = (): boolean => {
  for (const a of active) if (!a.paused && !a.ended) return true
  return false
}

/** 필요하면 보정 게인 그래프를 붙인다(이미 있으면 게인만 갱신). peak 는 녹음 시 원시 피크. 반환 1 = 그래프 없음 */
export function attachGain(audio: HTMLAudioElement, peak: number | undefined): number {
  const g = playbackGain(peak)
  const existing = chains.get(audio)
  if (existing) { existing.gain.gain.value = g; return g }
  if (g <= 1.01 || !audioSupported()) return 1
  try {
    const ac = getContext()
    const src = ac.createMediaElementSource(audio)
    const gain = ac.createGain(); gain.gain.value = g
    const shaper = ac.createWaveShaper(); shaper.curve = softClipCurve(); shaper.oversample = '2x'
    src.connect(gain); gain.connect(shaper); shaper.connect(ac.destination)
    chains.set(audio, { src, gain, shaper }); routed.add(audio)
    return g
  } catch { return 1 } // MediaElementSource 를 만들 수 없는 WebView — 평소대로 재생
}

/** 재생 시작 직전: 컨텍스트 재개 + 활성 표시. WebAudio 를 타는 요소는 컨텍스트가 suspended 면 무음이다 */
export function beforePlay(audio: HTMLAudioElement): void {
  active.add(audio)
  if (!routed.has(audio)) return
  const ac = getContext()
  if (ac.state !== 'running') void ac.resume().catch(() => {})
}
export function afterStop(audio: HTMLAudioElement): void { active.delete(audio) }

/** 요소를 버릴 때 노드도 끊는다 — WebView 의 동시 미디어 상한을 물고 있지 않게 */
export function detachGain(audio: HTMLAudioElement): void {
  active.delete(audio)
  const c = chains.get(audio); if (!c) return
  try { c.src.disconnect(); c.gain.disconnect(); c.shaper.disconnect() } catch { /* 이미 끊김 */ }
  chains.delete(audio); routed.delete(audio)
}
/** 진단/테스트용. 그래프를 타지 않은 요소는 1 */
export const gainOf = (audio: HTMLAudioElement): number => chains.get(audio)?.gain.gain.value ?? 1
/** 진단/테스트용 — 재생 중인 요소들의 (게인, 진행 시각). <audio> 는 DOM 에 붙지 않으므로 여기서만 셀 수 있다 */
export const playbackDiag = (): { active: boolean; gains: number[]; times: number[] } => ({
  active: playbackActive(),
  gains: [...active].map(a => gainOf(a)),
  times: [...active].map(a => a.currentTime),
})
