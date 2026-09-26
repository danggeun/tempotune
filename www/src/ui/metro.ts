/**
 * 메트로놈 카드 UI — BPM 표시/드래그, 박자·세분 버튼, LED 줄, 강박 flash, 접기/펼치기.
 * 접힘은 CSS grid(0fr/1fr) 트랜지션. 폰 레이아웃에서는 사용자가 접었을 때만 접힌다.
 */
import { CFG, metroStore, settingsStore, type SubDiv, type TimeSig } from '../state/index.ts'
import { setBPM, adjBPM, setTimeSig, setSubDiv, setMetroVol, toggleMetro } from '../audio/metronome.ts'
import { tickKind } from '../core/metro/sequencer.ts'
import { isPhoneLayout } from '../platform/index.ts'
import { buildDial, setDialBpm, onDialChange } from './dial.ts'
import { attachVDrag } from './swipeStep.ts'
import { t } from '../core/i18n/index.ts'
import { onLangChange } from './lang.ts'
import { beatDurS, isBeatStart, sweepX, ledIndex, hitIndex } from '../core/metro/sweep.ts'
import { q, qsa, on, reflow } from './dom.ts'
import { toast } from './toast.ts'
import { overlayOpen } from './menu.ts'
import { isEditorOpen } from './editor.ts'

// LED 줄: 칸 수 고정. 불(.mv)이 한 박에 끝→끝으로 쓸고 가며 박마다 방향이 뒤집힌다. 박 시작 틱은 끝 칸, 분할 틱은 그 위치 칸이 탁
const HDR_LEDS = 9, FULL_LEDS = 13
type Row = { leds: HTMLElement[]; n: number }
const rows: Row[] = []
function buildRow(id: string, n: number): Row {
  const wrap = q(id); wrap.innerHTML = ''
  for (let i = 0; i < n; i++) { const d = document.createElement('div'); d.className = 'led'; wrap.appendChild(d) }
  return { leds: Array.from(wrap.querySelectorAll<HTMLElement>('.led')), n }
}
function buildBeatVis(): void {
  rows.length = 0
  rows.push(buildRow('beat-vis', HDR_LEDS))
  if (metroStore.get().full) rows.push(buildRow('sweep-leds', FULL_LEDS))
}
const clearDots = (): void => { rows.forEach(r => r.leds.forEach(d => { d.className = 'led' })) }

