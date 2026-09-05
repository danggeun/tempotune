/**
 * 최소 상태 스토어. 프레임워크 없이 "상태 → 구독자" 흐름만 제공한다.
 * 왜: UI가 오디오 내부 변수를 직접 읽지 않게 하고(설계서 §C1), 값이 바뀔 때만 DOM을 만지게 하기 위해.
 */
export type Listener<T> = (value: T, prev: T) => void
export type Unsubscribe = () => void

export interface Store<S extends object> {
  get(): S
  /** 얕은 병합. 어떤 필드도 변하지 않았으면 알림 없음. */
  set(patch: Partial<S>): void
  /** selector 결과가 바뀔 때만 fn 호출. immediate=true면 등록 즉시 한 번 호출. */
  select<T>(selector: (s: S) => T, fn: Listener<T>, opts?: { immediate?: boolean; equals?: (a: T, b: T) => boolean }): Unsubscribe
  /** 모든 변경에 호출 (고빈도 스토어에서는 select 권장) */
  subscribe(fn: Listener<S>): Unsubscribe
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial
  const listeners = new Set<Listener<S>>()
  return {
    get: () => state,
    set(patch) {
      let changed = false
      for (const k in patch) { if (!Object.is((state as any)[k], (patch as any)[k])) { changed = true; break } }
      if (!changed) return
      const prev = state
      state = { ...state, ...patch }
      for (const l of listeners) l(state, prev)
    },
    select(selector, fn, opts = {}) {
      const eq = opts.equals ?? Object.is
      let last = selector(state)
      if (opts.immediate) fn(last, last)
      const l: Listener<S> = s => { const v = selector(s); if (!eq(v, last)) { const p = last; last = v; fn(v, p) } }
      listeners.add(l); return () => { listeners.delete(l) }
    },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
  }
}
