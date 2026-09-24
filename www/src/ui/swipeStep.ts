/**
 * 아래로 밀어 한 단계 내리기 — 메트로놈 카드 전용. swipeBack 과 같은 골격, 축만 세로이고 아래 방향만 센다.
 * 카드는 손을 따라오지 않는다 — 접힘/펼침의 grid-template-rows 트랜지션과 겹쳐 두 번 움직여 보인다.
 */
import { on } from './dom.ts'

// 처음 10 px 로 가로/세로 판정, 40 px 넘겨 놓으면 한 단계
const ARM_PX = 10, COMMIT_PX = 40

export function attachSwipeStep(el: HTMLElement, opts: { onStep: () => void; ignore?: string }): void {
  let id = -1, x0 = 0, y0 = 0, armed = false, tracking = false

  const reset = (): void => { tracking = false; armed = false; id = -1 }

  on(el, 'pointerdown', (e: PointerEvent) => {
    if (!e.isPrimary) return
    if (opts.ignore && (e.target as Element).closest(opts.ignore)) return
    tracking = true; armed = false; id = e.pointerId; x0 = e.clientX; y0 = e.clientY
  })
  on(el, 'pointermove', (e: PointerEvent) => {
    if (!tracking || e.pointerId !== id) return
    const dx = e.clientX - x0, dy = e.clientY - y0
    if (!armed) {
      if (Math.abs(dx) > ARM_PX && Math.abs(dx) > Math.abs(dy)) { reset(); return } // 가로 — 다른 동작에 양보
      if (dy < ARM_PX) return
      armed = true
      // 포인터를 붙든다 — 손가락이 요소 밖으로 내려가면 pointermove·pointerup 이 아래 요소로 가 끝을 못 본다
      try { el.setPointerCapture(id) } catch { /* 이미 놓친 포인터 */ }
    }
  })
  const end = (e: PointerEvent): void => {
    if (!tracking || e.pointerId !== id) return
    const dy = e.clientY - y0, wasArmed = armed
    if (armed) { try { el.releasePointerCapture(id) } catch { /* 이미 풀림 */ } }
    reset()
    if (wasArmed && dy >= COMMIT_PX) opts.onStep()
  }
  on(el, 'pointerup', end)
  on(el, 'pointercancel', end)
}
