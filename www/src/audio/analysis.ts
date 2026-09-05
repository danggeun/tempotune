/**
 * 튜너 분석 루프 (Phase 1: v1과 동일하게 메인 스레드 rAF).
 * fftDetect(연주 감지) → yin(4프레임에 1회) → 락/스무딩 → tunerStore.
 * Phase 2에서 워커로 이동하고 락 로직은 신뢰도 기반으로 교체된다(설계서 §B).
 */
import { yin as yinPure } from '../core/yin.ts'
import { hzToMidi, midiToHz, centsFrom } from '../core/note.ts'
import { CFG, settingsStore, tunerStore } from '../state/index.ts'
import { A } from './engine.ts'
import { yamnetAvailable, runYamnet, yamnetSaysString, resetYamnet } from './yamnet.ts'

// ── 연주 감지 (FFT 하모닉) ──
let noiseEst = -65, detFreq = 0, holdFrames = 0
function fftDetect(): boolean {
  if (!A.analyserFFT || !A.fftBuf) return false
  A.analyserFFT.getFloatFrequencyData(A.fftBuf)
  const buf = A.fftBuf
  const lo = Math.floor(CFG.detect.hzMin * A.binCount * 2 / A.sampleRate), hi = Math.min(Math.floor(CFG.detect.hzMax * A.binCount * 2 / A.sampleRate), A.binCount - 1)
  let peak = -Infinity, pkB = 0, sum = 0, n = 0
  for (let i = lo; i <= hi; i++) { const v = buf[i]!; if (v > peak) { peak = v; pkB = i } if (v > -90) { sum += v; n++ } }
  if (n === 0) return false
  const effectiveFloor = Math.max(CFG.detect.noiseFloor, noiseEst + 10)
  if (peak < effectiveFloor || peak - sum / n < CFG.detect.peakMargin) { noiseEst = noiseEst * .997 + peak * .003; return false }
  let h = 0; for (const m of [2, 3, 4, 5]) { const b = Math.round(pkB * m); if (b < A.binCount && buf[b]! > peak - CFG.detect.harmonicDrop) h++ }
  if (h < CFG.detect.harmonicMin) { noiseEst = noiseEst * .997 + peak * .003; return false }
  detFreq = Math.round(pkB * A.sampleRate / (A.binCount * 2)); return true
}

// ── YIN (RMS 게이트 + 4프레임 스킵) ──
let yf = 0, lastYin = -1, lastRms = 0
function yinGated(buf: Float32Array, sr: number): number {
  if (++yf % 4 !== 0) return lastYin
  const N = buf.length; let r = 0; for (let i = 0; i < N; i++) r += buf[i]! * buf[i]!; lastRms = Math.sqrt(r / N)
  if (lastRms < settingsStore.get().rmsMin) return lastYin = -1
  return lastYin = yinPure(buf, sr, CFG.tuner.yinThreshold)
}

// ── 락 / 스무딩 (v1 updateTunerUI 상태 부분) ──
const L = { smoothFreq: -1, lockedMidi: -1, lockCount: 0, lockedRms: 0 }
function lock(raw: number, playing: boolean): number {
  if (raw === -1) { L.smoothFreq = -1; L.lockedMidi = -1; L.lockCount = 0; L.lockedRms = 0; return -1 }
  const corrMidi = hzToMidi(raw)
  if (corrMidi === L.lockedMidi) {
    L.smoothFreq = L.smoothFreq === -1 ? raw : L.smoothFreq + (raw - L.smoothFreq) * settingsStore.get().smoothing
    L.lockedRms = lastRms
  } else {
    const rmsWeak = lastRms < L.lockedRms * .5 && L.lockedMidi !== -1
    const isOctaveJump = L.lockedMidi !== -1 && Math.abs(corrMidi - L.lockedMidi) === 12
    const fftFavorsLocked = isOctaveJump && playing && detFreq > 0 && (() => {
      const lockedHz = midiToHz(L.lockedMidi)
      return Math.abs(1200 * Math.log2(detFreq / lockedHz)) < Math.abs(1200 * Math.log2(detFreq / raw))
    })()
    const needed = fftFavorsLocked ? CFG.tuner.lockFrames * 3 : rmsWeak ? CFG.tuner.lockFrames * 2 : CFG.tuner.lockFrames
    L.lockCount++
    if (L.lockCount >= needed) { L.lockedMidi = corrMidi; L.lockCount = 0; L.smoothFreq = raw; L.lockedRms = lastRms }
    else if (L.smoothFreq === -1) L.smoothFreq = raw
  }
  return L.smoothFreq
}

// ── 프레임 루프 ──
let rafId: number | null = null
let lastYamnetMs = 0
function frame(): void {
  const st = tunerStore.get()
  const s = settingsStore.get()
  let playing = st.playing
  if (st.running && A.analyserFFT && !A.isClick) {
    const fftPass = fftDetect()
    if (fftPass && s.aiMode && Date.now() - lastYamnetMs > CFG.yamnet.intervalMs && yamnetAvailable()) { lastYamnetMs = Date.now(); runYamnet() }
    if (!fftPass) resetYamnet()
    const detected = s.aiMode ? fftPass && (yamnetSaysString() || !yamnetAvailable()) : fftPass
    holdFrames = detected ? CFG.detect.holdFrames : Math.max(0, holdFrames - 1); playing = holdFrames > 0
  }
  if (st.running && A.analyserTD && A.tdBuf && !A.isClick) {
    A.analyserTD.getFloatTimeDomainData(A.tdBuf)
    const hz = lock(yinGated(A.tdBuf, A.sampleRate), playing)
    if (hz === -1) tunerStore.set({ frame: st.frame + 1, hz: -1, midi: -1, cents: 0, inTune: false, playing })
    else {
      const midi = hzToMidi(hz), cents = centsFrom(hz, midi, s.refHz)
      tunerStore.set({ frame: st.frame + 1, hz, midi, cents, inTune: Math.abs(cents) <= s.tolCents, playing, lastActivityMs: Date.now() })
    }
  } else if (playing !== st.playing) tunerStore.set({ playing })
  rafId = tunerStore.get().running ? requestAnimationFrame(frame) : null
}
export function startAnalysis(): void { if (rafId == null) rafId = requestAnimationFrame(frame) }
export function stopAnalysis(): void { if (rafId != null) { cancelAnimationFrame(rafId); rafId = null } }
/** AI 모드 끌 때 감지 상태 즉시 리셋 (v1 setAiMode) */
export function resetPlayingDetection(): void { holdFrames = 0; resetYamnet(); tunerStore.set({ playing: false }) }
