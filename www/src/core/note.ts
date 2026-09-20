/**
 * 음 이름·MIDI·cents 계산. 순수 함수.
 * 한국어 음이름(도~시)은 이 앱의 표시 언어이며 디자인 결정(설계서 §2).
 */
export const KR = ['도', '도♯', '레', '레♯', '미', '파', '파♯', '솔', '솔♯', '라', '라♯', '시'] as const
export type KrNote = typeof KR[number]

export const ENHARMONIC: Readonly<Partial<Record<KrNote, string>>> = { '도♯': '레♭', '레♯': '미♭', '파♯': '솔♭', '솔♯': '라♭', '라♯': '시♭' }
/** 영문 음이름 — 현 이름(A현·D현)이 영문이라 병기/전환 옵션 (설정 noteNames). 기본은 도레미 */
export const EN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const
export const EN_ENHARMONIC: Readonly<Record<string, string>> = { 'C♯': 'D♭', 'D♯': 'E♭', 'F♯': 'G♭', 'G♯': 'A♭', 'A♯': 'B♭' }
export type NoteNames = 'ko' | 'en'
/**
 * 표시용 이름: 선택한 체계의 이름과, 보조 줄.
 * 보조 줄 = **다른 체계의 이름 하나**. 그 체계에 이명동음이 있으면 '/' 로 붙인다(같은 음, 다른 표기 — '·' 는 나열로 읽힌다).
 * 같은 체계의 이명동음은 넣지 않는다 — 가운데 큰 글씨와 중복이다. v2.3.0 까지는 "시♭ · A♯ · B♭" 처럼 세 토막(114 px, 화면 폭의 30 %)이었고
 * 그 이유가 바로 한글을 두 번(가운데 라♯, 코너 시♭) 보여준 것이었다 (v2.3.1 L8). 결과는 항상 한 덩어리, 최대 5글자.
 *   도레미: 솔→G · 라♯→A♯/B♭     ABC: G→솔 · A♯→라♯/시♭
 */
export function noteLabel(midi: number, system: NoteNames): { name: string; secondary: string } {
  const i = ((midi % 12) + 12) % 12, ko = KR[i]!, en = EN[i]!
  if (system === 'en') return { name: en, secondary: ko + (ENHARMONIC[ko] ? '/' + ENHARMONIC[ko] : '') }
  return { name: ko, secondary: en + (EN_ENHARMONIC[en] ? '/' + EN_ENHARMONIC[en] : '') }
}
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
