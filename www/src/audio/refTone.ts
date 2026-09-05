/**
 * 기준음 재생 (오실레이터). 단일 컨텍스트를 쓰므로 마이크 없이도 소리가 난다 (v1: 마이크 컨텍스트 필요).
 * 버튼 상태는 refToneStore.active 를 UI가 구독해 그린다.
 */
import { KR_MIDI, type KrNote } from '../core/note.ts'
import { refToneStore, settingsStore } from '../state/index.ts'
import { getContext, onMic, audioSupported, suspendIfIdle } from './engine.ts'

let osc: OscillatorNode | null = null, gain: GainNode | null = null, ctx: AudioContext | null = null

export function stopRefNote(): void {
  refToneStore.set({ active: null })
  if (osc && gain && ctx) {
    try {
      const t = ctx.currentTime
      gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t)
      gain.gain.exponentialRampToValueAtTime(.001, t + .05); osc.stop(t + .05)
    } catch { /* 이미 정지 */ }
  }
  osc = null; gain = null
  setTimeout(suspendIfIdle, 100)
}

function play(freq: number, active: string): void {
  if (!audioSupported()) return
  ctx = getContext()
  osc = ctx.createOscillator(); gain = ctx.createGain()
  osc.type = 'triangle'; osc.frequency.value = freq; osc.connect(gain); gain.connect(ctx.destination)
  gain.gain.setValueAtTime(.22, ctx.currentTime); osc.start()
  refToneStore.set({ active })
}

/** 같은 음을 다시 누르면 정지(토글). '도2'는 한 옥타브 위 도. */
export function toggleRefNote(name: string): void {
  const { active, octave } = refToneStore.get()
  if (active === name) { stopRefNote(); return }
  stopRefNote()
  const refHz = settingsStore.get().refHz
  if (name === '도2') { const midi = (octave + 2) * 12; play(refHz * Math.pow(2, (midi - 69) / 12), name); return }
  const semi = KR_MIDI[name as KrNote]; if (semi === undefined) return
  const midi = semi + (octave + 1) * 12
  play(refHz * Math.pow(2, (midi - 69) / 12), name)
}

/** 튜너 헤더의 'A 듣기': 기준음(refHz) 그대로의 A4 를 토글 — A 현을 맞추는 가장 흔한 일을 메뉴 없이 (튜너가 보이는 채로) */
export function toggleRefA(): void {
  if (refToneStore.get().active === 'A4') { stopRefNote(); return }
  stopRefNote(); play(settingsStore.get().refHz, 'A4')
}
export function adjRefOctave(d: number): void {
  const { active, octave } = refToneStore.get()
  refToneStore.set({ octave: Math.max(2, Math.min(6, octave + d)) })
  if (active && active !== 'A4') { stopRefNote(); toggleRefNote(active) } // 재생 중이면 새 옥타브로 즉시 갱신 (A 듣기는 옥타브 무관)
}

onMic('beforeClose', stopRefNote) // v1 동작 유지: 마이크를 끄면 기준음도 정지
