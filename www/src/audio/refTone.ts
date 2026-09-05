/**
 * 기준음 재생 (오실레이터). v1 동작 유지: 마이크 컨텍스트가 있을 때만 소리가 난다 (Phase 3에서 개선).
 * 버튼 상태는 refToneStore.active 를 UI가 구독해 그린다.
 */
import { KR_MIDI, type KrNote } from '../core/note.ts'
import { refToneStore, settingsStore } from '../state/index.ts'
import { A, onMic } from './engine.ts'

let osc: OscillatorNode | null = null, gain: GainNode | null = null

export function stopRefNote(): void {
  refToneStore.set({ active: null })
  if (osc && gain && A.micAC) {
    try {
      const t = A.micAC.currentTime
      gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t)
      gain.gain.exponentialRampToValueAtTime(.001, t + .05); osc.stop(t + .05)
    } catch { /* 이미 정지 */ }
  }
  osc = null; gain = null
}

function play(freq: number, active: string): void {
  if (!A.micAC) return
  osc = A.micAC.createOscillator(); gain = A.micAC.createGain()
  osc.type = 'triangle'; osc.frequency.value = freq; osc.connect(gain); gain.connect(A.micAC.destination)
  gain.gain.setValueAtTime(.22, A.micAC.currentTime); osc.start()
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

export function adjRefOctave(d: number): void {
  const { active, octave } = refToneStore.get()
  refToneStore.set({ octave: Math.max(2, Math.min(6, octave + d)) })
  if (active) { // 재생 중이면 새 옥타브로 즉시 갱신
    const name = active; refToneStore.set({ active: null }); stopRefNote(); toggleRefNote(name)
  }
}

onMic('beforeClose', stopRefNote)
