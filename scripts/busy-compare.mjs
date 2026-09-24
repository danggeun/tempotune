#!/usr/bin/env node
// 표준 회귀 세트 — "이 변경으로 튜너 화면이 더 부산해졌나 / 더 틀려졌나" 를 1분 안에 답한다.
// 사용:
//   npx tsx scripts/busy-compare.mjs --save  base.json          # 변경 전 기준 저장
//   npx tsx scripts/busy-compare.mjs --compare base.json        # 변경 후 비교 (나빠진 칸에 ▲)
//   옵션: --rec <dir>  실녹음 wav 폴더(리포 밖, 사용자 녹음) · --v1  리팩토링 전 v1 어댑터도 같이
// 지표: 표시율 · 라벨 변화/초 · 0.1초 미만 스침/초 · 낼 수 없는 음(바이올린 솔3 미만) % · 트레이스에 그려지는 비율 %
import { createAnalyzer } from '../www/src/core/pitch/analyzer.ts'
import { TRACE_HELD_MAX } from '../www/src/core/trace.ts'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean))
const WIN = 4096, HOP = 1024, REF = 442, RMS_MIN = .005 // 기본 감도('보통')

function readWav(p) {
  const d = readFileSync(p); let i = 12, sr = 48000, bits = 16, fmt = 1, ch = 1
  while (i < d.length - 8) {
    const id = d.toString('ascii', i, i + 4), sz = d.readUInt32LE(i + 4)
    if (id === 'fmt ') { fmt = d.readUInt16LE(i + 8); ch = d.readUInt16LE(i + 10); sr = d.readUInt32LE(i + 12); bits = d.readUInt16LE(i + 22) }
    if (id === 'data') {
      if ((fmt === 3 || fmt === 65534) && bits === 32) { const n = Math.floor(sz / 4 / ch), x = new Float32Array(n); for (let k = 0; k < n; k++) x[k] = d.readFloatLE(i + 8 + k * 4 * ch); return { x, sr } }
      if (bits === 16) { const n = Math.floor(sz / 2 / ch), x = new Float32Array(n); for (let k = 0; k < n; k++) x[k] = d.readInt16LE(i + 8 + k * 2 * ch) / 32768; return { x, sr } }
      throw new Error(`지원하지 않는 wav: fmt ${fmt} / ${bits} bit`)
    }
    i += 8 + sz + (sz & 1)
  }
  throw new Error('data 청크 없음: ' + p)
}
function run(x, sr, mk = (o) => createAnalyzer(o)) {
  const a = mk({ sampleRate: sr, windowSize: WIN }); a.setSettings?.({ rmsMin: RMS_MIN, smoothing: .12, refHz: REF, tolCents: 15 })
  const w = new Float32Array(WIN), o = []
  for (let s = 0; s + WIN <= x.length; s += HOP) { w.set(x.subarray(s, s + WIN)); const f = a.process(w); o.push({ midi: f.hz > 0 ? (f.midi ?? Math.round(69 + 12 * Math.log2(f.hz / REF))) : -1, held: f.held ?? 0 }) }
  return o
}
function metrics(fr, sr) {
  const n = fr.length, sec = n * HOP / sr, shown = fr.filter(f => f.midi >= 0)
  let ch = 0, last = -1, runs = [], cur = null
  for (const f of fr) {
    if (f.midi >= 0) { if (f.midi !== last) { ch++; last = f.midi }; if (cur && cur.midi === f.midi) cur.n++; else { if (cur) runs.push(cur); cur = { midi: f.midi, n: 1 } } }
    else { if (cur) runs.push(cur); cur = null }
  }
  if (cur) runs.push(cur)
  return {
    shown: +(100 * shown.length / n).toFixed(1),
    changes: +(ch / sec).toFixed(2),
    flicker: +(runs.filter(r => r.n < 5).length / sec).toFixed(2),
    impossible: +(100 * shown.filter(f => f.midi < 55).length / Math.max(1, shown.length)).toFixed(1),
    drawn: +(100 * fr.filter(f => f.midi >= 0 && f.held <= TRACE_HELD_MAX).length / Math.max(1, shown.length)).toFixed(1),
  }
}
/** 낮을수록 좋은 지표 / 높을수록 좋은 지표 */
const WORSE = { shown: (a, b) => b < a - 0.5, changes: (a, b) => b > a + 0.05, flicker: (a, b) => b > a + 0.05, impossible: (a, b) => b > a + 0.2, drawn: (a, b) => b < a - 0.5 }
const COLS = ['shown', 'changes', 'flicker', 'impossible', 'drawn']
const HEAD = { shown: '표시율%', changes: '라벨변화/초', flicker: '스침/초', impossible: '낼수없는음%', drawn: '트레이스그려짐%' }

const SIG = join(ROOT, 'test-assets', 'signals')
const synth = ['violin_A4', 'violin_A4_widevib', 'violin_scale_Amaj', 'violin_staccato_run', 'violin_gliss_A4_A5', 'violin_A4_snr10', 'violin_A4_with_clicks']
const items = synth.map(n => ({ name: n, path: join(SIG, n + '.wav') }))
if (typeof args.rec === 'string' && existsSync(args.rec)) {
  for (const f of readdirSync(args.rec).filter(f => /\.wav$/i.test(f) && !/^hum/.test(f))) {
    const p = join(args.rec, f)
    // 긴 파일은 앞 60초만
    items.push({ name: 'rec:' + basename(f, '.wav').replace(/^[0-9a-f]{8}-_+/, ''), path: p, limitSec: 60 })
  }
}
let v1 = null
if (args.v1) { const { createV1 } = await import('./lib/adapter-v1.mjs'); v1 = sr => createV1({ sampleRate: sr, skip: 4 }) }

const result = {}
for (const it of items) {
  if (!existsSync(it.path)) { console.error('없음:', it.path); continue }
  let { x, sr } = readWav(it.path)
  if (it.limitSec) x = x.subarray(0, Math.min(x.length, Math.round(it.limitSec * sr)))
  result[it.name] = metrics(run(x, sr), sr)
  if (v1) result[it.name + ' (v1)'] = metrics(run(x, sr, o => v1(o.sampleRate)), sr)
}
const base = typeof args.compare === 'string' && existsSync(args.compare) ? JSON.parse(readFileSync(args.compare, 'utf8')) : null
console.log(`| 자료 | ${COLS.map(c => HEAD[c]).join(' | ')} |`)
console.log('|---|' + COLS.map(() => '---').join('|') + '|')
let worse = 0
for (const [name, m] of Object.entries(result)) {
  const cells = COLS.map(c => {
    const b = base?.[name]?.[c]
    if (b === undefined) return String(m[c])
    const bad = WORSE[c](b, m[c]); if (bad) worse++
    return m[c] === b ? String(m[c]) : `${b} → **${m[c]}**${bad ? ' ▲' : ''}`
  })
  console.log(`| ${name} | ${cells.join(' | ')} |`)
}
if (typeof args.save === 'string') { writeFileSync(args.save, JSON.stringify(result, null, 1)); console.log('\n저장:', args.save) }
if (base) { console.log(worse ? `\n▲ 나빠진 칸 ${worse}개 — 채택 불가` : '\n회귀 없음 ✅'); process.exitCode = worse ? 1 : 0 }
