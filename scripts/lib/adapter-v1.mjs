// v1 알고리즘 어댑터 — 현재 앱(main.js @ fd56de1)의 튜너/연주감지 로직을 DOM 없이 재현
// 왜: 리팩토링 전 기준선 숫자를 남기기 위해. 로직은 main.js에서 그대로 옮겼고, 아래 항목만 근사:
//  - AnalyserNode의 dB 스케일/Blackman 창 → Hann 창 + 스케일 보정(+24 dB), 0.88 지수 평활은 선형 크기에 적용
//  - 앱은 rAF(≈60 Hz)마다 4096 창을 읽고 YIN은 4프레임에 1번 → 하네스는 hop 1024(≈43 Hz)에 매 프레임 실행.
//    `skip` 옵션으로 4프레임 스킵을 흉내 낼 수 있음 (앱 체감치).
import { yin as yinPure } from '../../www/src/core/yin.ts'
import { makeFFT } from './fft.mjs'

export function createV1({ sampleRate, skip = 1 } = {}) {
  const CFG = {
    detect: { fftSize: 4096, fftSmooth: .88, hzMin: 80, hzMax: 4800, noiseFloor: -44, peakMargin: 8, harmonicDrop: 35, harmonicMin: 2, holdFrames: 45 },
    tuner: { yinThreshold: .10, rmsMin: .020, lockFrames: 3, smoothing: .10 },
  }
  const fft = makeFFT(CFG.detect.fftSize)
  const binCount = CFG.detect.fftSize / 2
  const magSmooth = new Float32Array(binCount)
  const fftBuf = new Float32Array(binCount)
  const re = new Float32Array(CFG.detect.fftSize), im = new Float32Array(CFG.detect.fftSize)
  let _noiseEst = -65, detFreq = 0, holdFrames = 0, strOK = false
  let _yf = 0, _ly = -1, _lastRms = 0
  const S = { smoothFreq: -1, lockedMidi: -1, lockCount: 0, lockedRms: 0 }

  function fftDetect(buf) {
    // AnalyserNode 근사
    for (let i = 0; i < buf.length; i++) { re[i] = buf[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / buf.length)); im[i] = 0 }
    fft.transform(re, im)
    for (let i = 0; i < binCount; i++) {
      const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / buf.length * 4 // full-scale sine ≈ 1
      magSmooth[i] = CFG.detect.fftSmooth * magSmooth[i] + (1 - CFG.detect.fftSmooth) * mag
      fftBuf[i] = 20 * Math.log10(magSmooth[i] + 1e-10)
    }
    const lo = Math.floor(CFG.detect.hzMin * binCount * 2 / sampleRate), hi = Math.min(Math.floor(CFG.detect.hzMax * binCount * 2 / sampleRate), binCount - 1)
    let peak = -Infinity, pkB = 0, sum = 0, n = 0
    for (let i = lo; i <= hi; i++) { if (fftBuf[i] > peak) { peak = fftBuf[i]; pkB = i } if (fftBuf[i] > -90) { sum += fftBuf[i]; n++ } }
    if (n === 0) return false
    const effectiveFloor = Math.max(CFG.detect.noiseFloor, _noiseEst + 10)
    if (peak < effectiveFloor || peak - sum / n < CFG.detect.peakMargin) { _noiseEst = _noiseEst * .997 + peak * .003; return false }
    let h = 0; for (const m of [2, 3, 4, 5]) { const b = Math.round(pkB * m); if (b < binCount && fftBuf[b] > peak - CFG.detect.harmonicDrop) h++ }
    if (h < CFG.detect.harmonicMin) { _noiseEst = _noiseEst * .997 + peak * .003; return false }
    detFreq = Math.round(pkB * sampleRate / (binCount * 2)); return true
  }
  function yin(buf) {
    if (++_yf % skip !== 0) return _ly
    const N = buf.length; let r = 0; for (let i = 0; i < N; i++) r += buf[i] * buf[i]; _lastRms = Math.sqrt(r / N)
    if (_lastRms < CFG.tuner.rmsMin) return _ly = -1
    return _ly = yinPure(buf, sampleRate, CFG.tuner.yinThreshold)
  }
  // updateTunerUI의 락/스무딩 부분
  function lock(raw) {
    if (raw === -1) { S.smoothFreq = -1; S.lockedMidi = -1; S.lockCount = 0; S.lockedRms = 0; return -1 }
    const corrMidi = Math.round(12 * Math.log2(raw / 440)) + 69
    if (corrMidi === S.lockedMidi) {
      S.smoothFreq = S.smoothFreq === -1 ? raw : S.smoothFreq + (raw - S.smoothFreq) * CFG.tuner.smoothing
      S.lockedRms = _lastRms
    } else {
      const rmsWeak = _lastRms < S.lockedRms * .5 && S.lockedMidi !== -1
      const isOctaveJump = S.lockedMidi !== -1 && Math.abs(corrMidi - S.lockedMidi) === 12
      const fftFavorsLocked = isOctaveJump && strOK && detFreq > 0 && (() => {
        const lockedHz = 440 * Math.pow(2, (S.lockedMidi - 69) / 12)
        return Math.abs(1200 * Math.log2(detFreq / lockedHz)) < Math.abs(1200 * Math.log2(detFreq / raw))
      })()
      const needed = fftFavorsLocked ? CFG.tuner.lockFrames * 3 : rmsWeak ? CFG.tuner.lockFrames * 2 : CFG.tuner.lockFrames
      S.lockCount++
      if (S.lockCount >= needed) { S.lockedMidi = corrMidi; S.lockCount = 0; S.smoothFreq = raw; S.lockedRms = _lastRms }
      else if (S.smoothFreq === -1) S.smoothFreq = raw
    }
    return S.smoothFreq
  }
  return {
    name: 'v1' + (skip > 1 ? `(skip${skip})` : ''),
    windowSize: 4096,
    /** buf: 최신 4096 샘플. 반환 {hz, playing, ms} — hz는 표시되는(스무딩된) 주파수, -1이면 표시 없음 */
    process(buf) {
      const t0 = performance.now()
      const fftPass = fftDetect(buf)
      holdFrames = fftPass ? CFG.detect.holdFrames : Math.max(0, holdFrames - 1); strOK = holdFrames > 0
      const hz = lock(yin(buf))
      return { hz, conf: hz > 0 ? 1 : 0, playing: strOK, ms: performance.now() - t0 }
    },
  }
}
