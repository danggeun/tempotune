/** 헤더/메뉴의 REC 버튼과 녹음 타이머 표시 */
import { sessionStore } from '../state/index.ts'
import { fmt } from '../core/format.ts'
import { toggleRec } from '../audio/recorder.ts'
import { q, on } from './dom.ts'
import { toast } from './toast.ts'

export function mountRecHeader(): void {
  const tb = () => { const r = toggleRec(); if (!r.ok) toast(r.error) }
  on(q('rec-hdr-btn'), 'click', tb); on(q('rec-toggle-btn'), 'click', tb)
  sessionStore.select(s => s.recording, rec => {
    toast(rec ? '녹음 시작' : '녹음 완료') // 버튼이 아니라 상태 전이에서: 마이크 자동 종료로 멈춘 경우에도 안내
    q('rec-hdr-btn').classList.toggle('rec-on', rec)
    const btn = q('rec-toggle-btn')
    btn.innerHTML = rec ? '<span class="rec-live-dot"></span>REC 중지' : '녹음 시작' // 점 스타일은 CSS (.rec-live-dot / #rec-hdr-btn.rec-on #rec-hdr-dot)
    btn.classList.toggle('rec-active', rec)
    const t = q('hdr-rec-time'); t.classList.toggle('show', rec); t.textContent = fmt(0)
  })
  sessionStore.select(s => s.recElapsedSec, sec => { if (sessionStore.get().recording) q('hdr-rec-time').textContent = fmt(sec) })
}
