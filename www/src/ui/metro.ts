/**
 * 메트로놈 카드 UI — BPM 표시/드래그, 박자·세분 버튼, 비트 점, 강박 flash, 접기/펼치기.
 * 접힘은 CSS grid(0fr/1fr) 트랜지션 — v1의 maxHeight 측정 코드는 제거(설계서 §C3).
 * 표시 규칙(U1 이후): 폰 레이아웃에서는 **사용자가 접었을 때만** 접힌다. 재생은 접힘에 관여하지 않는다.
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

/**
 * 세이코식 LED 줄 (K5). 헤더(#beat-vis, 9칸)와 전용 모드(#sweep-leds, 13칸)가 같은 방식이다.
 *   · 칸 수는 고정 — 전에는 틱 수만큼 점을 만들어 4/4·3분할이면 12개가 되어 폰에서 넘쳤다
 *   · 불(.mv)이 한 박에 끝→끝으로 쓸고 간다. 박이 **실제로 도착한 시각**(lastTick)에서 출발 — 소리와 어긋나면 안 된다
 *   · 박 시작 틱 = 끝 칸이 초록으로 탁(.hit-beat, 첫 박은 .hit-acc), 분할 틱 = 그 위치 칸이 액센트색으로 탁(.hit-sub)
 *   · 방향은 박마다 뒤집힌다. 몇 번째 박인지는 따로 표시하지 않는다 — 첫 박이 더 크게(초록) 치는 것으로 마디 시작은 구분된다(v2.3.0, 점 줄 제거)
 */
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
    hitTimers.push(t) // 정지 시 한꺼번에 지우려고 들고 있다 — 발화하면 스스로 빠지므로 오래 재생해도 안 자란다
  }
}
/**
 * 마디를 다시 시작할 때 스윕도 처음으로 (v2.3.2 M12).
 * 박자표·세분을 바꾸면 audio/metronome.ts 가 restartBar() 로 마디를 0 틱부터 다시 시작하는데, 화면의 방향(swDir)은
 * 그대로라 **바꾸는 순간의 방향에 따라 새 첫 박이 왼쪽에도 오른쪽에도** 갔다. 정지 후 새로 시작할 때와 같은 기준으로 맞춘다:
 * −1 로 두면 다음 박 시작에서 +1 로 뒤집혀 **왼쪽 끝**부터 쓸고 간다.
 */
function sweepResetDir(): void { swDir = -1 }
function sweepStop(): void {
  if (swRaf != null) { cancelAnimationFrame(swRaf); swRaf = null }
  hitTimers.splice(0).forEach(clearTimeout)
  swDur = 0; swDir = -1
  clearDots()
}
// ── 메트로놈 전용 모드 (K10) ──
// 3단계: 접힘 → 펼침 → 전용. 전용에서는 튜너 카드를 숨기고(#main-body.metro-full) 메트로놈이 화면을 다 쓴다.
// 마이크 해제·복귀는 main.ts 가 #metro-card.full 을 보고 한다 (편집기와 같은 패턴).
function applyFull(): void {
  const { full } = metroStore.get()
  q('main-body').classList.toggle('metro-full', full)
  q('app').classList.toggle('metro-full', full) // 헤더의 MIC 버튼을 숨긴다 — 튜너가 없는 화면에서 마이크를 켜라고 할 이유가 없다
  q('metro-card').classList.toggle('full', full)
  buildBeatVis(); if (!metroStore.get().playing) sweepStop()
  if (full) { buildDial(); setDialBpm(settingsStore.get().bpm) }
  applyCollapse(); syncLayout()
}
let flashTimer: ReturnType<typeof setTimeout> | null = null
function flashBeat(tick: number): void {
  const card = q('metro-card'); card.classList.remove('flash-strong', 'lit-weak')
  // 화면을 칠해서 박을 알리는 건 **접혀서 LED 줄만 보일 때**뿐이다 (v2.3.1 L6-a → v2.3.2 M9).
  // 펼침·전용에서는 세이코식 LED 줄이 이미 박을 또렷이 말하고, 카드가 크니 28 % 빨강이 화면을 덮어 자극만 더한다.
  // 접힘은 카드가 화면 맨 아래 띠 하나라, 거기서는 이 번쩍임이 유일한 원거리 신호라서 남긴다.
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
  on(window, 'touchend', () => { sw = false })
}

/** 지금 실제로 접혀 보이는가 — 넓은 화면·전용 모드에서는 collapsed 상태값과 무관하게 펼쳐져 있다 */
function isCollapsedNow(): boolean {
  const { collapsed, full } = metroStore.get()
  return isPhoneLayout() && collapsed && !full
}
function applyCollapse(): void {
  const { playing } = metroStore.get()
  const effective = isCollapsedNow() // 접힘은 오직 사용자가 정한다 (U1). 전용 모드(K10)에서는 항상 펼쳐진다
  q('metro-body-wrap').classList.toggle('collapsed', effective)
  q('metro-card').classList.toggle('bar', effective && playing) // 접힌 채 재생: 헤더 점을 키워 원거리에서 박이 보이게
  if (effective) clearDots()
}

/**
 * 폭에 따라 달라지는 것들을 한 곳에 모은다 (C8). 전에는 재생을 시작하는 순간에만 판정해서,
 * 폰에서 재생 중에 화면을 돌리면 헤더 재생 버튼이 넓은 화면에도 남았다.
 *
 * U1(베타 피드백 #1): 재생 시작 시 자동 접힘을 없앴다. "연습 중엔 튜너만" 은 우리 가정이었고,
 * 실사용자는 메트로놈을 **보려고** 켠다. 접힘은 이제 오직 접기 버튼으로만 바뀐다.
 * 헤더 재생 버튼은 '접힌 채 재생 중' 일 때만 — 펼쳐져 있으면 본체 재생 버튼이 보여 둘이 겹친다.
 */
