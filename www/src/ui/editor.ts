/**
 * 녹음 편집 페이지 — 재생/시크, 속도, A-B 구간·반복, 북마크, A-B WAV 저장.
 * Phase 4: 북마크·A-B 는 녹음과 함께 IndexedDB 에 저장되고(다시 열면 그대로), 트랙에 파형이 그려진다.
 * 파형은 디자인 언어 안에서: 모노톤(--border/--muted), A-B 구간만 빨강 틴트. 파형 피크는 처음 열 때 계산해 저장한다.
 */
import { fmtT } from '../core/format.ts'
import { bufToWav } from '../core/wav.ts'
import { computePeaks } from '../core/peaks.ts'
import { recListStore, type RecItem } from '../state/index.ts'
import { patchRec, recFileName } from '../audio/recorder.ts'
import { saveFile } from '../platform/index.ts'
import { q, on } from './dom.ts'
import { toast } from './toast.ts'
import { hideMenu, showMenuInstant } from './menu.ts'

interface EdState {
  idx: number; item: RecItem | null; audio: HTMLAudioElement | null
  ptA: number | null; ptB: number | null; looping: boolean; bookmarks: number[]
  dragging: 'pos' | 'a' | 'b' | null
  readyTimeout: ReturnType<typeof setTimeout> | null
  handlers: { mm: (e: MouseEvent) => void; mu: () => void; tm: (e: TouchEvent) => void; te: () => void } | null
}
const ed: EdState = { idx: -1, item: null, audio: null, ptA: null, ptB: null, looping: false, bookmarks: [], dragging: null, readyTimeout: null, handlers: null }

const pct = (t: number, d: number) => (t / d * 100).toFixed(3) + '%'
// Chromium 은 MediaRecorder webm 의 duration 을 끝까지 seek 하기 전까지 Infinity 로 보고한다(crbug 642012).
// 그러면 A-B/북마크/진행바가 전부 멈추므로 녹음 시 잰 길이(item.dur)로 폴백한다. 정확한 길이는 loadedmetadata 에서 seek 트릭으로 얻는다.
const dur = () => (ed.audio && isFinite(ed.audio.duration) && ed.audio.duration > 0) ? ed.audio.duration : (ed.item?.dur ?? 0)

function setPosUI(t: number): void {
  const d = dur(); if (!d) return
  q('ed-pos-handle').style.left = pct(t, d); q('ed-progress').style.width = pct(t, d); q('ed-cur').textContent = fmtT(t)
  requestWave()
}
function onTimeUpdate(): void {
  if (ed.dragging || !ed.audio) return
  const d = dur(); if (!d) return
  setPosUI(ed.audio.currentTime)
}
// A-B 반복은 timeupdate(≈4 Hz, 최대 250 ms 늦음)가 아니라 rAF 로 검사 — 다음 마디 첫 음이 새어 들리지 않게
let loopRaf: number | null = null
function loopTick(): void {
  loopRaf = null; const a = ed.audio; if (!a || a.paused) return
  if (ed.looping && ed.ptA !== null && ed.ptB !== null && a.currentTime >= ed.ptB - 0.02) a.currentTime = ed.ptA
  loopRaf = requestAnimationFrame(loopTick)
}
function startLoopWatch(): void { if (loopRaf == null) loopRaf = requestAnimationFrame(loopTick) }
function pctFromClient(clientX: number): number { const r = q('ed-track').getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) }

