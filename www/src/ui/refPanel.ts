/** 튜너 헤더의 'A 듣기' — 누르면 켜고, 켜져 있으면(빨강) 끈다. 옥타브는 설정의 'A 듣기 높이' */
import { refToneStore } from '../state/index.ts'
import { toggleRefA } from '../audio/refTone.ts'
import { q, on } from './dom.ts'

export function mountRefPanel(): void {
  on(q('ref-a-btn'), 'click', toggleRefA)
  refToneStore.select(s => s.active, active => q('ref-a-btn').classList.toggle('on', active), { immediate: true })
}
