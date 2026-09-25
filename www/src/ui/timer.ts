/** 연습/연주 타이머 (메뉴). 무활동 자동 종료는 main 의 inactivity watch 가 담당 */
import { sessionStore, tunerStore } from '../state/index.ts'
import { fmt } from '../core/format.ts'
import { q, on } from './dom.ts'
import { toast } from './toast.ts'
import { t } from '../core/i18n/index.ts'
import { onLangChange } from './lang.ts'

let int: ReturnType<typeof setInterval> | null = null
function render(): void {
  const s = sessionStore.get()
  q('timer-elapsed').textContent = fmt(s.elapsedSec); q('timer-detected').textContent = fmt(s.detectedSec)
  const btn = q('timer-toggle-btn'); btn.textContent = t(s.timerRunning ? 'common.stop' : 'common.start'); btn.classList.toggle('active', s.timerRunning)
}
export function stopTimer(): void { if (int) clearInterval(int); int = null; sessionStore.set({ timerRunning: false }) }
function startTimer(): void {
  sessionStore.set({ timerRunning: true })
  if (int) clearInterval(int)
  // 벽시계 기준 — 백그라운드에서 setInterval 이 늦어져도 경과 시간이 적게 잡히지 않게
  let last = Date.now(), acc = 0
  int = setInterval(() => {
    const s = sessionStore.get(); if (!s.timerRunning) return
    const now = Date.now(); acc += (now - last) / 1000; last = now
    const whole = Math.round(acc); if (whole <= 0) return // round: 틱이 몇 ms 이르게 와도 1초를 잃지 않는다
    acc -= whole
    sessionStore.set({ elapsedSec: s.elapsedSec + whole, detectedSec: s.detectedSec + (tunerStore.get().playing ? whole : 0) })
  }, 1000)
}
export function mountTimer(): void {
  on(q('timer-toggle-btn'), 'click', () => { if (sessionStore.get().timerRunning) stopTimer(); else startTimer() })
  // 초기화는 확인 없이 즉시, 대신 '실행 취소' 토스트. 실행 취소는 돌고 있던 상태도 되돌린다
  on(q('timer-reset-btn'), 'click', () => {
    const { elapsedSec, detectedSec, timerRunning } = sessionStore.get()
    stopTimer(); sessionStore.set({ elapsedSec: 0, detectedSec: 0 })
    if (elapsedSec > 0) toast(t('menu.resetDone') + t('common.undoSuffix'), 5000, () => { sessionStore.set({ elapsedSec, detectedSec }); if (timerRunning) startTimer() })
  })
  sessionStore.select(s => [s.elapsedSec, s.detectedSec, s.timerRunning].join(), render, { immediate: true })
  onLangChange(render)
}
