#!/usr/bin/env node
// 라벨 없는 실제 녹음 진단 — 합성 신호로는 드러나지 않는 실패를 잡기 위한 도구.
//
// 왜 별도 도구인가: bench.mjs 는 정답(JSON 라벨)이 있어야 점수를 낸다. 실제 연주 녹음에는 라벨이 없다.
// 대신 "물리적으로 불가능한 출력" 과 "스펙트럼에 없는 음" 은 라벨 없이도 판정할 수 있다.
// 이 도구가 바이올린 더블스톱에서 가짜음 23.7 % 를 찾아냈다 (docs 실측 발견 B1·B2).
//
// 사용: node --experimental-strip-types scripts/analyze-recording.mjs <wav> [--lo G3] [--hi E7] [--json out.json]
//   --lo/--hi  악기의 물리적 음역. 이 밖의 출력은 무조건 오류다. 생략하면 음역 검사를 건너뛴다.
import { readFileSync, writeFileSync } from 'node:fs'
import { createYinFast } from '../www/src/core/pitch/yinFast.ts'
import { createSpectrum } from '../www/src/core/pitch/spectrum.ts'
import { createAnalyzer } from '../www/src/core/pitch/analyzer.ts'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }
const wavPath = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true) ?? argv[0]
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const toMidi = n => { const m = /^([A-G]#?)(-?\d)$/.exec(n); if (!m) return NaN; return NOTE.indexOf(m[1]) + (+m[2] + 1) * 12 }
const nameOf = m => NOTE[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1)
const lo = arg('--lo') ? toMidi(arg('--lo')) : NaN, hi = arg('--hi') ? toMidi(arg('--hi')) : NaN

const b = readFileSync(wavPath)
if (b.toString('ascii', 0, 4) !== 'RIFF') { console.error('WAV(PCM) 파일이 필요합니다. ffmpeg -i in.m4a -ac 1 -ar 48000 -c:a pcm_s16le out.wav'); process.exit(1) }
const sr = b.readUInt32LE(24), bits = b.readUInt16LE(34), ch = b.readUInt16LE(22)
let off = 12; while (b.toString('ascii', off, off + 4) !== 'data') off += 8 + b.readUInt32LE(off + 4)
const n = b.readUInt32LE(off + 4) / (bits / 8) / ch, x = new Float32Array(n)
for (let i = 0; i < n; i++) x[i] = b.readInt16LE(off + 8 + i * ch * (bits / 8)) / 32768

const N = 4096, HOP = 1024
const an = createAnalyzer({ sampleRate: sr, windowSize: N })
an.setSettings({ rmsMin: .014, smoothing: .14, refHz: 440, tolCents: 15 })
const spec = createSpectrum(N)           // 진단용 (분석기 내부와 별개)
const win = new Float32Array(N), F = []
for (let end = HOP; end <= x.length; end += HOP) {
  win.fill(0); const s0 = Math.max(0, end - N); win.set(x.subarray(s0, end), N - (end - s0))
  const t0 = performance.now(); const f = an.process(win); const ms = performance.now() - t0
  spec.update(win, sr)
  // 표시된 음이 스펙트럼에 실제로 있는가 (f0·2f0·3f0 중 하나라도)
  const specOk = f.hz > 0 ? spec.harmonicCount(f.hz, 3, 6) > 0 : null
  F.push({ t: end / sr, hz: f.hz, rawHz: f.rawHz, conf: f.conf, playing: f.playing, specOk, ms })
}
const shown = F.filter(f => f.hz > 0)
const pct = (a, p) => { const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const midi = h => 12 * Math.log2(h / 440) + 69
const jumps = []
for (let i = 1; i < F.length; i++) if (F[i - 1].hz > 0 && F[i].hz > 0) jumps.push(Math.abs(1200 * Math.log2(F[i].hz / F[i - 1].hz)))
const outOfRange = Number.isNaN(lo) ? [] : shown.filter(f => midi(f.hz) < lo - 1 || (!Number.isNaN(hi) && midi(f.hz) > hi + 1))
const phantom = shown.filter(f => f.specOk === false)

console.log(`\n${wavPath}  ${sr} Hz · ${(n / sr / 60).toFixed(1)}분 · 프레임 ${F.length}`)
console.log(`\n표시`)
console.log(`  음을 표시한 프레임      ${(shown.length / F.length * 100).toFixed(1)} %`)
console.log(`  연주로 판정             ${(F.filter(f => f.playing).length / F.length * 100).toFixed(2)} %`)
console.log(`\n정확도`)
if (!Number.isNaN(lo)) console.log(`  ★ 음역 밖 출력          ${(outOfRange.length / shown.length * 100).toFixed(2)} %  (${outOfRange.length}개)  ← 물리적으로 불가능 = 확정 오류`)
console.log(`  ★ 스펙트럼에 없는 음    ${(phantom.length / shown.length * 100).toFixed(2)} %  (${phantom.length}개)  ← 가짜음`)
if (shown.length) {
  const ms_ = shown.map(f => midi(f.hz))
  console.log(`  음역                    ${nameOf(pct(ms_, .005))} ~ ${nameOf(pct(ms_, .995))}  (중앙 ${nameOf(pct(ms_, .5))})`)
}
console.log(`\n트레이스`)
console.log(`  프레임 간 변화          중앙 ${pct(jumps, .5).toFixed(1)}¢ · 90% ${pct(jumps, .9).toFixed(1)}¢ · 99% ${pct(jumps, .99).toFixed(1)}¢`)
console.log(`\n성능`)
const ms = F.map(f => f.ms)
console.log(`  프레임 처리시간         중앙 ${pct(ms, .5).toFixed(2)} ms · p95 ${pct(ms, .95).toFixed(2)} ms · 예산 ${(HOP / sr * 1000).toFixed(1)} ms · 초과 ${ms.filter(v => v > HOP / sr * 1000).length}개`)
if (arg('--json')) { writeFileSync(arg('--json'), JSON.stringify(F)); console.log(`\n프레임 저장: ${arg('--json')}`) }