let swT0 = 0, swDur = 0, swDir: 1 | -1 = -1, swRaf: number | null = null
function sweepFrame(): void {
  const phase = swDur > 0 ? (performance.now() - swT0) / swDur : 0
  const x = sweepX(phase, swDir)
  for (const r of rows) {
    const i = ledIndex(x, r.n)
    r.leds.forEach((d, k) => d.classList.toggle('mv', k === i))
  }
  swRaf = requestAnimationFrame(sweepFrame)
}
const hitTimers: ReturnType<typeof setTimeout>[] = []
function litBeat(tick: number): void {
  const p = settingsStore.get()
  const beatStart = isBeatStart(p, tick)
  if (beatStart) { swDir = swDir === 1 ? -1 : 1; swDur = beatDurS(p) * 1000; swT0 = performance.now(); if (swRaf == null) swRaf = requestAnimationFrame(sweepFrame) }
  const kind = tickKind(p, tick)
  const cls = kind === 'accent' ? 'hit-acc' : kind === 'beat' ? 'hit-beat' : 'hit-sub'
  for (const r of rows) {
    const i = hitIndex(p, tick, swDir, r.n)
    const d = r.leds[i]; if (!d) continue
    d.classList.remove('hit-acc', 'hit-beat', 'hit-sub'); void d.offsetWidth; d.classList.add(cls)
    const t = setTimeout(() => { d.classList.remove(cls); const k = hitTimers.indexOf(t); if (k >= 0) hitTimers.splice(k, 1) }, kind === 'sub' ? 110 : 160)
    hitTimers.push(t) // 정지 시 한꺼번에 지우려고 — 발화하면 스스로 빠진다
  }
}
// 마디 재시작 시 스윕도 처음으로: −1 이면 다음 박 시작에서 +1 로 뒤집혀 왼쪽 끝부터 쓸고 간다
function sweepResetDir(): void { swDir = -1 }
function sweepStop(): void {
  if (swRaf != null) { cancelAnimationFrame(swRaf); swRaf = null }
  hitTimers.splice(0).forEach(clearTimeout)
  swDur = 0; swDir = -1
  clearDots()
}
// 전용 모드 = 펼침의 2단계 (접힘 → 펼침 → 전용). 튜너 카드만 숨기고(#main-body.metro-full) 헤더·마이크는 펼침과 같다
function applyFull(): void {
  const { full } = metroStore.get()
  const card = q('metro-card'), tuner = q('tuner-card'), wrap = q('metro-body-wrap')
  // 튜너 카드의 display:none 은 애니메이션이 안 되므로 전환 전후 두 카드 높이를 재서 픽셀로 함께 움직인다. 폰 세로 배치에서만
  const anim = isPhoneLayout() && !matchMedia('(prefers-reduced-motion: reduce)').matches
  // 570 ms 안에 또 누르면 이전 인라인 높이가 남아 있다: before 는 지금 보이는 높이, 인라인을 걷어낸 뒤 최종을 잰다
  const hand = handoff; handoff = null // 카드를 끌다 놓았으면 손을 뗀 그 높이에서 이어 간다
  const before = anim ? { t: hand?.t ?? tuner.offsetHeight, m: hand?.m ?? card.offsetHeight, mb: hand?.mb, collapsed: wrap.classList.contains('collapsed') } : null
  if (before) { clearAnim(tuner); clearAnim(card) }
  card.classList.add('no-anim') // 최종 높이를 재려면 본체 접힘 트랜지션이 즉시 끝나 있어야 한다
  q('main-body').classList.toggle('metro-full', full)
  card.classList.toggle('full', full)
  buildBeatVis(); if (!metroStore.get().playing) sweepStop()
  if (full) { buildDial(); setDialBpm(settingsStore.get().bpm) }
  applyCollapse(); syncLayout()
  if (!before) { card.classList.remove('no-anim'); return }
  const after = { t: full ? 0 : tuner.offsetHeight, m: card.offsetHeight }
  // 본체 접힘 트랜지션 되살리기: 이전 값을 인라인으로 되돌리고 no-anim 을 뗀 뒤 지우면 거기서부터 굴러간다
  const nowCollapsed = wrap.classList.contains('collapsed')
  if (nowCollapsed !== before.collapsed) { wrap.style.gridTemplateRows = before.collapsed ? '0fr' : '1fr'; q('metro-body-clip').style.opacity = before.collapsed ? '0' : '1' }
  reflow(card); card.classList.remove('no-anim'); reflow(card)
  wrap.style.gridTemplateRows = ''; q('metro-body-clip').style.opacity = ''
  const gap = '-' + getComputedStyle(q('main-body')).gap // 튜너가 0 이 돼도 카드 사이 gap 은 남는다 → 음수 margin 으로 같이 접는다
  animHeight(tuner, before.t, after.t, full ? [before.mb || '0px', gap] : [before.mb || gap, '0px'], full ? 'flex' : '') // 펼침2로 갈 때 튜너는 CSS 로 display:none — 애니메이션 동안만 이긴다
  animHeight(card, before.m, after.m, ['0px', '0px'])
}
const animTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()
/** 애니메이션 잔재(인라인 높이·margin·display·.h-anim·타이머)를 즉시 걷어낸다 */
function clearAnim(el: HTMLElement): void {
  const t = animTimers.get(el); if (t) { clearTimeout(t); animTimers.delete(el) }
  el.classList.remove('h-anim'); el.style.height = ''; el.style.marginBottom = ''; el.style.display = ''
}
/** 인라인 height 로 from → to. --t-slow(.55s) 뒤 인라인을 지워 flex 가 다시 높이를 정하게 한다.
 *  display 는 clearAnim 뒤에 놓아야 한다 — 먼저 놓으면 clearAnim 이 지워 튜너가 애니메이션 없이 사라지고 카드만 아래에서 커진다 */
