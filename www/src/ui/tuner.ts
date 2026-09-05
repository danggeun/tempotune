/**
 * 튜너 카드 UI — 음이름/옥타브/cents, 게이지, 히스토리 캔버스, "탭하여 시작" 안내.
 * tunerStore 를 구독해 그린다. 오디오 모듈을 직접 읽지 않는다.
 */
import { noteName, octaveOf, splitAccidental, ENHARMONIC } from '../core/note.ts'
import { CFG, settingsStore, tunerStore } from '../state/index.ts'
import { q } from './dom.ts'

const hist: Array<number | null> = new Array(CFG.tuner.histLen).fill(null)

// ── 게이지 ──
let gaugeW = 0
function drawGauge(cents: number | null): void {
  const needle = q('gauge-needle'), zone = q('gauge-zone'), wrap = q('gauge-wrap')
  if (!gaugeW) gaugeW = wrap.offsetWidth || 300
  const W = gaugeW, ppc = (W / 2) / 50, tol = settingsStore.get().tolCents
  zone.style.left = (W / 2 - tol * ppc) + 'px'; zone.style.width = (tol * 2 * ppc) + 'px'
  if (cents === null) { needle.style.left = '50%'; needle.className = ''; return }
  needle.style.left = (W / 2 + Math.max(-50, Math.min(50, cents)) * ppc) + 'px'
  needle.className = Math.abs(cents) <= tol ? 'tune' : ''
}

// ── 히스토리 ──
function drawHistory(inTune: boolean): void {
  const canvas = q<HTMLCanvasElement>('tuner-history'); if (!canvas.offsetWidth) return
  const W = canvas.offsetWidth, H = Math.max(80, canvas.offsetHeight || 100), dpr = devicePixelRatio || 1
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.width = W + 'px'; canvas.style.height = H + 'px' }
  const c = canvas.getContext('2d')!; c.save(); c.scale(dpr, dpr)
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H)
  if (inTune) { c.fillStyle = 'rgba(34,197,94,.07)'; c.fillRect(0, 0, W, H) }
  const ppc = (W / 2) / 50, tol = settingsStore.get().tolCents, N = hist.length, rH = H / N
  c.fillStyle = 'rgba(34,197,94,.65)'; c.fillRect(W / 2 - tol * ppc, 0, tol * 2 * ppc, H)
  c.strokeStyle = 'rgba(255,255,255,.38)'; c.lineWidth = 1
  c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.stroke()
  c.lineWidth = 2.5; c.lineCap = 'round'
  for (let i = 0; i < N - 1; i++) {
    const v0 = hist[i], v1 = hist[i + 1]; if (v0 == null || v1 == null) continue
    const y0 = (i + .5) * rH, y1 = (i + 1.5) * rH
    const x0 = W / 2 + Math.max(-50, Math.min(50, v0)) * ppc, x1 = W / 2 + Math.max(-50, Math.min(50, v1)) * ppc
    c.globalAlpha = .22 + (i / (N - 1)) * .78
    c.strokeStyle = Math.abs(v0) <= tol ? '#4ade80' : '#ffffff'
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke()
  }
  c.globalAlpha = 1; c.restore()
}

// ── 음 표시 ──
function renderEmpty(): void {
  const nEl = q('tuner-note')
  nEl.textContent = '--'; nEl.className = 'empty'
  q('tuner-oct').textContent = ''; q('tuner-cents').textContent = ''; q('tuner-enharmonic').textContent = ''; q('tuner-acc').textContent = ''
  q('tuner-card').classList.remove('in-tune')
}
function renderNote(midi: number, cents: number, inTune: boolean): void {
  const name = noteName(midi), { base, acc } = splitAccidental(name)
  const nEl = q('tuner-note'); nEl.textContent = base; nEl.className = inTune ? 'tune' : ''
  const accEl = q('tuner-acc'); accEl.textContent = acc; accEl.style.color = inTune ? '#22c55e' : '#ffffff'
  q('tuner-oct').textContent = String(octaveOf(midi))
  q('tuner-enharmonic').textContent = ENHARMONIC[name] || ''
  q('tuner-card').classList.toggle('in-tune', inTune)
  q('tuner-cents').textContent = (cents > 0 ? '+' : '') + cents + ' ¢'
}

/** 오디오 상태 점 (튜너 헤더, UX 감사 B1): 켜짐 = 은은한 초록, 주의(컨텍스트 멈춤·탭 필요) = 앰버 펄스, 꺼짐 = 숨김. 글자 없이 점으로만 (v1 66e7159 계승) */
export function setAudioDot(state: 'off' | 'on' | 'warn'): void {
  const d = q('ai-dot'); d.classList.toggle('on', state === 'on'); d.classList.toggle('warn', state === 'warn')
}

/** "탭하여 시작" 안내 — 탭하면 onTap 을 호출, 성공(true) 시 원래 스타일로 복귀 */
let tapHandler: (() => void) | null = null
export function showTapHint(onTap: () => Promise<boolean>): void {
  const nEl = q('tuner-note'), card = q('tuner-card')
  nEl.textContent = '탭하여 시작'; nEl.className = 'empty'; nEl.style.fontSize = '28px'; nEl.style.letterSpacing = '.02em'
  if (tapHandler) card.removeEventListener('click', tapHandler) // 호출마다 리스너가 쌓이지 않게 (리뷰)
  const handler = async () => { if (await onTap()) { nEl.style.fontSize = ''; nEl.style.letterSpacing = ''; card.removeEventListener('click', handler); if (tapHandler === handler) tapHandler = null } }
  tapHandler = handler
  card.addEventListener('click', handler)
}

export function mountTuner(): void {
  new ResizeObserver(() => { gaugeW = 0 }).observe(q('gauge-wrap'))
  // 매 분석 프레임(≈43 Hz): 히스토리는 프레임마다 쌓고, 그리기는 rAF 에 한 번만 (vsync 와 비동기인 워커 프레임을 코얼레싱)
  let dirty = false, raf: number | null = null
  const paint = () => {
    raf = null; if (!dirty) return; dirty = false
    const s = tunerStore.get()
    if (s.hz === -1) { renderEmpty(); drawGauge(null); drawHistory(false); return }
    renderNote(s.midi, s.cents, s.inTune); drawGauge(s.cents); drawHistory(s.inTune)
  }
  tunerStore.select(s => s.frame, () => {
    const s = tunerStore.get()
    hist.push(s.hz === -1 ? null : s.cents); hist.shift()
    dirty = true; if (raf == null) raf = requestAnimationFrame(paint)
  })
  // 마이크 꺼짐 → 표시 초기화 (v1 closeMic)
  tunerStore.select(s => s.micReady, ready => {
    q('hdr-mic-btn').style.display = ready ? 'none' : 'flex'
    q('rec-hdr-btn').style.opacity = ready ? '1' : '.35'
    if (!ready) { renderEmpty(); drawGauge(null) }
  })
  // 초기 렌더 (v1: 200 ms 후)
  setTimeout(() => { drawGauge(null); drawHistory(false) }, 200)
}
