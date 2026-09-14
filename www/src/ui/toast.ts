import { q } from './dom.ts'

/** 동시에 쌓아 둘 최대 개수 — 그 이상은 화면을 덮는다 */
const MAX_TOASTS = 3
/** 페이드아웃 시간 (style.css 의 .toast transition 과 같아야 한다) */
const FADE_MS = 260

type Slot = { el: HTMLDivElement; timer: ReturnType<typeof setTimeout>; msg: string; actionable: boolean }
const slots: Slot[] = []

/**
 * 넘칠 때 내보낼 항목의 인덱스 — 액션이 없는 가장 오래된 것 우선, 전부 액션이면 가장 오래된 것.
 * 액션 토스트(실행 취소)는 사용자가 누를 기회를 잃으면 데이터가 사라지므로 가장 늦게 밀어낸다. 순수.
 */
export function evictIndex(actionable: readonly boolean[]): number {
  if (!actionable.length) return -1
  const i = actionable.indexOf(false)
  return i >= 0 ? i : 0
}

function markLatest(): void {
  // 가장 최근 토스트가 #toast — 기존 선택자(e2e·문서)가 "지금 뜬 토스트" 를 가리키도록 유지
  for (const s of slots) s.el.removeAttribute('id')
  const last = slots[slots.length - 1]
  if (last) last.el.id = 'toast'
}

function drop(s: Slot): void {
  const i = slots.indexOf(s)
  if (i < 0) return
  clearTimeout(s.timer); slots.splice(i, 1)
  s.el.classList.remove('show', 'actionable'); s.el.onclick = null
  setTimeout(() => s.el.remove(), FADE_MS)
  markLatest()
}

/** 토스트. action 이 있으면 토스트를 탭할 때 실행된다 (예: 삭제 실행 취소) */
export function toast(msg: string, ms = 2500, action?: () => void): void {
  // 같은 안내가 연달아 오면 쌓지 않고 시간만 연장 (액션 토스트는 각각이 서로 다른 항목을 되살리므로 제외)
  if (!action) {
    const same = slots.find(s => s.msg === msg && !s.actionable)
    if (same) { clearTimeout(same.timer); same.timer = setTimeout(() => drop(same), ms); return }
  }
  const host = q('toast-host')
  const el = document.createElement('div')
  el.className = 'toast'; el.textContent = msg
  if (action) el.classList.add('actionable')
  const slot: Slot = { el, timer: setTimeout(() => drop(slot), ms), msg, actionable: !!action }
  el.onclick = action ? () => { action(); drop(slot) } : null
  host.appendChild(el)
  slots.push(slot); markLatest()
  // 시작값(opacity 0)을 확정한 뒤 .show 로 페이드인
  requestAnimationFrame(() => { if (slots.includes(slot)) el.classList.add('show') }) // 그 사이 drop 됐으면 되살리지 않는다
  while (slots.length > MAX_TOASTS) drop(slots[evictIndex(slots.map(s => s.actionable))]!)
}
