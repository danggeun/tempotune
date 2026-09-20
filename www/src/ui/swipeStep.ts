/**
 * 아래로 밀어 한 단계 내리기 (v2.3.2 M10) — 메트로놈 카드 전용.
 *
 * 왜: 접기 버튼을 하나로 합쳐 순환(접힘 → 펼침 → 전용 → 접힘)시켰는데, 순환만 두면 **펼침 → 접힘**이 두 탭이 된다.
 * 그런데 그게 제일 잦은 전환이다 — 메트로놈을 맞춰 놓고 튜너를 보러 내려가는 동작. 그래서 내리는 길을 따로 둔다.
 * 카드를 아래로 미는 동작이 "치워 둔다" 와 같은 뜻이라 글자 없이 읽힌다.
 *
 * 규칙 (가장자리 스와이프 ui/swipeBack.ts 와 같은 골격, 축만 세로):
 *   · 처음 10 px 이 세로면 잡고, 가로면 놓는다(그건 다른 동작 — 다이얼 회전·슬라이더)
 *   · 잡은 뒤에도 **아래 방향만** 센다. 위로 미는 건 아무 일도 하지 않는다(올라가는 길은 버튼이 맡는다)
 *   · 40 px 을 넘겨 놓으면 한 단계 내려간다. 카드가 따라 내려오지는 않는다 —
 *     접힘/펼침은 grid-template-rows 트랜지션이 이미 있어서, 손을 따라 움직이면 그 애니메이션과 겹쳐 두 번 움직여 보인다.
 *   · ignore 안에서 시작한 포인터는 처음부터 잡지 않는다 (BPM 세로 드래그·다이얼·슬라이더·버튼)
 */
import { on } from './dom.ts'

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
      // 잡히는 순간 포인터를 붙든다 — 안 그러면 손가락이 헤더 밖(본문 쪽)으로 내려가는 순간 pointermove·pointerup 이
      // 그 아래 요소로 가 버려서 끝을 못 본다. 내리는 제스처는 거의 항상 요소를 벗어난다
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
