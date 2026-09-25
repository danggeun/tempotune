/**
 * 튜너 카드 UI — 음이름/옥타브/cents/Hz, 히스토리 캔버스, "탭하여 시작" 안내.
 * tunerStore 를 구독해 그린다. 오디오 모듈을 직접 읽지 않는다.
 */
import { octaveOf, noteLabel } from '../core/note.ts'
import { createHzReadout } from '../core/hzReadout.ts'
import { histLenFor } from '../core/hist.ts'
import { buildSegments, keepInTrace } from '../core/trace.ts'
import { CFG, settingsStore, tunerStore } from '../state/index.ts'
import { q } from './dom.ts'

const hzReadout = createHzReadout() // Hz 표시의 평활·갱신 주기

let tapHandler: (() => void) | null = null
// 트레이스 버퍼. 길이는 histSec × 프레임률이라 샘플레이트가 정해지면 다시 잡는다. histMidi 는 같은 인덱스의 음이름 — 음이 바뀐 자리에 가로줄을 안 긋기 위해
let histSec: number = CFG.tuner.histSec
let histSr = 44100
let hist: Array<number | null> = new Array(histLenFor(histSr, histSec, CFG.tuner.hop)).fill(null)
let histMidi: Array<number | null> = new Array(hist.length).fill(null)
/** 표시 버퍼라 내용 보존은 불필요 */
function resizeHist(sampleRate: number): void {
  histSr = sampleRate
  const n = histLenFor(sampleRate, histSec, CFG.tuner.hop)
  if (n === hist.length) return
  hist = new Array(n).fill(null); histMidi = new Array(n).fill(null)
}
/** 창 길이(초) 변경 — 비교 렌더/e2e 용 */
export function setHistSec(sec: number): void { histSec = sec; hist = []; resizeHist(histSr) }
/** 마지막 그리기에서 '음이 바뀌어 끊은' 세그먼트 수 (진단값) */
let lastSkipped = 0
/** 테스트·진단용 */
export const histDiag = (): { len: number; sec: number; sr: number; skipped: number } => ({ len: hist.length, sec: histSec, sr: histSr, skipped: lastSkipped })
/** 캔버스 색은 CSS 토큰에서 */
let okRgb = '34,197,94'
let stageBg = '#0d0f13'
let inkRgb = '255,255,255'
function readTokens(): void {
  const cs = getComputedStyle(document.documentElement)
  okRgb = cs.getPropertyValue('--ok-rgb').trim() || okRgb
  stageBg = cs.getPropertyValue('--tuner-bg').trim() || stageBg
  inkRgb = cs.getPropertyValue('--tuner-ink-rgb').trim() || inkRgb
}
/** 테마가 바뀌면 색을 다시 읽고 다시 그린다 */
export function retheme(): void { readTokens(); drawHistory(lastInTune) }
let lastInTune = false

