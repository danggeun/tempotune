/**
 * 메트로놈 카드 UI — BPM 표시/드래그, 박자·세분 버튼, 비트 점, 강박 flash, 접기/펼치기.
 * 접힘은 CSS grid(0fr/1fr) 트랜지션 — v1의 maxHeight 측정 코드는 제거(설계서 §C3).
 * 표시 규칙(v1 유지): 폰 레이아웃에서는 "사용자가 접음 OR 재생 중"이면 접힌다.
 */
import { CFG, metroStore, settingsStore, type SubDiv, type TimeSig } from '../state/index.ts'
import { setBPM, adjBPM, setTimeSig, setSubDiv, setMetroVol, toggleMetro, totalTicks } from '../audio/metronome.ts'
import { tickKind } from '../core/metro/sequencer.ts'
import { isPhoneLayout } from '../platform/index.ts'
import { q, qsa, on, reflow } from './dom.ts'
import { toast } from './toast.ts'

let dots: HTMLElement[] = []
function buildBeatVis(): void {
  const wrap = q('beat-vis'); wrap.innerHTML = ''
  const s = settingsStore.get(), total = totalTicks()
  for (let i = 0; i < total; i++) {
    const dot = document.createElement('div')
    dot.className = 'bd ' + (tickKind(s, i) === 'sub' ? 'subdiv' : 'beat'); dot.dataset.tick = String(i); wrap.appendChild(dot)
  }
  dots = Array.from(wrap.querySelectorAll<HTMLElement>('.bd'))
}
const clearDots = () => dots.forEach(d => d.classList.remove('lit-a', 'lit-b', 'lit-s'))

function litBeat(tick: number): void {
  const s = settingsStore.get()
  dots.forEach(d => {
    d.classList.remove('lit-a', 'lit-b', 'lit-s'); if (+d.dataset.tick! !== tick) return
    const k = tickKind(s, tick)
    d.classList.add(k === 'accent' ? 'lit-a' : k === 'beat' ? 'lit-b' : 'lit-s')
  })
}
let flashTimer: ReturnType<typeof setTimeout> | null = null
function flashBeat(tick: number): void {
  const card = q('metro-card'); card.classList.remove('flash-strong', 'lit-weak')
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

/** 재생 시작이 접었으면(사용자가 펼쳐 두었던 것) 정지 때 다시 펼친다 — v1 동작 유지. 재생 중 사용자가 펼치면 그대로 둔다 */
let autoCollapsed = false
function applyCollapse(): void {
  const { collapsed, playing } = metroStore.get()
  const effective = isPhoneLayout() && collapsed // 재생 '시작' 시 자동으로 접히지만(아래), 재생 중에도 펼쳐서 박자·세분·음량을 바꿀 수 있다 (리뷰)
  q('metro-body-wrap').classList.toggle('collapsed', effective)
  q('metro-card').classList.toggle('bar', effective && playing) // 접힌 채 재생: 헤더 점을 키워 원거리에서 박이 보이게
  if (effective) clearDots()
}

export function mountMetro(): void {
  attachDrag(q('metro-bpm-wrap')); attachDrag(q('metro-hdr-label'))
  on(q('metro-play-hdr-btn'), 'click', () => { const r = toggleMetro(); if (!r.ok) toast(r.error) })
  on(q('metro-play-btn'), 'click', () => { const r = toggleMetro(); if (!r.ok) toast(r.error) })
  on(q('metro-collapse-btn'), 'click', () => { autoCollapsed = false; metroStore.set({ collapsed: !metroStore.get().collapsed }) }) // 사용자가 직접 만지면 자동 접힘 기억은 지운다
  qsa('.m-adj, .m-adj-pad').forEach(b => on(b, 'click', () => adjBPM(b.textContent === '−' ? -1 : 1)))
  const volMain = q<HTMLInputElement>('metro-vol'), volPad = q<HTMLInputElement>('metro-vol-pad-input')
  on(volMain, 'input', () => { setMetroVol(+volMain.value); volPad.value = volMain.value })
  on(volPad, 'input', () => { setMetroVol(+volPad.value); volMain.value = volPad.value })
  qsa('[data-ts]').forEach(b => on(b, 'click', () => setTimeSig(+b.dataset.ts! as TimeSig)))
  qsa('[data-sd]').forEach(b => on(b, 'click', () => setSubDiv((b.dataset.sd === 'd' ? 'd' : +b.dataset.sd!) as SubDiv)))
  on(document, 'keydown', (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    // 포커스된 버튼의 Space 는 그 버튼의 것 (설정 뒤로가기 등에서 메트로놈이 켜지지 않게)
    if (e.code === 'Space' && t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA' && t.tagName !== 'BUTTON') { e.preventDefault(); const r = toggleMetro(); if (!r.ok) toast(r.error) }
  })

  // ── 상태 → 화면 ──
  settingsStore.select(s => s.bpm, bpm => { q('metro-bpm').textContent = String(bpm); q('metro-hdr-label').textContent = '♩ ' + bpm }, { immediate: true })
  settingsStore.select(s => s.metroVol, v => { volMain.value = String(v); volPad.value = String(v) }, { immediate: true })
  settingsStore.select(s => s.timeSig, ts => {
    qsa('[data-ts]').forEach(b => b.classList.toggle('on', +b.dataset.ts! === ts))
    const is68 = ts === 6; const sd = q('sd-grid')
    sd.style.opacity = is68 ? '.3' : '1'; sd.style.pointerEvents = is68 ? 'none' : 'auto'
    qsa('[data-sd="1"]').forEach(b => b.textContent = is68 ? '♪' : '♩')
    buildBeatVis()
  }, { immediate: true })
  settingsStore.select(s => s.subDiv, sd => { qsa('[data-sd]').forEach(b => b.classList.toggle('on', b.dataset.sd === String(sd))); buildBeatVis() }, { immediate: true })

  metroStore.select(s => s.playing, playing => {
    const btn = q('metro-play-btn')
    btn.textContent = playing ? '■' : '▶'
    if (isPhoneLayout()) {
      q('metro-play-hdr-btn').style.display = playing ? 'flex' : 'none'
      if (playing && !metroStore.get().collapsed) { autoCollapsed = true; metroStore.set({ collapsed: true }) } // 시작 시 자동 접힘 (연습 중엔 튜너만). 접기 버튼은 남아 재생 중에도 펼칠 수 있다
      else if (!playing && autoCollapsed) { autoCollapsed = false; metroStore.set({ collapsed: false }) }
    }
    if (playing) buildBeatVis(); else clearDots()
    applyCollapse()
  })
  metroStore.select(s => s.collapsed, collapsed => { q('metro-collapse-btn').textContent = collapsed ? '▲' : '▼'; applyCollapse() })
  metroStore.select(s => s.lastTick, ({ tick }) => { if (!metroStore.get().playing) return; litBeat(tick); flashBeat(tick) })

  // 초기 상태 (v1): 본체는 펼친 채 그려지고, 폰이면 250 ms 후 접힘 애니메이션
  if (isPhoneLayout()) setTimeout(() => { applyCollapse(); q('metro-collapse-btn').textContent = '▲' }, 250)
}
