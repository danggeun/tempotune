/** 기준음 버튼(메뉴) + 튜너 헤더의 'A 듣기' — refToneStore 를 구독해 on 상태와 옥타브 숫자를 그린다. 라벨은 음이름 표기 설정을 따른다 */
import { refToneStore, settingsStore } from '../state/index.ts'
import { toggleRefNote, adjRefOctave, toggleRefA } from '../audio/refTone.ts'
import { KR, EN, type KrNote } from '../core/note.ts'
import { q, qsa, on } from './dom.ts'

export function mountRefPanel(): void {
  qsa('.ref-oct-btn').forEach(b => on(b, 'click', () => adjRefOctave(b.textContent === '−' ? -1 : 1)))
  qsa<HTMLElement>('.ref-note-btn').forEach(b => on(b, 'click', () => toggleRefNote(b.dataset.note!)))
  on(q('ref-a-btn'), 'click', toggleRefA)
  refToneStore.select(s => s.octave, o => { q('ref-oct-num-menu').textContent = String(o) }, { immediate: true })
  refToneStore.select(s => s.active, active => {
    qsa<HTMLElement>('.ref-note-btn').forEach(b => b.classList.toggle('on', b.dataset.note === active))
    q('ref-a-btn').classList.toggle('on', active === 'A4')
  }, { immediate: true })
  // 버튼 라벨: 도레미 / C D E (data-note 는 내부 키라 그대로)
  settingsStore.select(s => s.noteNames, sys => qsa<HTMLElement>('.ref-note-btn').forEach(b => {
    const key = b.dataset.note!
    if (key === '도2') { b.textContent = sys === 'en' ? 'C↑' : '도↑'; return }
    const i = KR.indexOf(key as KrNote); b.textContent = sys === 'en' ? EN[i]! : key
  }), { immediate: true })
}
