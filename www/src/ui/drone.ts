/**
 * 헤더의 DRONE. 꺼져 있으면 누르면 음 고르는 창, 켜져 있으면(빨간 음이름) 누르면 끈다 — A 듣기·REC·메트로놈과 같은 규칙.
 * 창에서 음을 누르면 울리고 닫힌다. 바깥을 누르면 닫히기만 한다. 음이름은 표기 설정(도레미 / C D E)을 따른다
 */
import { droneStore, settingsStore } from '../state/index.ts'
import { startDrone, stopDrone } from '../audio/refTone.ts'
import { KR, EN } from '../core/note.ts'
import { q, qsa, on } from './dom.ts'
import { getLang, t } from '../core/i18n/index.ts'
import { onLangChange } from './lang.ts'
import { toast } from './toast.ts'

const HINT_KEY = 'intonome.hint.drone' // 창을 처음 열 때 한 번만 안내

const noteName = (pc: number): string => ((getLang() === 'en' || settingsStore.get().noteNames === 'en') ? EN : KR)[pc]!

export const dronePopOpen = (): boolean => q('drone-pop').classList.contains('open')

function openPop(): void {
  const hdr = q('hdr').getBoundingClientRect(), card = q('tuner-card').getBoundingClientRect(), pop = q('drone-pop')
  pop.style.top = `${hdr.bottom + 4}px`; pop.style.left = `${card.left}px`; pop.style.right = `${window.innerWidth - card.right}px`
  pop.classList.add('open'); q('drone-pop-bg').classList.add('open'); q('drone-btn').setAttribute('aria-expanded', 'true')
  let first = false
  try { if (!localStorage.getItem(HINT_KEY)) { localStorage.setItem(HINT_KEY, '1'); first = true } } catch { /* 저장이 막히면 띄우지 않는다 — 매번 뜨지 않게 */ }
  if (first) toast(t('drone.hint'), 4000)
}
export function closeDronePop(): void {
  q('drone-pop').classList.remove('open'); q('drone-pop-bg').classList.remove('open'); q('drone-btn').setAttribute('aria-expanded', 'false')
}

function render(): void {
  const pc = droneStore.get().pitchClass, btn = q('drone-btn')
  btn.classList.toggle('on', pc !== null)
  btn.textContent = pc === null ? t('hdr.drone') : noteName(pc)
  btn.setAttribute('aria-label', pc === null ? t('drone.pick') : t('drone.stop', { note: noteName(pc) }))
  qsa<HTMLElement>('.drone-note-btn').forEach(b => { b.textContent = noteName(+b.dataset.pc!) })
}

export function mountDrone(): void {
  on(q('drone-btn'), 'click', () => {
    if (droneStore.get().pitchClass !== null) { stopDrone(); return }
    if (dronePopOpen()) closeDronePop(); else openPop()
  })
  qsa<HTMLElement>('.drone-note-btn').forEach(b => on(b, 'click', () => { startDrone(+b.dataset.pc!); closeDronePop() }))
  // 바깥을 누르면 닫기만 한다 — 그 터치가 아래 버튼(메트로놈 등)으로 새지 않게 배경이 받는다
  on(q('drone-pop-bg'), 'pointerdown', (e: Event) => { e.preventDefault(); e.stopPropagation(); closeDronePop() })
  on(window, 'keydown', (e: KeyboardEvent) => { if (e.key === 'Escape' && dronePopOpen()) closeDronePop() })
  droneStore.select(s => s.pitchClass, render, { immediate: true })
  settingsStore.select(s => s.noteNames, render); onLangChange(render)
}
