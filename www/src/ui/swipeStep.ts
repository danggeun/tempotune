/**
 * 메트로놈 카드의 세로 끌기. 처음 10 px 로 가로/세로를 판정하고, 세로면 포인터를 붙들어 손을 뗄 때까지 본다.
 * 무엇을 움직일지는 호출자가 정한다 — start(방향) 이 false 면 그 방향으로는 갈 곳이 없어 놓아 준다.
 */
import { on } from './dom.ts'

const ARM_PX = 10

export type VDragHandlers = {
  /** -1 = 위, +1 = 아래. 이 방향으로 끌 수 있으면 true */
  start: (dir: -1 | 1) => boolean
  /** 누른 곳에서부터의 세로 이동(아래 +) */
  move: (dy: number) => void
  /** vy = 놓기 직전 속도(px/ms, 아래 +). 멈췄다 놓으면 0 */
  end: (dy: number, vy: number) => void
  /** 이 선택자 안에서 시작한 포인터는 무시 (자기 드래그가 있는 요소) */
  ignore?: string
}

export function attachVDrag(el: HTMLElement, h: VDragHandlers): void {
  let id = -1, x0 = 0, y0 = 0, dy = 0, armed = false, tracking = false, lastY = 0, lastT = 0, vy = 0

  const reset = (): void => { tracking = false; armed = false; id = -1 }

  on(el, 'pointerdown', (e: PointerEvent) => {
    if (!e.isPrimary || tracking) return
    if (h.ignore && (e.target as Element).closest(h.ignore)) return
    tracking = true; armed = false; id = e.pointerId; x0 = e.clientX; y0 = lastY = e.clientY; lastT = e.timeStamp; vy = 0; dy = 0
  })
  on(el, 'pointermove', (e: PointerEvent) => {
    if (!tracking || e.pointerId !== id) return
    const dx = e.clientX - x0; dy = e.clientY - y0
    if (!armed) {
      if (Math.abs(dx) > ARM_PX && Math.abs(dx) > Math.abs(dy)) { reset(); return } // 가로 — 다른 동작에 양보
      if (Math.abs(dy) < ARM_PX) return
      if (!h.start(dy < 0 ? -1 : 1)) { reset(); return }
      armed = true
      // 포인터를 붙든다 — 손가락이 요소 밖으로 나가면 pointermove·pointerup 이 다른 요소로 가 끝을 못 본다
      try { el.setPointerCapture(id) } catch { /* 이미 놓친 포인터 */ }
    }
    const dt = e.timeStamp - lastT
    if (dt > 0) vy = 0.7 * ((e.clientY - lastY) / dt) + 0.3 * vy
    lastY = e.clientY; lastT = e.timeStamp
    h.move(dy)
  })
  const end = (e: PointerEvent): void => {
    if (!tracking || e.pointerId !== id) return
    const wasArmed = armed
    if (armed) { try { el.releasePointerCapture(id) } catch { /* 이미 풀림 */ } }
    reset()
    if (wasArmed) h.end(dy, e.timeStamp - lastT > 100 ? 0 : vy)
  }
  on(el, 'pointerup', end)
  on(el, 'pointercancel', end)
}
