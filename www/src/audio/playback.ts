/**
 * 녹음 재생 경로 — 보정 게인 + 소프트 리미터 (B12c).
 *
 * 문제: 재생이 `new Audio(blobUrl).play()` 였다. `volume` 은 1.0 이 상한이고 WebAudio 게인도 없어서
 * **1.0 을 넘을 방법이 아예 없었다.** 마이크는 `autoGainControl:false`(튜너에 옳음)로 열리므로 보면대 옆
 * 바이올린은 −20 dBFS 대로 녹음되고, 그대로 재생하면 "폰 볼륨 최대인데 작다" 가 된다.
 *
 * 해결: <audio> → MediaElementSource → Gain(보정) → WaveShaper(소프트 리미터) → destination.
 * 게인은 녹음할 때 실측한 원시 피크(item.peak)로 정하고, 없는 옛 녹음은 기본 부스트 + 리미터로 처리한다.
 *
 * 안전 설계 — 블라스트 반경을 좁힌다:
 *  1) **게인이 필요할 때만**(> 1.01) 그래프를 만든다. 이미 큰 녹음은 요소를 아예 건드리지 않아 기존 동작과 동일.
 *  2) 그래프 생성이 실패하면(오래된 WebView 의 MediaElementSource 결함 등) 조용히 평소대로 재생한다.
 *  3) 요소가 WebAudio 를 타면 컨텍스트가 suspended 일 때 무음이 되므로, 재생 전에 resume 하고
 *     유휴 판정(main 의 setIdleCheck)에 '재생 중' 을 포함시킨다.
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

/**
 * 필요하면 보정 게인 그래프를 붙인다. 이미 붙어 있으면 게인만 갱신.
 * @param peak 녹음 시 실측 원시 피크 (없으면 옛 녹음)
 * @returns 적용된 게인 (1 이면 그래프를 만들지 않았다는 뜻)
 */
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
  } catch { return 1 } // MediaElementSource 를 만들 수 없는 환경 — 평소대로 재생한다
}

/** 재생 시작 직전에 부른다: 컨텍스트 재개 + 활성 표시. 그래프를 안 탄 요소에도 안전하다. */
export function beforePlay(audio: HTMLAudioElement): void {
  active.add(audio)
  if (!routed.has(audio)) return
  const ac = getContext() // 'suspended'/'interrupted' 면 resume 까지 해 준다
  if (ac.state !== 'running') void ac.resume().catch(() => {})
}
export function afterStop(audio: HTMLAudioElement): void { active.delete(audio) }

/** 요소를 버릴 때 (releaseAudio) 노드도 끊는다 — WebView 의 동시 미디어 상한을 물고 있지 않게 */
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