function animHeight(el: HTMLElement, from: number, to: number, mb: [string, string], display = ''): void {
  clearAnim(el)
  el.style.display = display
  el.style.height = from + 'px'; el.style.marginBottom = mb[0]; el.classList.add('h-anim')
  reflow(el)
  el.style.height = to + 'px'; el.style.marginBottom = mb[1]
  animTimers.set(el, setTimeout(() => clearAnim(el), 570))
}
let flashTimer: ReturnType<typeof setTimeout> | null = null
function flashBeat(tick: number): void {
  const card = q('metro-card'); card.classList.remove('flash-strong', 'lit-weak')
  // 화면 번쩍임은 접혀서 LED 줄만 보일 때만 — 거기서는 이것이 유일한 원거리 신호
  if (!isCollapsedNow()) return
  if (isPhoneLayout()) {
    const th = q('tuner-hdr'); th.classList.remove('beat-flash', 'beat-flash-weak'); reflow(th)
    th.classList.add(tick === 0 ? 'beat-flash' : 'beat-flash-weak')
  }
  if (tick === 0) { reflow(card); card.classList.add('flash-strong') }
  else { card.classList.add('lit-weak'); if (flashTimer) clearTimeout(flashTimer); flashTimer = setTimeout(() => card.classList.remove('lit-weak'), 100) }
}

function attachDrag(el: HTMLElement): void {
  let sy = 0, sb = 0, sw = false
  on(el, 'mousedown', (e: MouseEvent) => { sw = true; sy = e.clientY; sb = settingsStore.get().bpm; e.preventDefault() })
  on(window, 'mousemove', (e: MouseEvent) => { if (sw) setBPM(sb + Math.round((sy - e.clientY) / CFG.metro.swipePxPerBpm)) })
  on(window, 'mouseup', () => { sw = false })
  on(el, 'touchstart', (e: TouchEvent) => { sw = true; sy = e.touches[0]!.clientY; sb = settingsStore.get().bpm }, { passive: true })
  on(window, 'touchmove', (e: TouchEvent) => { if (sw) setBPM(sb + Math.round((sy - e.touches[0]!.clientY) / CFG.metro.swipePxPerBpm)) }, { passive: true })
  on(window, 'touchend', () => { sw = false }); on(window, 'touchcancel', () => { sw = false }) // OS 가 터치를 끊어도 다음 터치가 옛 기준점으로 튀지 않게
}

/** 지금 실제로 접혀 보이는가 — 넓은 화면·전용 모드에서는 collapsed 값과 무관하게 펼쳐져 있다 */
function isCollapsedNow(): boolean {
  const { collapsed, full } = metroStore.get()
  return isPhoneLayout() && collapsed && !full
}
function applyCollapse(): void {
  const effective = isCollapsedNow()
  q('metro-body-wrap').classList.toggle('collapsed', effective)
  if (effective) clearDots()
}

// 폭에 따라 달라지는 것들. 헤더 재생 버튼은 접혀 있을 때만(재생·정지 둘 다) — 펼쳐져 있으면 본체 버튼과 겹친다
function syncLayout(): void {
  q('metro-play-hdr-btn').style.display = isCollapsedNow() ? 'flex' : 'none'
  applyCollapse()
}

