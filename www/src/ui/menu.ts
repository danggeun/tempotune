/** 풀스크린 메뉴 + 설정 페이지 열기/닫기 */
import { q, qs, on, reflow } from './dom.ts'
import { attachSwipeBack } from './swipeBack.ts'
import { dronePopOpen } from './drone.ts'

export function toggleMenu(): void { q('menu-overlay').classList.toggle('open') }
/** 편집기에서 돌아올 때: 트랜지션 없이 즉시 열린 상태로 */
export function showMenuInstant(): void {
  const el = q('menu-overlay'); el.style.transition = 'none'; el.classList.add('open'); reflow(el); el.style.transition = ''
}
export function hideMenu(): void { q('menu-overlay').classList.remove('open') }
export const openSettings = (): void => q('settings-page').classList.add('open')
export const closeSettings = (): void => q('settings-page').classList.remove('open')

/** 화면을 덮고 있는 오버레이가 있는가 — 전역 단축키(Space)는 지금 보이는 화면의 것 */
export const overlayOpen = (): boolean =>
  q('menu-overlay').classList.contains('open') || q('settings-page').classList.contains('open') || q('mic-popup-bg').classList.contains('show') || dronePopOpen()

export function mountMenu(): void {
  on(q('menu-btn'), 'click', toggleMenu)
  on(qs('.menu-close-btn'), 'click', toggleMenu)
  on(q('settings-hdr-btn'), 'click', openSettings)
  on(q('settings-back-btn'), 'click', closeSettings)
  // 가장자리 스와이프 = 뒤로: 메뉴 → 본화면, 설정 → 메뉴
  attachSwipeBack(q('menu-overlay'), { onBack: hideMenu })
  attachSwipeBack(q('settings-page'), { onBack: closeSettings })
}
