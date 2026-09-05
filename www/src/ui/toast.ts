import { q } from './dom.ts'
let t: ReturnType<typeof setTimeout> | null = null
/** 토스트. action 이 있으면 토스트를 탭할 때 실행된다 (예: 삭제 실행 취소) */
export function toast(msg: string, ms = 2500, action?: () => void): void {
  const el = q('toast'); el.textContent = msg; el.classList.add('show')
  el.classList.toggle('actionable', !!action)
  el.onclick = action ? () => { action(); el.classList.remove('show'); el.onclick = null } : null
  if (t) clearTimeout(t)
  t = setTimeout(() => { el.classList.remove('show', 'actionable'); el.onclick = null }, ms)
}
