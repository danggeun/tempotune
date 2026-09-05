/** 기준음(A=) 드럼 피커 — 410~466 Hz 세로 드래그. settingsStore.refHz 와 동기화. */
import { CFG, settingsStore } from '../state/index.ts'
import { q, on } from './dom.ts'

const IH = 28, MIN = CFG.ref.min, MAX = CFG.ref.max
const hzToY = (hz: number) => -(MAX - hz) * IH
const yToHz = (y: number) => MAX - Math.round(-y / IH)
const clampY = (y: number) => Math.min(hzToY(MAX), Math.max(hzToY(MIN), y))

export function mountRefDrum(): void {
  // 드래그는 행(#ref-row) 전체에서 받는다 — 78×28 드럼만 잡으면 활 든 손이 자주 빗나간다 (UX 감사 B6)
  const outer = q('ref-row'), inner = q('ref-drum-inner')
  for (let hz = MAX; hz >= MIN; hz--) { const el = document.createElement('div'); el.className = 'ref-drum-item'; el.textContent = hz + ' Hz'; inner.appendChild(el) }
  const items = Array.from(inner.children) as HTMLElement[]
  let y = 0, drag = false, startY = 0, startDrumY = 0

  function setY(v: number, anim = false): void {
    y = v
    inner.style.transition = anim ? 'transform .18s cubic-bezier(.25,.46,.45,.94)' : 'none'
    inner.style.transform = `translateY(${v}px)`
    const hz = Math.max(MIN, Math.min(MAX, yToHz(v)))
    items.forEach((el, i) => el.classList.toggle('active', MAX - i === hz))
  }
  function snap(): void { const hz = Math.max(MIN, Math.min(MAX, yToHz(y))); setY(hzToY(hz), true); settingsStore.set({ refHz: hz }) } // 애니메이션 먼저, 그 다음 알림 (구독자가 transition:none 으로 덮지 않도록)

  on(outer, 'mousedown', (e: MouseEvent) => { drag = true; startY = e.clientY; startDrumY = y; inner.style.transition = 'none'; e.preventDefault() })
  on(window, 'mousemove', (e: MouseEvent) => { if (drag) setY(clampY(startDrumY + (e.clientY - startY))) })
  on(window, 'mouseup', () => { if (drag) { drag = false; snap() } })
  on(outer, 'touchstart', (e: TouchEvent) => { drag = true; startY = e.touches[0]!.clientY; startDrumY = y; inner.style.transition = 'none' }, { passive: true })
  on(window, 'touchmove', (e: TouchEvent) => { if (drag) setY(clampY(startDrumY + (e.touches[0]!.clientY - startY))) }, { passive: true })
  on(window, 'touchend', () => { if (drag) { drag = false; snap() } })

  // 외부(설정 복원)에서 refHz 가 바뀌면 드럼 위치 반영. 드래그 중에는 건드리지 않는다.
  settingsStore.select(s => s.refHz, hz => { if (!drag && yToHz(y) !== hz) setY(hzToY(hz), false) }, { immediate: true })
  setTimeout(() => setY(hzToY(settingsStore.get().refHz)), 30) // v1: 레이아웃 확정 후 재적용
}
