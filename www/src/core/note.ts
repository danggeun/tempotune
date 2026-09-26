/** 음 이름·MIDI·cents 계산. 순수 함수. 기본 표시 음이름은 한국어(도~시) */
export const KR = ['도', '도♯', '레', '레♯', '미', '파', '파♯', '솔', '솔♯', '라', '라♯', '시'] as const
export type KrNote = typeof KR[number]

export const ENHARMONIC: Readonly<Partial<Record<KrNote, string>>> = { '도♯': '레♭', '레♯': '미♭', '파♯': '솔♭', '솔♯': '라♭', '라♯': '시♭' }
/** 영문 음이름 (설정 noteNames 로 전환) */
export const EN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const
export const EN_ENHARMONIC: Readonly<Record<string, string>> = { 'C♯': 'D♭', 'D♯': 'E♭', 'F♯': 'G♭', 'G♯': 'A♭', 'A♯': 'B♭' }
import type { Lang } from './i18n/index.ts'
export type NoteNames = 'ko' | 'en'
/** 표시용 이름: 선택한 체계의 이름 + 보조 줄(다른 체계의 이름, 이명동음은 '/' 로. 예: 라♯→A♯/B♭, 최대 5글자) */
export function noteLabel(midi: number, system: NoteNames, lang: Lang = 'ko'): { name: string; secondary: string } {
  const i = ((midi % 12) + 12) % 12, ko = KR[i]!, en = EN[i]!
  if (lang === 'en') return { name: en, secondary: EN_ENHARMONIC[en] ?? '' } // 영어 화면에는 한국어 음이름을 섞지 않는다 — 보조 줄은 이명동음만
  if (system === 'en') return { name: en, secondary: ko + (ENHARMONIC[ko] ? '/' + ENHARMONIC[ko] : '') }
  return { name: ko, secondary: en + (EN_ENHARMONIC[en] ? '/' + EN_ENHARMONIC[en] : '') }
}

/** 주파수 → 가장 가까운 MIDI 번호 (A4=440 기준; 기준음 보정은 centsFrom에서) */
export function hzToMidi(hz: number): number { return Math.round(12 * Math.log2(hz / 440)) + 69 }
export function midiToHz(midi: number, refHz = 440): number { return refHz * Math.pow(2, (midi - 69) / 12) }

/** 주파수의, 기준음 refHz 로 보정된 midi 음에 대한 cents 편차 (정수) */
export function centsFrom(hz: number, midi: number, refHz: number): number {
  return Math.round(1200 * Math.log2(hz / midiToHz(midi, refHz)))
}

export function noteName(midi: number): KrNote { return KR[((midi % 12) + 12) % 12]! }
export function octaveOf(midi: number): number { return Math.floor(midi / 12) - 1 }

/** 표시용 분해: 본체(도/레/…)와 임시표(♯) */
export function splitAccidental(name: KrNote): { base: string; acc: '' | '♯' } {
  return { base: name.replace('♯', ''), acc: name.includes('♯') ? '♯' : '' }
}