function updateHandles(): void {
  const d = dur(); if (!d) return
  if (ed.ptA !== null) {
    const aH = q('ed-a-handle'); aH.style.display = 'block'; aH.style.left = pct(ed.ptA, d)
    q('ed-ab-times').style.display = 'flex'; q('ed-a-time').textContent = 'A ' + fmtT(ed.ptA)
  }
  if (ed.ptB !== null) { const bH = q('ed-b-handle'); bH.style.display = 'block'; bH.style.left = pct(ed.ptB, d); q('ed-b-time').textContent = 'B ' + fmtT(ed.ptB) }
  if (ed.ptA !== null && ed.ptB !== null) { const r = q('ed-ab-range'); r.style.display = 'block'; r.style.left = pct(ed.ptA, d); r.style.width = ((ed.ptB - ed.ptA) / d * 100).toFixed(3) + '%' }
  requestWave()
}
// A/B/반복 버튼 표시 (v1 인라인 스타일 그대로)
const abBtn = (id: string, active: boolean, label: string, dim = false) => {
  const btn = q(id); btn.style.borderColor = active ? 'var(--red)' : ''; btn.style.color = active ? 'var(--red)' : 'var(--muted)'
  if (dim) btn.style.opacity = '0.4'
  btn.querySelector('span')!.textContent = label
}
const updateABtn = () => abBtn('ed-a-btn', true, fmtT(ed.ptA!))
const updateBBtn = () => abBtn('ed-b-btn', true, fmtT(ed.ptB!))
const resetABtn = () => abBtn('ed-a-btn', false, '설정')
const resetBBtn = () => abBtn('ed-b-btn', false, '설정', true)
const resetLoopBtn = () => abBtn('ed-loop-btn', false, '꺼짐', true)
/** A/B 지점을 ±0.25 s 미세 조정 (재생 중 찍으면 반응 지연만큼 늦는 것을 손가락 드래그 없이 보정) */
function nudge(which: 'a' | 'b', d: number): void {
  const len = dur(); if (!len) return
  if (which === 'a' && ed.ptA !== null) ed.ptA = Math.max(0, Math.min(ed.ptB !== null ? ed.ptB - 0.1 : len, ed.ptA + d))
  if (which === 'b' && ed.ptB !== null) ed.ptB = Math.max(ed.ptA !== null ? ed.ptA + 0.1 : 0, Math.min(len, ed.ptB + d))
  updateHandles(); if (ed.ptA !== null) updateABtn(); if (ed.ptB !== null) updateBBtn(); persistEdit()
}
function checkExportBtn(): void { q('ed-export-btn').style.color = ed.ptA !== null && ed.ptB !== null ? 'var(--text)' : 'var(--dim)' }

/** 편집 상태(북마크/A-B)를 녹음 항목에 저장 — 다시 열어도 그대로 */
function persistEdit(): void {
  if (!ed.item) return
  const next = patchRec(ed.item, { bookmarks: ed.bookmarks.slice(), ab: ed.ptA !== null && ed.ptB !== null ? { a: ed.ptA, b: ed.ptB } : null })
  if (next) ed.item = next
}

// ── 파형 ──
let peaks: Float32Array | null = null
let waveDirty = false, waveRaf: number | null = null
function requestWave(): void { waveDirty = true; if (waveRaf == null) waveRaf = requestAnimationFrame(drawWave) }
function drawWave(): void {
  waveRaf = null; if (!waveDirty) return; waveDirty = false
  const canvas = q<HTMLCanvasElement>('ed-wave'), rail = q('ed-track-rail'), prog = q('ed-progress')
  if (!peaks) { canvas.style.display = 'none'; rail.style.display = ''; prog.style.display = ''; return }
  canvas.style.display = 'block'; rail.style.display = 'none'; prog.style.display = 'none'
  const W = canvas.offsetWidth, H = canvas.offsetHeight, dpr = devicePixelRatio || 1
  if (!W || !H) return
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr) }
  const c = canvas.getContext('2d')!; c.save(); c.scale(dpr, dpr); c.clearRect(0, 0, W, H)
  const cs = getComputedStyle(document.documentElement)
  const colUnplayed = cs.getPropertyValue('--border').trim() || '#d4d7dc', colPlayed = cs.getPropertyValue('--muted').trim() || '#555'
  const d = dur(), pos = ed.audio && d ? ed.audio.currentTime / d : 0
  const mid = H / 2, amp = (H / 2) * 0.92
  const dark = matchMedia('(prefers-color-scheme:dark)').matches
  // A-B 구간 틴트 (파형 뒤) — 다크에서는 더 진하게 (리뷰: .12 는 다크에서 안 보임)
  if (ed.ptA !== null && ed.ptB !== null && d) { c.fillStyle = dark ? 'rgba(229,48,48,.22)' : 'rgba(229,48,48,.12)'; c.fillRect(ed.ptA / d * W, 0, (ed.ptB - ed.ptA) / d * W, H) }
  // 2 px 컬럼으로 리샘플(600 bin 을 340 px 에 그리면 겹쳐서 덩어리가 된다), pow(.6) 으로 조용한 부분도 보이게
  const colW = 2, cols = Math.floor(W / colW), n = peaks.length
  for (let k = 0; k < cols; k++) {
    let m = 0; const i0 = Math.floor(k * n / cols), i1 = Math.max(i0 + 1, Math.floor((k + 1) * n / cols))
    for (let i = i0; i < i1; i++) if (peaks[i]! > m) m = peaks[i]!
    const h = Math.max(1, Math.pow(m, 0.6) * amp)
    c.fillStyle = (k + 0.5) / cols <= pos ? colPlayed : colUnplayed
    c.fillRect(k * colW, mid - h, colW - 0.5, h * 2)
  }
  c.restore()
}
/** 피크가 없으면 blob 을 디코드해 계산하고 저장 (한 번만) */
/** 녹음 중 누적한 피크가 없는 항목(구버전)만 디코드해 계산 — 긴 녹음(10분+)은 메모리를 많이 써서 12분 이상은 건너뛴다 */
async function ensurePeaks(item: RecItem): Promise<void> {
  if (item.peaks && item.peaks.length) { peaks = item.peaks; requestWave(); return }
  peaks = null; requestWave()
  if (item.dur > 12 * 60) return
  try {
    const buf = await (await fetch(item.url)).arrayBuffer()
    const ac = new OfflineAudioContext(1, 1, 48000); const decoded = await ac.decodeAudioData(buf)
    const p = computePeaks(Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i)), 600)
    if (ed.item !== item) return // 그 사이 다른 항목을 열었음
    peaks = p; const next = patchRec(item, { peaks: p }); if (next) ed.item = next; requestWave()
  } catch { /* 디코드 실패 → 레일 유지 */ }
}

