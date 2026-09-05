/**
 * 메트로놈 — lookahead 스케줄러 (v1 그대로). Phase 3에서 AudioWorklet 기반으로 교체 예정(설계서 §B6).
 * UI 관련(접힘, 버튼, 비트 표시)은 ui/metro.ts 가 metroStore 를 구독해 처리한다.
 */
import { CFG, metroStore, sessionStore, settingsStore, type SubDiv, type TimeSig } from '../state/index.ts'
import { A, getAC, ensureMetroAC, closeMetroAC, onMic } from './engine.ts'

let timer: ReturnType<typeof setTimeout> | null = null
let nextTime = 0, tick = 0, tickN = 0
let bpmDebounce: ReturnType<typeof setTimeout> | null = null

function tickInterval(): number {
  const s = settingsStore.get(); const b = 60 / s.bpm
  if (s.timeSig === 6) return b / 2
  if (s.subDiv === 'd') return tick % 2 === 0 ? b * 3 / 4 : b * 1 / 4
  return b / s.subDiv
}
export function totalTicks(): number { const s = settingsStore.get(); return s.subDiv === 'd' ? s.timeSig * 2 : s.timeSig * s.subDiv }

function scheduleClick(time: number, t: number): void {
  const ac = getAC(); if (!ac) return
  const dl = Math.max(0, (time - ac.currentTime) * 1000)
  setTimeout(() => { metroStore.set({ lastTick: { tick: t, n: ++tickN } }) }, dl)
  if (sessionStore.get().recording) { setTimeout(() => { A.isClick = false }, dl + CFG.metro.muteTunerMs); return }
  const s = settingsStore.get()
  const osc = ac.createOscillator(), gain = ac.createGain(); osc.connect(gain); gain.connect(ac.destination)
  let freq: number, vol: number
  if (s.subDiv === 'd') { const b1 = t === 0, bs = t % 2 === 0; freq = b1 ? 1800 : bs ? 1100 : 750; vol = b1 ? .75 : bs ? .42 : .18 }
  else { const b1 = t === 0, ib = t % s.subDiv === 0; freq = b1 ? 1800 : ib ? 1100 : 750; vol = b1 ? .75 : ib ? .42 : .18 }
  vol = Math.min(1, vol * (s.metroVol / .7)); osc.type = 'triangle'
  gain.gain.setValueAtTime(vol, time); gain.gain.exponentialRampToValueAtTime(.001, time + CFG.metro.clickDurS)
  osc.frequency.value = freq; osc.onended = () => { osc.disconnect(); gain.disconnect() }; osc.start(time); osc.stop(time + CFG.metro.clickDurS)
  if (A.micAC) { setTimeout(() => { A.isClick = true }, dl - 15); setTimeout(() => { A.isClick = false }, dl + CFG.metro.muteTunerMs) }
}
function sched(): void {
  const ac = getAC(); if (!ac) return
  while (nextTime < ac.currentTime + CFG.metro.lookaheadS) { scheduleClick(nextTime, tick); nextTime += tickInterval(); tick = (tick + 1) % totalTicks() }
  timer = setTimeout(sched, CFG.metro.intervalMs)
}

export type StartResult = { ok: true } | { ok: false; error: string }
export function startMetro(): StartResult {
  if (!A.micAC && !ensureMetroAC()) return { ok: false, error: '오디오를 시작할 수 없습니다' }
  const ac = getAC(); if (!ac) return { ok: false, error: '오디오를 시작할 수 없습니다' }
  tick = 0; nextTime = ac.currentTime + .05
  metroStore.set({ playing: true }); sched()
  return { ok: true }
}
/** 스케줄만 멈춤 (UI 알림 없음) — 마이크 전환 시 내부용 */
function stopScheduler(): void { if (timer) clearTimeout(timer); timer = null }
export function stopMetro(): void {
  metroStore.set({ playing: false }); stopScheduler(); closeMetroAC()
}
export function toggleMetro(): StartResult { return metroStore.get().playing ? (stopMetro(), { ok: true }) : startMetro() }
function restartIfPlaying(): void { if (metroStore.get().playing) { stopMetro(); startMetro() } }

export function setBPM(v: number): void {
  const bpm = Math.max(CFG.metro.bpmMin, Math.min(CFG.metro.bpmMax, v))
  settingsStore.set({ bpm })
  if (bpmDebounce) clearTimeout(bpmDebounce)
  if (metroStore.get().playing) bpmDebounce = setTimeout(() => { stopMetro(); startMetro() }, 300)
}
export function adjBPM(d: number): void { setBPM(settingsStore.get().bpm + d) }
export function setTimeSig(v: TimeSig): void {
  const patch: { timeSig: TimeSig; subDiv?: SubDiv } = { timeSig: v }
  if (v === 6) patch.subDiv = 1
  settingsStore.set(patch); restartIfPlaying()
}
export function setSubDiv(v: SubDiv): void { settingsStore.set({ subDiv: v }); restartIfPlaying() }
export function setMetroVol(v: number): void { settingsStore.set({ metroVol: v }) }

// ── 마이크 생명주기와의 상호작용 (v1 openMic/closeMic 내부 로직) ──
let resumeAfterMic = false
onMic('afterOpen', () => {
  // 메트로놈 전용 컨텍스트로 돌고 있었다면 마이크 컨텍스트로 옮겨 탄다
  if (A.metroAC) {
    const was = metroStore.get().playing
    if (was) { stopScheduler(); metroStore.set({ playing: false }) }
    A.metroAC.close(); A.metroAC = null
    if (was) startMetro()
  }
})
onMic('beforeClose', () => { resumeAfterMic = metroStore.get().playing; if (resumeAfterMic) { stopScheduler(); metroStore.set({ playing: false }) } })
onMic('afterClose', () => { if (resumeAfterMic) { resumeAfterMic = false; startMetro() } })
