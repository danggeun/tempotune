/** 기준음 버튼(패널 + 메뉴 두 곳) — refToneStore 를 구독해 on 상태와 옥타브 숫자를 그린다. */
import { refToneStore } from '../state/index.ts'
import { toggleRefNote, adjRefOctave, stopRefNote } from '../audio/refTone.ts'
import { q, qs, qsa, on } from './dom.ts'

export function closeRefPanel(): void { q('ref-panel').classList.remove('open'); stopRefNote() }

export function mountRefPanel(): void {
  on(qs('#ref-panel .panel-close'), 'click', closeRefPanel)
  qsa('.ref-oct-btn').forEach(b => on(b, 'click', () => adjRefOctave(b.textContent === '−' ? -1 : 1)))
  qsa<HTMLElement>('.ref-note-btn').forEach(b => on(b, 'click', () => toggleRefNote(b.dataset.note!)))
  refToneStore.select(s => s.octave, o => qsa('#ref-oct-num-ext,#ref-oct-num-menu').forEach(el => el.textContent = String(o)), { immediate: true })
  refToneStore.select(s => s.active, active => qsa<HTMLElement>('.ref-note-btn').forEach(b => b.classList.toggle('on', b.dataset.note === active)), { immediate: true })
}