function removeWindowHandlers(): void {
  if (!ed.handlers) return
  window.removeEventListener('mousemove', ed.handlers.mm); window.removeEventListener('mouseup', ed.handlers.mu)
  window.removeEventListener('touchmove', ed.handlers.tm); window.removeEventListener('touchend', ed.handlers.te)
  ed.handlers = null
}
function initDrag(): void {
  removeWindowHandlers()
  const move = (clientX: number) => {
    const d = dur(); if (!ed.dragging || !ed.audio || !d) return
    const t = pctFromClient(clientX) * d
    if (ed.dragging === 'pos') { const c = Math.max(0, Math.min(d, t)); ed.audio.currentTime = c; setPosUI(c) }
    else if (ed.dragging === 'a') { ed.ptA = Math.max(0, Math.min(ed.ptB !== null ? ed.ptB - 0.1 : d, t)); updateHandles(); updateABtn(); checkExportBtn() }
    else if (ed.dragging === 'b') { ed.ptB = Math.max(ed.ptA !== null ? ed.ptA + 0.1 : 0, Math.min(d, t)); updateHandles(); updateBBtn(); checkExportBtn() }
  }
  const end = () => { const was = ed.dragging; ed.dragging = null; if (ed.audio && dur()) setPosUI(ed.audio.currentTime); if (was === 'a' || was === 'b') persistEdit() }
  ed.handlers = { mm: e => move(e.clientX), mu: end, tm: e => { if (ed.dragging) move(e.touches[0]!.clientX) }, te: end }
  window.addEventListener('mousemove', ed.handlers.mm); window.addEventListener('mouseup', ed.handlers.mu)
  window.addEventListener('touchmove', ed.handlers.tm, { passive: true }); window.addEventListener('touchend', ed.handlers.te)
}

