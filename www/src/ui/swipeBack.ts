/**
 * 가장자리 스와이프로 뒤로 (v2.3.0) — iOS 의 "왼쪽 끝에서 오른쪽으로 끌면 뒤로" 그대로.
 *
 * 왜: 홈 화면 웹앱(standalone)에는 브라우저의 뒤로 제스처가 없다. 메뉴·설정·편집기가 전부
 * 전체 화면이라 버튼 말고는 나갈 길이 없었고, 아이폰 사용자는 이 제스처를 당연히 기대한다.
 *
 * 규칙 (iOS 와 같게):
 *   · 시작은 **왼쪽 가장자리 24 px** 안에서만. 화면 한가운데서 옆으로 긋는 건 다른 뜻일 수 있다(스크럽·슬라이더)
 *   · 처음 10 px 이 가로면 잡고, 세로면 놓는다(그건 스크롤). 잡은 뒤로는 화면이 손가락을 따라온다
 *   · 놓을 때 폭의 35 % 를 넘었거나 빠르면(0.5 px/ms) 닫힘, 아니면 제자리로
 *   · 가로 드래그를 가진 요소(파형 스크럽·핸들·range) 위에서 시작하면 아예 잡지 않는다
 *
 * 닫히는 애니메이션 뒤에 onBack() 을 부른다 — 실제 닫기(클래스 제거·상태 정리)는 원래 코드가 한다.
 * 그 다음 transform 을 지우는데, 페이드아웃(--t-std .2 s)이 끝난 뒤에 지운다 — 바로 지우면
 * 사라지는 중인 화면이 제자리로 튀어 돌아오는 게 보인다.
 */
import { on } from './dom.ts'

const EDGE_PX = 24, ARM_PX = 10, COMMIT_FRAC = 0.35, COMMIT_VEL = 0.5, FADE_MS = 260

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
      setTimeout(() => { page.style.transition = 'none'; page.style.transform = ''; page.classList.remove('swiping'); void page.offsetWidth; page.style.transition = '' }, FADE_MS)
    }, 180)
  }

  on(page, 'pointerdown', (e: PointerEvent) => {
    if (!e.isPrimary || e.clientX > EDGE_PX) return
    if (opts.ignore && (e.target as Element).closest(opts.ignore)) return
    tracking = true; armed = false; id = e.pointerId
    x0 = lastX = e.clientX; y0 = e.clientY; lastT = performance.now(); vel = 0
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
    const now = performance.now(), dt = now - lastT
    if (dt > 0) vel = (e.clientX - lastX) / dt
    lastX = e.clientX; lastT = now
    page.style.transform = `translateX(${Math.max(0, dx)}px)`
    e.preventDefault()
  })
  const end = (e: PointerEvent): void => {
    if (!tracking || e.pointerId !== id) return
    const dx = Math.max(0, e.clientX - x0), wasArmed = armed
    reset()
    if (!wasArmed) return
    const commit = dx > page.clientWidth * COMMIT_FRAC || (vel > COMMIT_VEL && dx > 40)
    settle(commit ? 'back' : 'home')
  }
  on(page, 'pointerup', end)
  on(page, 'pointercancel', end)
}
