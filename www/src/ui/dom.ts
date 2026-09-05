/** DOM 도우미 — id 조회의 null 체크를 한 곳에서. 없는 id는 프로그래밍 오류이므로 즉시 throw. */
export function q<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} not found`)
  return el as T
}
export function qs<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel)
  if (!el) throw new Error(`${sel} not found`)
  return el
}
export function qsa<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] { return Array.from(root.querySelectorAll<T>(sel)) }
export function on<K extends keyof HTMLElementEventMap>(el: HTMLElement | Window | Document, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions): void { el.addEventListener(type, fn as EventListener, opts) }

/** 강제 리플로우 (CSS 트랜지션의 시작값을 확정할 때) */
export function reflow(el: HTMLElement): void { void el.offsetHeight }

/** 재생 글리프 — 정지(■)는 메트로놈처럼 '처음으로' 를 뜻하므로, 위치를 유지하는 일시정지는 앱 전체에서 ❚❚ (UX 감사 D8) */
export const PLAY_GLYPH = '▶'
export const PAUSE_GLYPH = '❚❚'