export function openEditor(item: RecItem): void {
  hideMenu()
  if (!recListStore.get().items.includes(item)) return
  if (ed.audio) { ed.audio.pause(); ed.audio = null }
  ed.idx = 0; ed.item = item; ed.ptA = null; ed.ptB = null; ed.looping = false; ed.bookmarks = item.bookmarks.slice(); ed.dragging = null

  const audio = new Audio(item.url); audio.preservesPitch = true; audio.playbackRate = 1.0; audio.preload = 'auto'
  ed.audio = audio
  const updateDur = () => { q('ed-dur').textContent = fmtT(isFinite(audio.duration) && audio.duration > 0 ? Math.max(item.dur || 0, Math.round(audio.duration)) : (item.dur || 0)) }
  // webm duration=Infinity 트릭: 끝으로 seek 하면 durationchange 로 실제 길이가 온다
  let fixing = false
  audio.addEventListener('loadedmetadata', () => { if (audio.duration === Infinity && !fixing) { fixing = true; audio.currentTime = 1e101; audio.addEventListener('durationchange', () => { if (fixing && isFinite(audio.duration)) { fixing = false; audio.currentTime = 0 } }) } })
  audio.addEventListener('loadedmetadata', updateDur); audio.addEventListener('durationchange', updateDur)
  // 저장된 A-B/북마크는 길이를 알아야 그릴 수 있다 — 첫 loadedmetadata 에서 복원
  let restored = false
  const restore = () => {
    if (restored || !dur() || ed.audio !== audio) return; restored = true
    if (item.ab && item.ab.b > item.ab.a) { ed.ptA = item.ab.a; ed.ptB = Math.min(item.ab.b, dur()); updateHandles(); updateABtn(); updateBBtn(); q('ed-b-btn').style.opacity = '1'; q('ed-loop-btn').style.opacity = '1'; checkExportBtn() }
    renderBmTicks(); renderBmList()
  }
  audio.addEventListener('loadedmetadata', restore); audio.addEventListener('durationchange', restore)
  if (audio.readyState >= 1 && dur()) { updateDur(); restore() }
  const playBtn = q<HTMLButtonElement>('ed-play-btn')
  const ready = () => { playBtn.textContent = '▶'; playBtn.style.opacity = '1'; playBtn.disabled = false; if (ed.readyTimeout) clearTimeout(ed.readyTimeout) }
  ed.readyTimeout = setTimeout(ready, 3000)
  audio.addEventListener('canplaythrough', ready, { once: true })
  audio.addEventListener('timeupdate', onTimeUpdate)
  audio.addEventListener('play', startLoopWatch)
  audio.addEventListener('ended', () => {
    playBtn.textContent = '▶'
    if (ed.looping && ed.ptA !== null && ed.ptB !== null) { audio.currentTime = ed.ptA; audio.play(); playBtn.textContent = '■' }
  })
  audio.load()

  q('editor-title-display').textContent = item.name
  q('ed-cur').textContent = '00:00'; q('ed-dur').textContent = item.dur ? fmtT(item.dur) : '--:--'
  playBtn.textContent = '▶'; playBtn.style.opacity = '.4'; playBtn.disabled = true
  if (audio.readyState >= 3) { playBtn.style.opacity = '1'; playBtn.disabled = false }
  q<HTMLInputElement>('ed-speed').value = '1.0'; q('ed-speed-val').textContent = '1.0×'
  q('ed-progress').style.width = '0%'; q('ed-pos-handle').style.left = '0%'
  for (const id of ['ed-ab-range', 'ed-a-handle', 'ed-b-handle', 'ed-ab-times']) q(id).style.display = 'none'
  q('ed-bm-ticks').innerHTML = ''
  renderBmList()
  resetABtn(); resetBBtn(); resetLoopBtn()
  void ensurePeaks(item)
  const ex = q('ed-export-btn'); ex.style.color = 'var(--dim)'; ex.style.borderColor = 'var(--border)'
  q('editor-page').style.display = 'flex'
  initDrag()
}

export function closeEditor(): void {
  if (ed.audio) { ed.audio.pause(); ed.audio = null }
  if (loopRaf != null) { cancelAnimationFrame(loopRaf); loopRaf = null }
  peaks = null; ed.idx = -1; ed.item = null
  if (ed.readyTimeout) clearTimeout(ed.readyTimeout)
  removeWindowHandlers()
  showMenuInstant()
  q('editor-page').style.display = 'none'
}
/** 삭제되는 항목을 편집 중이면 닫는다 */
export function closeEditorIfEditing(item: RecItem): void { if (ed.item === item) closeEditor() }

function editTitle(): void {
  const current = ed.item ? ed.item.name : ''
  const newName = prompt('파일 이름 수정', current)
  if (newName && newName.trim() && ed.item) {
    const name = newName.trim()
    const next = patchRec(ed.item, { name }); if (next) ed.item = next // IndexedDB(meta) 에도 저장
    q('editor-title-display').textContent = name
  }
}

