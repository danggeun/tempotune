/**
 * 음 이름·MIDI·cents 계산. 순수 함수.
 * 한국어 음이름(도~시)은 이 앱의 표시 언어이며 디자인 결정(설계서 §2).
 */
export const KR = ['도', '도♯', '레', '레♯', '미', '파', '파♯', '솔', '솔♯', '라', '라♯', '시'] as const
export type KrNote = typeof KR[number]

export const ENHARMONIC: Readonly<Partial<Record<KrNote, string>>> = { '도♯': '레♭', '레♯': '미♭', '파♯': '솔♭', '솔♯': '라♭', '라♯': '시♭' }
export const KR_MIDI: Readonly<Record<KrNote, number>> = { '도': 0, '도♯': 1, '레': 2, '레♯': 3, '미': 4, '파': 5, '파♯': 6, '솔': 7, '솔♯': 8, '라': 9, '라♯': 10, '시': 11 }

/** 주파수 → 가장 가까운 MIDI 번호 (A4=440 기준; 기준음 보정은 centsFrom에서) */
export function hzToMidi(hz: number): number { return Math.round(12 * Math.log2(hz / 440)) + 69 }
export function midiToHz(midi: number, refHz = 440): number { return refHz * Math.pow(2, (midi - 69) / 12) }

/** 주파수의, 기준음 refHz로 보정된 midi 음에 대한 cents 편차 (정수, v1 동작 유지) */
export function centsFrom(hz: number, midi: number, refHz: number): number {
  return Math.round(1200 * Math.log2(hz / midiToHz(midi, refHz)))
}

export function noteName(midi: number): KrNote { return KR[((midi % 12) + 12) % 12]! }
export function octaveOf(midi: number): number { return Math.floor(midi / 12) - 1 }

/** 표시용 분해: 본체(도/레/…)와 임시표(♯) */
export function splitAccidental(name: KrNote): { base: string; acc: '' | '♯' } {
  return { base: name.replace('♯', ''), acc: name.includes('♯') ? '♯' : '' }
}