// 히스토리
function drawHistory(inTune: boolean): void {
  const canvas = q<HTMLCanvasElement>('tuner-history'); if (!canvas.offsetWidth) return
  const W = canvas.offsetWidth, H = Math.max(80, canvas.offsetHeight || 100), dpr = devicePixelRatio || 1
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.width = W + 'px'; canvas.style.height = H + 'px' }
  lastInTune = inTune
  const c = canvas.getContext('2d')!; c.save(); c.scale(dpr, dpr)
  c.fillStyle = stageBg; c.fillRect(0, 0, W, H)
  if (inTune) { c.fillStyle = `rgba(${okRgb},.07)`; c.fillRect(0, 0, W, H) }
  const ppc = (W / 2) / 50, tol = settingsStore.get().tolCents, N = hist.length, rH = H / N
  lastSkipped = 0
  c.fillStyle = `rgba(${okRgb},.38)`; c.fillRect(W / 2 - tol * ppc, 0, tol * 2 * ppc, H) // 띠는 '영역' — 트레이스보다 뒤로
  c.strokeStyle = `rgba(${inkRgb},.38)`; c.lineWidth = 1
  c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.stroke()
  // ♭ / ♯ 방향 표시 — 최신 값이 맨 아래라 아래쪽에
  c.fillStyle = `rgba(${inkRgb},.42)`; c.font = "14px 'DM Mono', monospace"; c.textBaseline = 'bottom'
  c.textAlign = 'left'; c.fillText('\u266d', 8, H - 7)
  c.textAlign = 'right'; c.fillText('\u266f', W - 8, H - 7)
  c.lineWidth = 3; c.lineCap = 'round' // 90 cm 에서 보이는 굵기
  // 무엇을 잇고 무엇을 버릴지는 core/trace.ts 가 정한다
  const { segs, breaks } = buildSegments(hist, histMidi)
  lastSkipped = breaks
  for (const [i, j] of segs) {
    const v0 = hist[i]!, v1 = hist[j]!
    const y0 = (i + .5) * rH, y1 = (j + .5) * rH
    const x0 = W / 2 + Math.max(-50, Math.min(50, v0)) * ppc, x1 = W / 2 + Math.max(-50, Math.min(50, v1)) * ppc
    c.globalAlpha = .22 + (i / (N - 1)) * .78
    // 트레이스는 항상 흰색 — 초록 선은 초록 띠 위에서 대비가 가장 낮아진다. '선이 띠 안' = '맞음' 이라 정보 손실은 없다
    c.strokeStyle = `rgb(${inkRgb})`
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke()
  }
  c.globalAlpha = 1; c.restore()
}

// 중음(더블스톱) 둘째 성부: 화면은 위 성부, 아래 성부는 이 줄에. 최소 표시 400 ms — 개방현이 문턱을 스쳐도 글자가 번쩍이지 않게
const DUAL_MIN_MS = 400
let dualUntil = 0, dualMidi = -1, dualCents = 0
function renderDual(midi: number, cents: number): boolean {
  const el = q('tuner-dual'), now = performance.now()
  if (midi >= 0) { dualMidi = midi; dualCents = cents; dualUntil = now + DUAL_MIN_MS }
  if (dualMidi < 0 || now >= dualUntil) { if (el.className) { el.className = ''; el.textContent = '' } dualMidi = -1; return true }
  const ok = Math.abs(dualCents) <= settingsStore.get().tolCents
  const { name } = noteLabel(dualMidi, settingsStore.get().noteNames)
  el.textContent = `더블스톱 · ${name}${octaveOf(dualMidi)} ${dualCents > 0 ? '+' : ''}${dualCents} ¢`
  el.className = ok ? 'on tune' : 'on'
  return ok
}
function clearDual(): void { dualUntil = 0; dualMidi = -1; const el = q('tuner-dual'); el.className = ''; el.textContent = '' }

// 음 표시
function renderEmpty(): void {
  const nEl = q('tuner-note')
  // 마이크가 꺼져 있으면 빈 상태 카피, 켜져 있거나 스스로 다시 여는 중(micReopening)이면 '--'
  const s = tunerStore.get(), off = !s.micReady && !s.micReopening && !tapHandler
  nEl.textContent = off ? 'MIC 를 켜면 시작해요' : '--'; nEl.className = off ? 'empty hint' : 'empty'
  q('tuner-oct').textContent = ''; q('tuner-cents').textContent = ''; q('tuner-enharmonic').textContent = ''; q('tuner-acc').textContent = ''
  hzReadout.reset(); q('tuner-hz').textContent = ''
  clearDual()
  q('tuner-card').classList.remove('in-tune')
}
/** inTune = 위 성부가 허용 범위 안(음이름 색), allInTune = 모든 성부가 안(카드 글로우). 단음이면 같다 */
function renderNote(midi: number, cents: number, inTune: boolean, allInTune: boolean, hz: number): void {
  const { name, secondary } = noteLabel(midi, settingsStore.get().noteNames)
  const base = name.replace('♯', ''), acc = name.includes('♯') ? '♯' : ''
  const nEl = q('tuner-note'); nEl.textContent = base; nEl.className = inTune ? 'tune' : ''
  const accEl = q('tuner-acc'); accEl.textContent = acc; accEl.classList.toggle('tune', inTune)
  q('tuner-oct').textContent = String(octaveOf(midi))
  q('tuner-enharmonic').textContent = secondary
  q('tuner-card').classList.toggle('in-tune', allInTune)
  q('tuner-cents').textContent = (cents > 0 ? '+' : '') + cents + ' ¢'
  const t = hzReadout.push(hz, midi, performance.now()); if (t !== null) q('tuner-hz').textContent = t
}

