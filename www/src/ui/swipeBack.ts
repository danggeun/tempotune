/**
 * 가장자리 스와이프로 뒤로 — iOS 의 "왼쪽 끝에서 오른쪽으로 끌면 뒤로". 홈 화면 웹앱에는 브라우저 뒤로 제스처가 없다.
 * 닫히는 애니메이션 뒤에 onBack() — 실제 닫기는 호출자가 한다.
 */
import { on } from './dom.ts'

// 가장자리 24 px 안에서 시작 · 처음 10 px 로 가로/세로 판정 · FADE_MS = --t-std 페이드아웃
const EDGE_PX = 24, ARM_PX = 10, FADE_MS = 260
// 닫힘: 폭 35 % 를 넘겼거나, 놓는 순간에도 0.5 px/ms 로 움직이며 40 px 넘게 끌었을 때(튕김).
// 멈춘 채 40 ms 가 지나 놓으면 튕김이 아니다 — 마지막 움직임의 속도가 남아 있어도. Android·Flutter 속도 추적과 같은 기준
const COMMIT_FRAC = 0.35, COMMIT_VEL = 0.5, FLING_MIN_PX = 40, STOPPED_MS = 40

/** 놓았을 때 닫을지. dx 끈 거리, width 화면 폭, vel 마지막 움직임의 속도(px/ms), sinceMoveMs 마지막 움직임부터 놓기까지 */
export function commitsBack(dx: number, width: number, vel: number, sinceMoveMs: number): boolean {
  return dx > width * COMMIT_FRAC || (vel > COMMIT_VEL && dx > FLING_MIN_PX && sinceMoveMs < STOPPED_MS)
}

export type SwipeBackOpts = {
  onBack: () => void
  /** 이 선택자 안에서 시작한 포인터는 무시 (자기 가로 드래그가 있는 요소) */
  ignore?: string
  /** 잡히는 순간 한 번 — 예: 편집기 뒤에 메뉴를 미리 깔아 두기 */
  onArm?: () => void
}

export function attachSwipeBack(page: HTMLElement, opts: SwipeBackOpts): void {
  let id = -1, x0 = 0, y0 = 0, armed = false, tracking = false, lastX = 0, lastT = 0, vel = 0

  const reset = (): void => { tracking = false; armed = false; id = -1 }
  const settle = (to: 'back' | 'home'): void => {
    page.style.transition = 'transform .18s ease-out'
    if (to === 'home') {
      page.style.transform = 'translateX(0)'
      setTimeout(() => { page.style.transition = ''; page.style.transform = ''; page.classList.remove('swiping') }, 200)
      return
    }
    page.style.transform = 'translateX(100%)'
    setTimeout(() => {
      opts.onBack()
      setTimeout(() => { page.style.transition = 'none'; page.style.transform = ''; page.classList.remove('swiping'); void page.offsetWidth; page.style.transition = '' }, FADE_MS) // 페이드아웃 뒤에 지운다 — 바로 지우면 화면이 제자리로 튀어 보인다
    }, 180)
  }

  on(page, 'pointerdown', (e: PointerEvent) => {
    if (!e.isPrimary || e.clientX > EDGE_PX) return
    if (opts.ignore && (e.target as Element).closest(opts.ignore)) return
    tracking = true; armed = false; id = e.pointerId
    x0 = lastX = e.clientX; y0 = e.clientY; lastT = e.timeStamp; vel = 0
  })
  on(page, 'pointermove', (e: PointerEvent) => {
    if (!tracking || e.pointerId !== id) return
    const dx = e.clientX - x0, dy = e.clientY - y0
    if (!armed) {
      if (Math.abs(dy) > ARM_PX && Math.abs(dy) > Math.abs(dx)) { reset(); return } // 세로 — 스크롤에 양보
      if (dx < ARM_PX) return
      armed = true; opts.onArm?.()
      page.setPointerCapture(id); page.style.transition = 'none'; page.classList.add('swiping')
    }
    const dt = e.timeStamp - lastT // 이벤트가 생긴 시각 — 화면이 버벅여 늦게 처리돼도 속도가 틀어지지 않는다
    if (dt > 0) vel = (e.clientX - lastX) / dt
    lastX = e.clientX; lastT = e.timeStamp
    page.style.transform = `translateX(${Math.max(0, dx)}px)`
    e.preventDefault()
  })
  const end = (e: PointerEvent): void => {
    if (!tracking || e.pointerId !== id) return
    const dx = Math.max(0, e.clientX - x0), wasArmed = armed
    reset()
    if (!wasArmed) return
    settle(commitsBack(dx, page.clientWidth, vel, e.timeStamp - lastT) ? 'back' : 'home')
  }
  on(page, 'pointerup', end)
  on(page, 'pointercancel', end)
}