function syncLayout(): void {
  const { playing, collapsed } = metroStore.get()
  q('metro-play-hdr-btn').style.display = isPhoneLayout() && playing && collapsed && !metroStore.get().full ? 'flex' : 'none' // 전용 모드는 본체 버튼이 보인다
  applyCollapse()
}

export function mountMetro(): void {
  attachDrag(q('metro-bpm-wrap')); attachDrag(q('metro-hdr-label'))
  on(q('metro-play-hdr-btn'), 'click', () => { const r = toggleMetro(); if (!r.ok) toast(r.error) })
  on(q('metro-play-btn'), 'click', () => { const r = toggleMetro(); if (!r.ok) toast(r.error) })
  // 크기 버튼 하나로 순환: 접힘 → 펼침 → 전용 → 접힘 (v2.3.2 M10). 글리프가 늘 **다음 목적지**를 가리킨다
  on(q('metro-size-btn'), 'click', sizeUp)
  // 내려가는 길은 카드를 아래로 미는 스와이프 — 순환만 두면 '펼침 → 접힘'(제일 잦은 전환)이 두 탭이 된다
  const ignore = '#metro-hdr-label, #dial, input[type=range], button, .m-seg'
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
    // 포커스된 버튼의 Space 는 그 버튼의 것 (설정 뒤로가기 등에서 메트로놈이 켜지지 않게)
    if (e.code !== 'Space' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON') return
    // 메뉴·설정·팝업·편집기가 떠 있으면 Space 는 메트로놈의 것이 아니다 (C1). 편집기에서는 편집기 재생이 받는다
    if (overlayOpen() || isEditorOpen()) return
    e.preventDefault(); const r = toggleMetro(); if (!r.ok) toast(r.error)
  })

  // ── 상태 → 화면 ──
  settingsStore.select(s => s.bpm, bpm => { q('metro-bpm').textContent = String(bpm); q('metro-hdr-bpm').textContent = String(bpm); setDialBpm(bpm); q('dial').setAttribute('aria-valuenow', String(bpm)) }, { immediate: true })
  onDialChange(setBPM)
  settingsStore.select(s => s.metroVol, v => { volMain.value = String(v); volPad.value = String(v) }, { immediate: true })
  settingsStore.select(s => s.timeSig, ts => {
    sweepResetDir() // 마디가 다시 시작되므로 스윕도 왼쪽부터 (M12)
    qsa('[data-ts]').forEach(b => b.classList.toggle('on', +b.dataset.ts! === ts))
    const is68 = ts === 6; const sd = q('sd-grid')
    sd.style.opacity = is68 ? '.3' : '1'; sd.style.pointerEvents = is68 ? 'none' : 'auto'
    q('sd-grid').classList.toggle('compound', is68) // 6/8: 세분 1 을 8분음표로 표시 (CSS 가 깃발을 보여준다)
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
  // 폭 등급(폰/넓음)이 바뀔 때만 다시 맞춘다 (C8). 150 ms 디바운스 — 회전 중에는 resize 가 연달아 온다.
  // 등급이 같으면 아무것도 안 한다: 안드로이드는 주소창 숨김·키보드에도 resize 를 내는데, 그때마다 syncLayout 을 하면
  // 재생 중에 사용자가 일부러 펼친 카드가 스크롤할 때마다 다시 접힌다 (정적 리뷰에서 발견)
  let resizeT: ReturnType<typeof setTimeout> | null = null, lastPhone = isPhoneLayout()
  on(window, 'resize', () => {
    if (resizeT) clearTimeout(resizeT)
    resizeT = setTimeout(() => { const phone = isPhoneLayout(); if (phone !== lastPhone) { lastPhone = phone; syncLayout() } }, 150)
  })
  metroStore.select(s => s.collapsed, () => { syncSizeBtn(); syncLayout() }) // 헤더 재생 버튼이 접힘에 달려 있다
  metroStore.select(s => s.full, () => { applyFull(); syncSizeBtn() })
  metroStore.select(s => s.lastTick, ({ tick }) => { if (!metroStore.get().playing) return; litBeat(tick); flashBeat(tick) })

  // 초기 상태 (v1): 본체는 펼친 채 그려지고, 폰이면 250 ms 후 접힘 애니메이션
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
/** 한 단계 아래로 (스와이프): 전용 → 펼침 → 접힘. 접힘에서는 더 내려갈 곳이 없다 */
function sizeDown(): void {
  const { collapsed, full } = metroStore.get()
  if (full) metroStore.set({ full: false, collapsed: false })
  else if (!collapsed) metroStore.set({ collapsed: true })
}
/** 버튼 글리프·라벨 = **다음 목적지**. 접힘 ∧(펼치러) · 펼침 ⤢(전용으로) · 전용 ∨(접힘으로) */
function syncSizeBtn(): void {
  const { collapsed, full } = metroStore.get(), btn = q('metro-size-btn')
  const toExpand = !full && collapsed, toFull = !full && !collapsed
  btn.classList.toggle('to-expand', toExpand)
  btn.classList.toggle('to-full', toFull)
  btn.setAttribute('aria-label', toExpand ? '메트로놈 펼치기' : toFull ? '메트로놈 전용 화면' : '메트로놈 접기')
}
