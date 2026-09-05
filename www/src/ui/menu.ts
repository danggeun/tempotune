/** 풀스크린 메뉴 + 설정 페이지 열기/닫기 */
import { q, qs, on, reflow } from './dom.ts'

export function toggleMenu(): void {
  const overlay = q('menu-overlay')
  if (overlay.classList.toggle('open')) q('ref-panel').classList.remove('open')
}
/** 편집기에서 돌아올 때: 트랜지션 없이 즉시 열린 상태로 (v1 closeEditor) */
export function showMenuInstant(): void {
  const el = q('menu-overlay'); el.style.transition = 'none'; el.classList.add('open'); reflow(el); el.style.transition = ''
}
export function hideMenu(): void { q('menu-overlay').classList.remove('open') }
export const openSettings = (): void => q('settings-page').classList.add('open')
export const closeSettings = (): void => q('settings-page').classList.remove('open')

export function mountMenu(): void {
  on(q('menu-btn'), 'click', toggleMenu)
  on(qs('.menu-close-btn'), 'click', toggleMenu)
  on(q('settings-open-btn'), 'click', openSettings)
  on(q('settings-back-btn'), 'click', closeSettings)
}