function togglePlay(): void {
  if (!ed.audio) return
  const btn = q('ed-play-btn'), a = ed.audio
  if (a.paused) {
    if (ed.ptA !== null && a.currentTime < ed.ptA) a.currentTime = ed.ptA
    btn.textContent = '■'
    const tryPlay = () => { if (ed.audio !== a) return /* 편집기가 닫힌 뒤 canplay 가 와도 재생하지 않음 */; const p = a.play(); if (p && p.catch) p.catch(() => { setTimeout(() => { if (ed.audio && ed.audio.paused) { const p2 = ed.audio.play(); if (p2 && p2.catch) p2.catch(() => { btn.textContent = '▶' }) } }, 50) }) }
    if (a.readyState < 2) a.addEventListener('canplay', tryPlay, { once: true }); else tryPlay()
  } else { a.pause(); btn.textContent = '▶' }
}
function setSpeed(v: number): void {
  q('ed-speed-val').textContent = (Number.isInteger(v * 10) ? v.toFixed(1) : v.toFixed(2)) + '×'
  if (ed.audio) { ed.audio.playbackRate = v; ed.audio.preservesPitch = true }
}
function toggleA(): void {
  if (ed.ptA !== null) {
    ed.ptA = null; ed.ptB = null; ed.looping = false
    for (const id of ['ed-a-handle', 'ed-b-handle', 'ed-ab-range', 'ed-ab-times']) q(id).style.display = 'none'
    resetABtn(); resetBBtn(); resetLoopBtn(); checkExportBtn(); persistEdit(); requestWave()
  } else {
    if (!dur()) return
    ed.ptA = ed.audio!.currentTime; updateHandles(); updateABtn(); q('ed-b-btn').style.opacity = '1'; checkExportBtn()
  }
}
function toggleB(): void {
  if (ed.ptA === null) { toast('먼저 A 지점을 설정해주세요'); return }
  if (ed.ptB !== null) {
    ed.ptB = null; ed.looping = false
    q('ed-b-handle').style.display = 'none'; q('ed-ab-range').style.display = 'none'; q('ed-b-time').textContent = 'B —'
    resetBBtn(); resetLoopBtn(); checkExportBtn(); persistEdit(); requestWave()
  } else {
    if (!dur()) return
    const t = ed.audio!.currentTime; if (t <= ed.ptA) { toast('B는 A보다 뒤여야 해요'); return }
    ed.ptB = t; updateHandles(); updateBBtn(); q('ed-loop-btn').style.opacity = '1'; checkExportBtn(); persistEdit()
  }
}
function toggleLoop(): void {
  if (ed.ptA === null || ed.ptB === null) { toast('A, B 지점을 먼저 설정해주세요'); return }
  ed.looping = !ed.looping
  const btn = q('ed-loop-btn')
  if (ed.looping) {
    btn.style.borderColor = 'var(--red)'; btn.style.color = 'var(--red)'; btn.querySelector('span')!.textContent = '켜짐'
    ed.audio!.currentTime = ed.ptA
    if (ed.audio!.paused) { ed.audio!.play(); q('ed-play-btn').textContent = '■' }
  } else { btn.style.borderColor = 'var(--border)'; btn.style.color = 'var(--muted)'; btn.querySelector('span')!.textContent = '꺼짐' }
}

function renderBmTicks(): void {
  const wrap = q('ed-bm-ticks'); wrap.innerHTML = ''; const d = dur(); if (!d) return
  for (const t of ed.bookmarks) {
    const tick = document.createElement('div')
    tick.style.cssText = `position:absolute;top:50%;left:${pct(t, d)};width:2px;height:22px;background:#f59e0b;border-radius:1px;transform:translate(-50%,-50%);z-index:2;pointer-events:none;`
    wrap.appendChild(tick)
  }
}
function renderBmList(): void {
  const wrap = q('ed-bookmarks'); wrap.innerHTML = ''
  if (ed.bookmarks.length === 0) { wrap.innerHTML = '<span id="ed-bm-empty">재생 중 추가 버튼을 누르면 현재 위치가 저장돼요</span>'; return }
  ed.bookmarks.forEach((t, i) => {
    const pill = document.createElement('div')
    pill.style.cssText = 'display:flex;align-items:center;gap:0;background:var(--surface);border:1.5px solid #f59e0b66;border-radius:8px;overflow:hidden;cursor:pointer;'
    const lbl = document.createElement('button'); lbl.textContent = fmtT(t)
    lbl.style.cssText = "background:none;border:none;padding:6px 10px;font-family:'DM Mono',monospace;font-size:12px;color:#f59e0b;font-weight:700;cursor:pointer;"
    lbl.onclick = () => { if (ed.audio) ed.audio.currentTime = t }
    const del = document.createElement('button'); del.textContent = '✕'
    del.style.cssText = 'background:none;border:none;border-left:1px solid #f59e0b33;color:#888;font-size:11px;cursor:pointer;padding:6px 8px;line-height:1;'
    del.onclick = e => { e.stopPropagation(); ed.bookmarks.splice(i, 1); renderBmTicks(); renderBmList(); persistEdit() }
    pill.appendChild(lbl); pill.appendChild(del); wrap.appendChild(pill)
  })
}
function addBookmark(): void {
  if (!dur()) return
  const t = ed.audio!.currentTime
  if (ed.bookmarks.some(b => Math.abs(b - t) < 0.3)) { toast('이미 근처에 북마크가 있어요'); return }
  ed.bookmarks.push(t); ed.bookmarks.sort((a, b) => a - b); renderBmTicks(); renderBmList(); persistEdit()
}