/** 시작 버튼. 카드 어디를 눌러도 onTap. sub 는 버튼 아래 한 줄 안내(없으면 비움). onTap 이 true 면 거둔다 */
export function showTapHint(onTap: () => Promise<boolean>, sub = ''): void {
  const nEl = q('tuner-note'), card = q('tuner-card')
  nEl.textContent = '--'; nEl.className = 'empty'
  q('tuner-start-sub').textContent = sub
  card.classList.add('tap-hint')
  if (tapHandler) card.removeEventListener('click', tapHandler) // 호출마다 리스너가 쌓이지 않게
  const handler = async () => { if (await onTap()) { card.classList.remove('tap-hint'); card.removeEventListener('click', handler); if (tapHandler === handler) tapHandler = null } }
  tapHandler = handler
  card.addEventListener('click', handler)
}

/** 시작 버튼을 거둔다 */
export function hideTapHint(): void {
  const card = q('tuner-card')
  if (tapHandler) { card.removeEventListener('click', tapHandler); tapHandler = null }
  card.classList.remove('tap-hint')
}
export function mountTuner(): void {
  readTokens()
  // 매 분석 프레임(≈43 Hz)마다 히스토리를 쌓고, 그리기는 rAF 에 한 번만
  let dirty = false, raf: number | null = null
  const paint = () => {
    raf = null; if (!dirty) return; dirty = false
    const s = tunerStore.get()
    if (s.hz === -1) { renderEmpty(); drawHistory(false); return }
    const dualOk = renderDual(s.dualMidi, s.dualCents)
    renderNote(s.midi, s.cents, s.inTune, s.inTune && dualOk, s.hz); drawHistory(s.inTune && dualOk)
  }
  tunerStore.select(s => s.sampleRate, sr => resizeHist(sr), { immediate: true })
  // 캔버스 크기가 바뀌면 마이크 프레임이 없어도 다시 그린다 — 안 그리면 옛 크기의 비트맵이 늘어나 ♭♯ 가 길쭉해진다(시작 버튼 화면)
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => drawHistory(lastInTune)).observe(q('tuner-history'))
  tunerStore.select(s => s.frame, () => {
    const s = tunerStore.get()
    // 무엇을 트레이스에 쌓을지는 core/trace.ts 가 정한다
    const off = !keepInTrace(s.hz, s.held)
    hist.push(off ? null : s.cents); hist.shift()
    histMidi.push(off ? null : s.midi); histMidi.shift()
    dirty = true; if (raf == null) raf = requestAnimationFrame(paint)
  })
  // 마이크 꺼짐 → 표시 초기화
  tunerStore.select(s => s.micReady, ready => {
    q('hdr-mic-btn').style.display = ready ? 'none' : 'flex'
    q('rec-hdr-btn').style.opacity = ready ? '1' : '.35'
    if (!ready) renderEmpty()
  })
  // 자동 재개가 실패로 끝나면 그제야 "켜면 시작" — 분석 루프가 안 도니 여기서 직접 그린다
  tunerStore.select(s => s.micReopening, v => { if (!v && !tunerStore.get().micReady) renderEmpty() })
  // 초기 렌더
  setTimeout(() => drawHistory(false), 200)
}
