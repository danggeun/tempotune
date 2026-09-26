/**
 * 앱이 내는 음 두 가지. 단일 컨텍스트라 마이크 없이도 소리가 난다. 둘은 동시에 울리지 않는다 — 하나를 켜면 다른 하나는 꺼진다
 * - A 듣기: 튜닝용 A. 삼각파(배음이 있어 낮은 A 도 폰 스피커로 들린다), 옥타브는 설정(aOctave)
 * - 드론: 연습 내내 켜 두는 한 음. 사인파 4옥타브 — 튜너가 그 주파수만 잘라내고 읽는다(core/drone.ts)
 */
import { refToneStore, droneStore, settingsStore } from '../state/index.ts'
import { droneHz, DRONE_GAIN, DRONE_FADE_S } from '../core/drone.ts'
import { getContext, onMic, audioSupported, suspendIfIdle, output, setAnalysisDrone } from './engine.ts'

type Voice = { osc: OscillatorNode; gain: GainNode; ctx: AudioContext }

function startVoice(type: OscillatorType, hz: number, level: number, fade: number): Voice {
  const ctx = getContext(), osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime
  osc.type = type; osc.frequency.value = hz; osc.connect(gain); gain.connect(output())
  if (fade > 0) { gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(level, t + fade) } else gain.gain.setValueAtTime(level, t)
  osc.start()
  return { osc, gain, ctx }
}
function stopVoice(v: Voice | null, fade: number): void {
  if (!v) return
  try {
    const t = v.ctx.currentTime
    v.gain.gain.cancelScheduledValues(t); v.gain.gain.setValueAtTime(v.gain.gain.value, t)
    v.gain.gain.exponentialRampToValueAtTime(.001, t + fade); v.osc.stop(t + fade)
  } catch { /* 이미 정지 */ }
}

// A 듣기
let aVoice: Voice | null = null
export function stopRefNote(): void {
  if (!refToneStore.get().active && !aVoice) return
  refToneStore.set({ active: false })
  stopVoice(aVoice, .05); aVoice = null
  setTimeout(suspendIfIdle, 100)
}
/** 튜너 헤더의 'A 듣기': 기준음(refHz) A 를 설정 옥타브(aOctave)로 토글 */
export function toggleRefA(): void {
  if (refToneStore.get().active) { stopRefNote(); return }
  if (!audioSupported()) return
  stopDrone()
  const s = settingsStore.get()
  aVoice = startVoice('triangle', s.refHz * Math.pow(2, s.aOctave - 4), .22, 0)
  refToneStore.set({ active: true })
}
onMic('beforeClose', stopRefNote) // 마이크를 끄면 A 듣기도 정지 (드론은 계속 — 튜너와 따로 가는 연습 소리)

// 드론
let droneVoice: Voice | null = null
/** 음(0 = 도 … 11 = 시)으로 드론을 켠다 */
export function startDrone(pitchClass: number): void {
  if (!audioSupported()) return
  stopRefNote()
  stopVoice(droneVoice, DRONE_FADE_S)
  const hz = droneHz(pitchClass, settingsStore.get().refHz)
  droneVoice = startVoice('sine', hz, DRONE_GAIN, DRONE_FADE_S)
  droneStore.set({ pitchClass })
  setAnalysisDrone(hz)
}
export function stopDrone(): void {
  if (droneStore.get().pitchClass === null && !droneVoice) return
  droneStore.set({ pitchClass: null })
  stopVoice(droneVoice, DRONE_FADE_S); droneVoice = null
  setAnalysisDrone(null)
  setTimeout(suspendIfIdle, 100)
}
// 기준음(A = …Hz)을 바꾸면 울리는 드론도 바로 따라간다 — 튜너의 잘라내기도 새 주파수로
settingsStore.select(s => s.refHz, ref => {
  const pc = droneStore.get().pitchClass
  if (pc === null || !droneVoice) return
  const hz = droneHz(pc, ref)
  droneVoice.osc.frequency.setTargetAtTime(hz, droneVoice.ctx.currentTime, .02)
  setAnalysisDrone(hz)
})