export function mountMetro(): void {
  attachDrag(q('metro-bpm-wrap')); attachDrag(q('metro-hdr-label'))
  on(q('metro-play-hdr-btn'), 'click', () => { const r = toggleMetro(); if (!r.ok) toast(r.error) })
  on(q('metro-play-btn'), 'click', () => { const r = toggleMetro(); if (!r.ok) toast(r.error) })
  // 크기 버튼은 순환(접힘 → 펼침 → 전용 → 접힘). 카드를 위아래로 끌어도 한 단계씩 — 손을 따라온다
  on(q('metro-size-btn'), 'click', sizeUp)
  const ignore = '#metro-hdr-label, #metro-bpm-wrap, #dial, input[type=range], button, .m-seg' // BPM ↕ 드래그 영역도 제외 — 없으면 BPM 내리기가 접힘이 된다
  const drag = { start: dragStart, move: dragMove, end: dragEnd, ignore }
  attachVDrag(q('metro-hdr'), drag)
  attachVDrag(q('metro-body'), drag)
  qsa('.m-adj, .m-adj-pad').forEach(b => on(b, 'click', () => adjBPM(b.textContent === '−' ? -1 : 1)))
  qsa<HTMLElement>('[data-step]').forEach(b => on(b, 'click', () => adjBPM(+b.dataset.step!))) // 전용 모드의 −5·+5
  const volMain = q<HTMLInputElement>('metro-vol'), volPad = q<HTMLInputElement>('metro-vol-pad-input')
  on(volMain, 'input', () => { setMetroVol(+volMain.value); volPad.value = volMain.value })
  on(volPad, 'input', () => { setMetroVol(+volPad.value); volMain.value = volPad.value })
  qsa('[data-ts]').forEach(b => on(b, 'click', () => setTimeSig(+b.dataset.ts! as TimeSig)))
  qsa('[data-sd]').forEach(b => on(b, 'click', () => setSubDiv((b.dataset.sd === 'd' ? 'd' : +b.dataset.sd!) as SubDiv)))
  on(document, 'keydown', (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    // 포커스된 버튼의 Space 는 그 버튼의 것. repeat 는 누르고 있을 때 재생/정지 반복 방지
    if (e.code !== 'Space' || e.repeat || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON') return
    // 메뉴·설정·팝업·편집기가 떠 있으면 Space 는 메트로놈의 것이 아니다
    if (overlayOpen() || isEditorOpen()) return
    e.preventDefault(); const r = toggleMetro(); if (!r.ok) toast(r.error)
  })

  // 상태 → 화면
  settingsStore.select(s => s.bpm, bpm => { q('metro-bpm').textContent = String(bpm); q('metro-hdr-bpm').textContent = String(bpm); setDialBpm(bpm); q('dial').setAttribute('aria-valuenow', String(bpm)) }, { immediate: true })
  onDialChange(setBPM)
  settingsStore.select(s => s.metroVol, v => { volMain.value = String(v); volPad.value = String(v) }, { immediate: true })
  settingsStore.select(s => s.timeSig, ts => {
    sweepResetDir() // 마디가 다시 시작되므로 스윕도 왼쪽부터
    qsa('[data-ts]').forEach(b => b.classList.toggle('on', +b.dataset.ts! === ts))
    const is68 = ts === 6; const sd = q('sd-grid')
    sd.style.opacity = is68 ? '.3' : '1'; sd.style.pointerEvents = is68 ? 'none' : 'auto'
    qsa<HTMLButtonElement>('[data-sd]').forEach(b => { b.disabled = is68 }) // pointer-events 만으로는 키보드(Tab+Enter)가 뚫린다
    q('sd-grid').classList.toggle('compound', is68) // 6/8: 세분 1 을 8분음표로 표시
    buildBeatVis()
  }, { immediate: true })
  settingsStore.select(s => s.subDiv, sd => { sweepResetDir(); qsa('[data-sd]').forEach(b => b.classList.toggle('on', b.dataset.sd === String(sd))); buildBeatVis() }, { immediate: true })

  metroStore.select(s => s.playing, playing => {
    q('metro-play-btn').textContent = q('metro-play-hdr-btn').textContent = playing ? '■' : '▶'
    syncLayout()
    if (playing) buildBeatVis(); else sweepStop()
    applyCollapse()
  })
  // 폭 등급(폰/넓음)이 바뀔 때만 — 안드로이드는 주소창 숨김·키보드에도 resize 를 낸다. 150 ms 디바운스는 회전 중 연속 resize 때문
  let resizeT: ReturnType<typeof setTimeout> | null = null, lastPhone = isPhoneLayout()
  on(window, 'resize', () => {
    if (resizeT) clearTimeout(resizeT)
    resizeT = setTimeout(() => { const phone = isPhoneLayout(); if (phone !== lastPhone) { lastPhone = phone; syncLayout() } }, 150)
  })
  // full 구독을 collapsed 보다 먼저 — sizeUp 이 { full:false, collapsed:true } 를 한 번에 놓고, 구독은 등록 순서대로 돈다
  metroStore.select(s => s.full, () => { applyFull(); syncSizeBtn() })
  metroStore.select(s => s.collapsed, () => { syncSizeBtn(); syncLayout() }) // 헤더 재생 버튼이 접힘에 달려 있다
  metroStore.select(s => s.lastTick, ({ tick }) => { if (!metroStore.get().playing) return; litBeat(tick); flashBeat(tick) })

  // 초기: 본체는 펼친 채 그려지고, 폰이면 250 ms 후 접힘 애니메이션
  if (isPhoneLayout()) setTimeout(() => { syncLayout(); syncSizeBtn() }, 250) // 접히면서 헤더 재생 버튼도 나온다
  syncSizeBtn(); onLangChange(syncSizeBtn)
}

/** 한 단계 위로 (순환): 접힘 → 펼침 → 전용 → 접힘 */
function sizeUp(): void {
  const { collapsed, full } = metroStore.get()
  if (full) metroStore.set({ full: false, collapsed: true })
  else if (collapsed) metroStore.set({ collapsed: false })
  else metroStore.set({ full: true })
}

// ── 카드 끌기: 손가락을 따라 카드 높이가 바뀌고, 놓으면 다음 단계로 넘어가거나 제자리로 돌아간다 (폰 세로 배치) ──
// 위로 끌면 접힘 → 펼침 → 펼침2, 아래로 끌면 반대. 넓은 화면·동작 줄이기에서는 아래로 40 px 밀면 한 단계(예전 방식)
type St = 'c' | 'e' | 'f'
const UP: Record<St, St | null> = { c: 'e', e: 'f', f: null }
const DOWN: Record<St, St | null> = { f: 'e', e: 'c', c: null }
const COMMIT_P = 0.3, COMMIT_VEL = 0.35, STEP_PX = 40
type Drag = { live: boolean; dir: -1 | 1; from: St; to: St; h0: number; h1: number; t0: number; gap: number; p: number }
let drag: Drag | null = null
let handoff: { t: number; m: number; mb: string } | null = null
let wrapTimer: ReturnType<typeof setTimeout> | null = null

function stateNow(): St { const { collapsed, full } = metroStore.get(); return full ? 'f' : collapsed ? 'c' : 'e' }
function go(st: St): void { metroStore.set(st === 'f' ? { full: true } : st === 'e' ? { full: false, collapsed: false } : { collapsed: true }) }
const liveDrag = (): boolean => isPhoneLayout() && !matchMedia('(prefers-reduced-motion: reduce)').matches

/** 상태 st 일 때의 카드 높이 — 클래스를 잠깐 바꿔 재고 되돌린다(그리기 전이라 화면에 안 나온다) */
function measureCard(st: St): number {
  const card = q('metro-card'), wrap = q('metro-body-wrap'), mb = q('main-body')
  const was = { full: card.classList.contains('full'), mf: mb.classList.contains('metro-full'), col: wrap.classList.contains('collapsed'), noAnim: card.classList.contains('no-anim') }
  card.classList.add('no-anim')
  card.classList.toggle('full', st === 'f'); mb.classList.toggle('metro-full', st === 'f'); wrap.classList.toggle('collapsed', st === 'c')
  const h = card.offsetHeight
  card.classList.toggle('full', was.full); mb.classList.toggle('metro-full', was.mf); wrap.classList.toggle('collapsed', was.col)
  reflow(card); if (!was.noAnim) card.classList.remove('no-anim') // 되돌린 값으로 계산을 끝낸 뒤에 트랜지션을 살린다 — 아니면 되돌림이 애니메이션된다
  return h
}
/** 접힘 전환 동안 붙여 둔 본체 인라인을 걷는다 */
function clearWrap(): void {
  if (wrapTimer) { clearTimeout(wrapTimer); wrapTimer = null }
  const card = q('metro-card')
  q('metro-body-wrap').style.gridTemplateRows = ''; q('metro-body-clip').style.opacity = ''
  reflow(card); card.classList.remove('no-anim')
}

function dragStart(dir: -1 | 1): boolean {
  const from = stateNow(), to = dir < 0 ? UP[from] : DOWN[from]
  if (!to) return false
  if (!liveDrag()) { if (dir < 0) return false; drag = { live: false, dir, from, to, h0: 0, h1: 0, t0: 0, gap: 0, p: 0 }; return true }
  const card = q('metro-card'), tuner = q('tuner-card')
  clearAnim(tuner); clearAnim(card); if (wrapTimer) clearWrap() // 이전 전환이 남아 있으면 끝난 상태에서 시작
  const h0 = card.offsetHeight, t0 = tuner.offsetHeight, h1 = measureCard(to)
  const gap = parseFloat(getComputedStyle(q('main-body')).rowGap) || 0
  card.classList.add('dragging'); card.style.height = h0 + 'px'
  if (from === 'c') { q('metro-body-wrap').style.gridTemplateRows = '1fr'; q('metro-body-clip').style.opacity = '1' } // 접힌 본체를 펴 둔다 — 카드가 커지는 만큼 드러난다
  if (from === 'f') { tuner.style.display = 'flex'; tuner.style.marginBottom = -gap + 'px' } // 숨은 튜너를 0 높이로 꺼내 둔다
  drag = { live: true, dir, from, to, h0, h1, t0, gap, p: 0 }
  return true
}
function dragMove(dy: number): void {
  const d = drag; if (!d || !d.live) return
  const h = Math.min(Math.max(d.h0, d.h1), Math.max(Math.min(d.h0, d.h1), d.h0 - dy)) // 카드는 아래에 붙어 있어 손이 위로 가면 커진다
  d.p = (h - d.h0) / ((d.h1 - d.h0) || 1)
  q('metro-card').style.height = h + 'px'
  // 튜너가 0 이 돼도 카드 사이 gap 은 남는다 — 펼침2 쪽으로 간 만큼 음수 margin 으로 접는다
  if (d.from === 'f' || d.to === 'f') q('tuner-card').style.marginBottom = -d.gap * (d.to === 'f' ? d.p : 1 - d.p) + 'px'
}
function dragEnd(dy: number, vy: number): void {
  const d = drag; drag = null; if (!d) return
  if (!d.live) { if (dy * d.dir >= STEP_PX) go(d.to); return }
  const commit = d.p >= COMMIT_P || (vy * d.dir > COMMIT_VEL && d.p > 0.03) // 멀리 끌었거나, 그 방향으로 튕겼거나
  const card = q('metro-card'), tuner = q('tuner-card'), wrap = q('metro-body-wrap'), clip = q('metro-body-clip')
  const cur = card.offsetHeight
  if (d.from === 'f' || d.to === 'f') {
    const tNow = tuner.offsetHeight, mbNow = tuner.style.marginBottom
    card.classList.remove('dragging')
    if (commit) {
      handoff = { t: tNow, m: cur, mb: mbNow }
      card.style.height = ''; tuner.style.display = ''; tuner.style.marginBottom = ''
      go(d.to) // applyFull 이 handoff 에서 이어 간다
    } else {
      animHeight(card, cur, d.h0, ['0px', '0px'])
      animHeight(tuner, tNow, d.from === 'f' ? 0 : d.t0, [mbNow, d.from === 'f' ? -d.gap + 'px' : '0px'], d.from === 'f' ? 'flex' : '')
    }
    return
  }
  // 접힘 ↔ 펼침: 본체 트랜지션은 끄고 카드 높이만 움직인다
  card.classList.add('no-anim'); card.classList.remove('dragging')
  card.style.height = ''; wrap.style.gridTemplateRows = ''; clip.style.opacity = ''
  if (commit) go(d.to)
  const after = card.offsetHeight
  // 접히는 쪽이면 내용은 카드와 함께 잘려 들어간다 — 먼저 사라지면 빈 카드만 줄어든다
  if ((commit ? d.to : d.from) === 'c') { wrap.style.gridTemplateRows = '1fr'; clip.style.opacity = '1' }
  animHeight(card, cur, after, ['0px', '0px'])
  wrapTimer = setTimeout(clearWrap, 560) // animHeight 가 인라인 높이를 지우는 570 ms 보다 먼저
}
/** 버튼 글리프·라벨 = 다음 목적지 */
function syncSizeBtn(): void {
  const { collapsed, full } = metroStore.get(), btn = q('metro-size-btn')
  const toExpand = !full && collapsed, toFull = !full && !collapsed
  btn.classList.toggle('to-expand', toExpand)
  btn.classList.toggle('to-full', toFull)
  btn.setAttribute('aria-label', t(toExpand ? 'metro.expand' : toFull ? 'metro.expandMore' : 'metro.collapse'))
}
