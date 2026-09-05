/** 연습/연주 타이머 (메뉴). (무활동 자동 종료는 main 의 inactivity watch 가 담당) */
import { sessionStore, tunerStore } from '../state/index.ts'
import { fmt } from '../core/format.ts'
import { q, on } from './dom.ts'

let int: ReturnType<typeof setInterval> | null = null
function render(): void {
  const s = sessionStore.get()
  q('timer-elapsed').textContent = fmt(s.elapsedSec); q('timer-detected').textContent = fmt(s.detectedSec)
  const btn = q('timer-toggle-btn'); btn.textContent = s.timerRunning ? '정지' : '시작'; btn.classList.toggle('active', s.timerRunning)
}
export function stopTimer(): void { if (int) clearInterval(int); int = null; sessionStore.set({ timerRunning: false }) }
export function mountTimer(onInactive: () => void): void {
  on(q('timer-toggle-btn'), 'click', () => {
    if (sessionStore.get().timerRunning) { stopTimer(); return }
    sessionStore.set({ timerRunning: true })
    if (int) clearInterval(int)
    int = setInterval(() => {
      const s = sessionStore.get(); if (!s.timerRunning) return
      const t = tunerStore.get()
      sessionStore.set({ elapsedSec: s.elapsedSec + 1, detectedSec: s.detectedSec + (t.playing ? 1 : 0) })
      void onInactive
    }, 1000)
  })
  on(q('timer-reset-btn'), 'click', () => { stopTimer(); sessionStore.set({ elapsedSec: 0, detectedSec: 0 }) })
  sessionStore.select(s => [s.elapsedSec, s.detectedSec, s.timerRunning].join(), render, { immediate: true })
}