async function exportAB(): Promise<void> {
  if (ed.ptA === null || ed.ptB === null || !ed.item) { toast('A, B 지점을 먼저 설정해주세요'); return }
  try {
    const arrayBuf = await (await fetch(ed.item.url)).arrayBuffer()
    const tmpAC = new AudioContext(); const decoded = await tmpAC.decodeAudioData(arrayBuf); await tmpAC.close()
    const sr = decoded.sampleRate, ch = decoded.numberOfChannels
    const s0 = Math.floor(ed.ptA * sr), s1 = Math.floor(ed.ptB * sr), len = s1 - s0
    if (len <= 0) { toast('구간이 너무 짧아요'); return }
    const offAC = new OfflineAudioContext(ch, len, sr); const buf = offAC.createBuffer(ch, len, sr)
    for (let c = 0; c < ch; c++) buf.copyToChannel(decoded.getChannelData(c).slice(s0, s1), c)
    const src = offAC.createBufferSource(); src.buffer = buf; src.connect(offAC.destination); src.start()
    const rendered = await offAC.startRendering()
    const blob = new Blob([bufToWav(rendered)], { type: 'audio/wav' })
    const r = await saveFile(blob, 'gopractice_' + ed.item.name + '_cut.wav')
    if (!r.ok) toast('저장 실패: ' + r.error)
  } catch (e) { toast('저장 실패: ' + (e instanceof Error ? e.message : String(e))) }
}
async function downloadWhole(): Promise<void> {
  if (!ed.item) return
  const r = await saveFile(ed.item.blob, recFileName(ed.item)); if (!r.ok) toast('저장 실패: ' + r.error)
}

export function mountEditor(): void {
  const track = q('ed-track')
  on(track, 'click', (e: MouseEvent) => {
    if (ed.dragging || (e.target as HTMLElement).closest('#ed-pos-handle,#ed-a-handle,#ed-b-handle')) return
    const d = dur(); if (!d) return
    const t = pctFromClient(e.clientX) * d; ed.audio!.currentTime = t; setPosUI(t)
  })
  const start = (which: EdState['dragging']) => (e: Event) => { e.stopPropagation(); ed.dragging = which }
  for (const [id, w] of [['ed-pos-handle', 'pos'], ['ed-a-handle', 'a'], ['ed-b-handle', 'b']] as const) {
    on(q(id), 'mousedown', start(w)); on(q(id), 'touchstart', start(w), { passive: true })
  }
  on(q('ed-back-btn'), 'click', closeEditor)
  on(q('ed-title-edit'), 'click', editTitle)
  on(q('ed-play-btn'), 'click', togglePlay)
  on(q('ed-speed'), 'input', (e: Event) => setSpeed(+(e.target as HTMLInputElement).value))
  on(q('ed-a-btn'), 'click', toggleA); on(q('ed-b-btn'), 'click', toggleB); on(q('ed-loop-btn'), 'click', toggleLoop)
  on(q('ed-bm-add-btn'), 'click', addBookmark); on(q('ed-export-btn'), 'click', exportAB)
  on(q('ed-dl-btn'), 'click', (e: Event) => { e.preventDefault(); void downloadWhole() })
  on(q('ed-a-nudge-l'), 'click', () => nudge('a', -0.25)); on(q('ed-a-nudge-r'), 'click', () => nudge('a', 0.25))
  on(q('ed-b-nudge-l'), 'click', () => nudge('b', -0.25)); on(q('ed-b-nudge-r'), 'click', () => nudge('b', 0.25))
  on(q('ed-a-time'), 'click', () => { if (ed.audio && ed.ptA !== null) { ed.audio.currentTime = ed.ptA; setPosUI(ed.ptA) } }) // A 로 돌아가기
  on(q('ed-b-time'), 'click', () => { if (ed.audio && ed.ptB !== null) { ed.audio.currentTime = ed.ptB; setPosUI(ed.ptB) } })
  new ResizeObserver(requestWave).observe(q('ed-track'))
}
