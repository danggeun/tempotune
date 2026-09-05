/** 연습/연주 타이머 (메뉴). (무활동 자동 종료는 main 의 inactivity watch 가 담당) */
import { sessionStore, tunerStore } from '../state/index.ts'
import { fmt } from '../core/format.ts'
import { q, on } from './dom.ts'
import { toast } from './toast.ts'

let int: ReturnType<typeof setInterval> | null = null
function render(): void {
  const s = sessionStore.get()
  q('timer-elapsed').textContent = fmt(s.elapsedSec); q('timer-detected').textContent = fmt(s.detectedSec)
  const btn = q('timer-toggle-btn'); btn.textContent = s.timerRunning ? '정지' : '시작'; btn.classList.toggle('active', s.timerRunning)
}
export function stopTimer(): void { if (int) clearInterval(int); int = null; sessionStore.set({ timerRunning: false }) }
function startTimer(): void {
  sessionStore.set({ timerRunning: true })
  if (int) clearInterval(int)
  int = setInterval(() => {
    const s = sessionStore.get(); if (!s.timerRunning) return
    const t = tunerStore.get()
    sessionStore.set({ elapsedSec: s.elapsedSec + 1, detectedSec: s.detectedSec + (t.playing ? 1 : 0) })
  }, 1000)
}
export function mountTimer(): void {
  on(q('timer-toggle-btn'), 'click', () => { if (sessionStore.get().timerRunning) stopTimer(); else startTimer() })
  // 초기화는 확인 없이 즉시 — 대신 삭제와 같은 '실행 취소' 토스트 (활 든 손이 스쳐도 40분 기록이 안 날아가게, UX 감사 A6).
  // 실행 취소는 카운트와 함께 '돌고 있었음' 도 되돌린다 (스친 것이면 계속 재던 중이었을 테니)
  on(q('timer-reset-btn'), 'click', () => {
    const { elapsedSec, detectedSec, timerRunning } = sessionStore.get()
    stopTimer(); sessionStore.set({ elapsedSec: 0, detectedSec: 0 })
    if (elapsedSec > 0) toast('초기화됨 · 실행 취소', 5000, () => { sessionStore.set({ elapsedSec, detectedSec }); if (timerRunning) startTimer() })
  })
  sessionStore.select(s => [s.elapsedSec, s.detectedSec, s.timerRunning].join(), render, { immediate: true })
}
