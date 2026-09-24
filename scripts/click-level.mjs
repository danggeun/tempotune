#!/usr/bin/env node
// 메트로놈 클릭 레벨 실측 — v2.0.1 클릭 대 현재 코드(core/metro/sequencer.ts). 사용: node scripts/click-level.mjs [--sr 48000]
// '고역강조 RMS' = 1차 차분 후 RMS — 저역을 거의 못 내는 폰 스피커의 체감에 대한 거친 근사
import { createSequencer, CLICK_DUR_S } from '../www/src/core/metro/sequencer.ts'
import { softClip } from '../www/src/core/softclip.ts'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(Boolean))
const sr = +(args.sr || 48000)
const LEN = Math.round(CLICK_DUR_S * sr)
const FREQ = { accent: 1800, beat: 1100, sub: 750 }
const OLD_VOL = { accent: .75, beat: .42, sub: .18 } // v2.0.1
const db = v => (v <= 0 ? -Infinity : 20 * Math.log10(v))

/** 현재 코드로 한 클릭 렌더 (subDiv 3 으로 강박·박·세분을 한 마디에서 모두 뽑는다) */
function renderNow(kind, volume) {
  // 각 종류의 첫 등장 틱: accent 0, beat 3(subDiv 3), sub 1
  const tick = kind === 'accent' ? 0 : kind === 'beat' ? 3 : 1
  const seq = createSequencer(sr, { bpm: 60, timeSig: 4, subDiv: 3, volume, muted: false })
  seq.start(0)
  const total = Math.ceil(4 * sr), buf = new Float32Array(total), out = new Float32Array(128)
  const marks = []
  for (let s = 0; s < total; s += 128) {
    out.fill(0)
    for (const ev of seq.render(out, s)) marks.push(ev)
    buf.set(out.subarray(0, Math.min(128, total - s)), s)
  }
  const m = marks.find(e => e.tick === tick)
  const from = m ? m.sample : 0
  return buf.subarray(from, from + LEN)
}
/** v2.0.1 의 클릭 (비교 기준) */
function renderV201(kind, volume) {
  const vol = Math.min(1, OLD_VOL[kind] * (volume / 0.7)), b = new Float32Array(LEN)
  let phase = 0.25
  for (let s = 0; s < LEN; s++) {
    const env = vol * Math.pow(0.001 / vol, s / LEN)
    phase += FREQ[kind] / sr; if (phase >= 1) phase -= 1
    b[s] = (4 * Math.abs(phase - 0.5) - 1) * env
  }
  return b
}
const lim = b => Float32Array.from(b, softClip) // 출력단 리미터까지 포함해서 잰다
const peak = b => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const rms = b => Math.sqrt(b.reduce((e, v) => e + v * v, 0) / b.length)
const hpRms = b => { let e = 0, p = 0; for (const v of b) { const d = v - p; p = v; e += d * d } return Math.sqrt(e / b.length) }

const KINDS = ['accent', 'beat', 'sub']
console.log(`# 메트로놈 클릭 레벨 (sr=${sr}, 클릭 ${CLICK_DUR_S * 1000} ms)\n`)
console.log('| 슬라이더 | 종류 | 피크 v2.0.1 | 피크 현재 | RMS v2.0.1 | RMS 현재 | RMS 이득 | 고역강조 이득 |')
console.log('|---|---|---|---|---|---|---|---|')
for (const volume of [0.7, 1.0]) for (const kind of KINDS) {
  const o = lim(renderV201(kind, volume)), n = lim(renderNow(kind, volume))
  console.log(`| ${volume.toFixed(1)} | ${kind} | ${db(peak(o)).toFixed(1)} | ${db(peak(n)).toFixed(1)} | ${db(rms(o)).toFixed(1)} | ${db(rms(n)).toFixed(1)} | **${(db(rms(n)) - db(rms(o))).toFixed(1)} dB** | **${(db(hpRms(n)) - db(hpRms(o))).toFixed(1)} dB** |`)
}
console.log('\n## 기본값 대 기본값 (v2.0.1 슬라이더 0.7 → v2.0.2 슬라이더 1.0)\n')
console.log('| 종류 | 피크 | RMS 이득 | 고역강조 이득 |')
console.log('|---|---|---|---|')
for (const kind of KINDS) {
  const o = lim(renderV201(kind, 0.7)), n = lim(renderNow(kind, 1.0))
  console.log(`| ${kind} | ${db(peak(o)).toFixed(1)} → ${db(peak(n)).toFixed(1)} dBFS | **${(db(rms(n)) - db(rms(o))).toFixed(1)} dB** | **${(db(hpRms(n)) - db(hpRms(o))).toFixed(1)} dB** |`)
}
// 리미터가 실제로 필요한지 (겹침 최악 조건)
{
  const seq = createSequencer(sr, { bpm: 220, timeSig: 4, subDiv: 3, volume: 1, muted: false }); seq.start(0)
  const out = new Float32Array(128); let raw = 0, limited = 0
  for (let s = 0; s < 5 * sr; s += 128) { out.fill(0); seq.render(out, s); for (const v of out) { raw = Math.max(raw, Math.abs(v)); limited = Math.max(limited, Math.abs(softClip(v))) } }
  console.log(`\n최악 겹침(220 BPM 16분음표, 슬라이더 1.0): 리미터 전 피크 ${db(raw).toFixed(2)} dBFS → 후 ${db(limited).toFixed(2)} dBFS (하드 클리핑 없음: ${limited < 1})`)
}
console.log(`\n감쇠 시간상수: v2.0.1 ${(CLICK_DUR_S * 1000 / Math.log(1 / 0.001)).toFixed(1)}~${(CLICK_DUR_S * 1000 / Math.log(0.18 / 0.001)).toFixed(1)} ms (세기마다 달랐다) → v2.0.2 전부 ${(CLICK_DUR_S * 1000 / Math.log(1 / 0.02)).toFixed(1)} ms`)
