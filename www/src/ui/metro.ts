/**
 * 메트로놈 카드 UI — BPM 표시/드래그, 박자·세분 버튼, LED 줄, 강박 flash, 접기/펼치기.
 * 접힘은 CSS grid(0fr/1fr) 트랜지션. 폰 레이아웃에서는 사용자가 접었을 때만 접힌다.
 */
import { CFG, metroStore, settingsStore, type SubDiv, type TimeSig } from '../state/index.ts'
import { setBPM, adjBPM, setTimeSig, setSubDiv, setMetroVol, toggleMetro } from '../audio/metronome.ts'
import { tickKind } from '../core/metro/sequencer.ts'
import { isPhoneLayout } from '../platform/index.ts'
import { buildDial, setDialBpm, onDialChange } from './dial.ts'
import { attachSwipeStep } from './swipeStep.ts'
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
  const before = anim ? { t: tuner.offsetHeight, m: card.offsetHeight, collapsed: wrap.classList.contains('collapsed') } : null
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
  animHeight(tuner, before.t, after.t, full ? ['0px', gap] : [gap, '0px'], full ? 'flex' : '') // 펼침2로 갈 때 튜너는 CSS 로 display:none — 애니메이션 동안만 이긴다
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
  const { playing } = metroStore.get()
  const effective = isCollapsedNow()
  q('metro-body-wrap').classList.toggle('collapsed', effective)
  q('metro-card').classList.toggle('bar', effective && playing) // 접힌 채 재생: 헤더 점을 키워 원거리에서 박이 보이게
  if (effective) clearDots()
}

// 폭에 따라 달라지는 것들. 헤더 재생 버튼은 '접힌 채 재생 중' 일 때만 — 펼쳐져 있으면 본체 버튼과 겹친다
function syncLayout(): void {
  const { playing, collapsed } = metroStore.get()
  q('metro-play-hdr-btn').style.display = isPhoneLayout() && playing && collapsed && !metroStore.get().full ? 'flex' : 'none' // 전용 모드는 본체 버튼이 보인다
  applyCollapse()
}

export function mountMetro(): void {
  attachDrag(q('metro-bpm-wrap')); attachDrag(q('metro-hdr-label'))
  on(q('metro-play-hdr-btn'), 'click', () => { const r = toggleMetro(); if (!r.ok) toast(r.error) })
  on(q('metro-play-btn'), 'click', () => { const r = toggleMetro(); if (!r.ok) toast(r.error) })
  // 크기 버튼은 순환(접힘 → 펼침 → 전용 → 접힘), 내려가는 길은 카드를 아래로 미는 스와이프
  on(q('metro-size-btn'), 'click', sizeUp)
  const ignore = '#metro-hdr-label, #metro-bpm-wrap, #dial, input[type=range], button, .m-seg' // BPM ↕ 드래그 영역도 제외 — 없으면 BPM 내리기가 접힘이 된다
  attachSwipeStep(q('metro-hdr'), { onStep: sizeDown, ignore })
  attachSwipeStep(q('metro-body'), { onStep: sizeDown, ignore })
  qsa('.m-adj, .m-adj-pad').forEach(b => on(b, 'click', () => adjBPM(b.textContent === '−' ? -1 : 1)))
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
    const btn = q('metro-play-btn')
    btn.textContent = playing ? '■' : '▶'
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
  if (isPhoneLayout()) setTimeout(() => { applyCollapse(); syncSizeBtn() }, 250)
  syncSizeBtn()
}

/** 한 단계 위로 (순환): 접힘 → 펼침 → 전용 → 접힘 */
function sizeUp(): void {
  const { collapsed, full } = metroStore.get()
  if (full) metroStore.set({ full: false, collapsed: true })
  else if (collapsed) metroStore.set({ collapsed: false })
  else metroStore.set({ full: true })
}
/** 한 단계 아래로 (스와이프): 전용 → 펼침 → 접힘 */
function sizeDown(): void {
  const { collapsed, full } = metroStore.get()
  if (full) metroStore.set({ full: false, collapsed: false })
  else if (!collapsed) metroStore.set({ collapsed: true })
}
/** 버튼 글리프·라벨 = 다음 목적지 */
function syncSizeBtn(): void {
  const { collapsed, full } = metroStore.get(), btn = q('metro-size-btn')
  const toExpand = !full && collapsed, toFull = !full && !collapsed
  btn.classList.toggle('to-expand', toExpand)
  btn.classList.toggle('to-full', toFull)
  btn.setAttribute('aria-label', toExpand ? '메트로놈 펼치기' : toFull ? '메트로놈 더 펼치기' : '메트로놈 접기')
}
