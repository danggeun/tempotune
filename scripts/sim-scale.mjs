#!/usr/bin/env node
// 스케일 시뮬레이션 — 도레미파솔라시도시라솔파미레도 를 합성해 **실제 분석기**(core/pitch/analyzer.ts, 워커와 같은 코드)에
// 통과시키고, 화면에 그려질 (cents, midi) 프레임 열과 통계를 낸다.
// 사용: node scripts/sim-scale.mjs [--bpm 80] [--err 5] [--vib 10] [--json out.json]
// 왜: "음정을 정확히 짚었으면 트레이스가 가운데 근처에만 머물러야 한다. 음 바뀔 때 벗어나거나 끊기면 안 된다."
//     — 이 요구가 실제로 만족되는지, 벗어난다면 어디서 벗어나는지(어택/트래커 전환/평활) 프레임 단위로 본다.
import { createAnalyzer } from '../www/src/core/pitch/analyzer.ts'
import { writeFileSync } from 'node:fs'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(Boolean))
const SR = 44100, HOP = 1024, WIN = 4096
const BPM = +(args.bpm || 80)
const ERR_MAX = +(args.err ?? 5)      // 음당 음정 오차 최대 (¢) — '잘 친 경우'
const VIB = +(args.vib ?? 10)          // 비브라토 진폭 (¢), 0 이면 없음
const REF = 442

// 결정적 난수
let seed = 20260913
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000 }
const randn = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }

// 라장조 한 옥타브 왕복 (바이올린 D현~A현: 레 미 파♯ 솔 라 시 도♯ 레) — '도레미파솔라시도' 를 계이름으로 부른 것
const UP = [62, 64, 66, 67, 69, 71, 73, 74]
const SEQ = [...UP, ...UP.slice(0, 7).reverse()] // 15음: 올라갔다 내려온다
const KR = ['도', '레', '미', '파', '솔', '라', '시', '도↑', '시', '라', '솔', '파', '미', '레', '도']
const noteSec = 60 / BPM                      // 4분음표
const midiHz = m => REF * Math.pow(2, (m - 69) / 12)

// ── 합성: 활을 바꿔 이어 켜는 레가토 스케일 ──
const total = Math.round((SEQ.length * noteSec + 0.6) * SR)
const x = new Float32Array(total)
const truth = []                                // 각 음의 시작/끝/의도한 midi/의도한 오차
let phase = 0, jit = 0
const errs = SEQ.map(() => Math.round((rand() * 2 - 1) * ERR_MAX))
for (let i = 0; i < total; i++) {
  const t = i / SR - 0.3                        // 앞 0.3 s 무음
  if (t < 0 || t >= SEQ.length * noteSec) { x[i] = 0; continue }
  const k = Math.min(SEQ.length - 1, Math.floor(t / noteSec))
  const tn = t - k * noteSec                    // 음 안에서의 시각
  // 음 전환: 손가락이 짚히는 25 ms 동안만 이전 음에서 미끄러진다 (레가토 스케일의 현실)
  const SLIDE = 0.025
  const prevM = k > 0 ? SEQ[k - 1] + errs[k - 1] / 100 : SEQ[k] + errs[k] / 100
  const curM = SEQ[k] + errs[k] / 100
  const m = tn < SLIDE && k > 0 ? prevM + (curM - prevM) * (tn / SLIDE) : curM
  jit = jit * 0.999 + randn() * 0.002           // 활·손의 미세 흔들림
  const vib = VIB && tn > 0.15 ? VIB * Math.sin(2 * Math.PI * 5.5 * (tn - 0.15)) : 0
  const f = midiHz(m) * Math.pow(2, (vib + jit) / 1200)
  phase += 2 * Math.PI * f / SR
  // 활 바꿈: 각 음 앞뒤 25 ms 페이드 (소리가 끊기지는 않는다)
  const env = Math.min(1, tn / 0.025, (noteSec - tn) / 0.025) * 0.9 + 0.1
  let s = 0
  for (let h = 1; h <= 20; h++) { if (f * h > SR * 0.45) break; s += Math.pow(h, -1.1) * (h % 2 === 0 ? 0.79 : 1) * Math.sin(phase * h) }
  x[i] = s * 0.3 * env + randn() * 0.004 * env  // 활 잡음
  if (tn < 1 / SR + 1e-9) truth.push({ k, t0: t + 0.3, midi: SEQ[k], err: errs[k], name: KR[k] })
}

// ── 실제 분석기 ──
const an = createAnalyzer({ sampleRate: SR, windowSize: WIN })
an.setSettings({ rmsMin: .014, smoothing: .12, refHz: REF, tolCents: 15 })
const frames = []
const win = new Float32Array(WIN)
for (let s = 0; s + WIN <= total; s += HOP) {
  win.set(x.subarray(s, s + WIN))
  const f = an.process(win)
  // 앱과 같은 규칙: 유지(held) 프레임은 트레이스에 쌓지 않는다 (ui/tuner.ts)
  const off = f.hz <= 0 || f.held >= 1
  // rawCents/rawMidi = 걸러내기 전 값 (v2.0.1 이 그리던 것 — 전/후 비교용)
  frames.push({ t: (s + WIN) / SR, cents: off ? null : f.cents, midi: off ? null : f.midi, rawCents: f.hz > 0 ? f.cents : null, rawMidi: f.hz > 0 ? f.midi : null, hz: f.hz, held: f.held })
}

// ── 통계 ──
const shown = frames.filter(f => f.cents !== null)
const abs = shown.map(f => Math.abs(f.cents)).sort((a, b) => a - b)
const pct = p => abs.length ? abs[Math.min(abs.length - 1, Math.floor(abs.length * p))] : NaN
// 라벨 전환 지점
const trans = []
for (let i = 1; i < frames.length; i++) {
  const a = frames[i - 1], b = frames[i]
  if (a.midi !== null && b.midi !== null && a.midi !== b.midi) trans.push({ i, t: b.t, from: a.midi, to: b.midi, c0: a.cents, c1: b.cents, d: Math.abs(b.cents - a.cents) })
}
const wrongLabel = shown.filter(f => { const k = Math.min(SEQ.length - 1, Math.floor((f.t - 0.3 - 0.046) / noteSec)); return k >= 0 && SEQ[k] !== undefined && f.midi !== SEQ[k] }).length

console.log(`# 스케일 시뮬레이션 — ${KR.join(' ')} · ${BPM} BPM · 음당 ${noteSec.toFixed(2)}s · 음정 오차 ±${ERR_MAX} ¢ · 비브라토 ±${VIB} ¢`)
console.log(`\n프레임 ${frames.length} (표시 ${shown.length}, ${(100 * shown.length / frames.length).toFixed(1)} %)  ·  A=${REF}  ·  in-tune 범위 ±15 ¢`)
console.log(`\n## 화면에 뜨는 오차(|cents|)`)
console.log(`중앙값 ${pct(.5)} ¢ · 75 % ${pct(.75)} ¢ · 90 % ${pct(.90)} ¢ · 99 % ${pct(.99)} ¢ · 최대 ${abs[abs.length - 1]} ¢`)
console.log(`±15 ¢(초록 띠) 안에 머문 프레임: ${(100 * shown.filter(f => Math.abs(f.cents) <= 15).length / shown.length).toFixed(1)} %`)
console.log(`±25 ¢ 안: ${(100 * shown.filter(f => Math.abs(f.cents) <= 25).length / shown.length).toFixed(1)} %`)
console.log(`\n## 음이름 라벨`)
console.log(`전환 ${trans.length}회 (실제 음 바뀜 ${SEQ.length - 1}회) · 라벨이 틀린 프레임 ${wrongLabel} (${(100 * wrongLabel / shown.length).toFixed(1)} %)`)
console.log(`\n| # | 시각 | 전환 | 직전 ¢ | 직후 ¢ | Δ¢ | 양쪽 다 띠 밖 + 반대편? |`)
console.log(`|---|---|---|---|---|---|---|`)
for (const tr of trans) {
  const opposite = (tr.c0 > 15 && tr.c1 < -15) || (tr.c0 < -15 && tr.c1 > 15)
  console.log(`| ${tr.i} | ${tr.t.toFixed(2)}s | ${tr.from}→${tr.to} | ${tr.c0 > 0 ? '+' : ''}${tr.c0} | ${tr.c1 > 0 ? '+' : ''}${tr.c1} | ${tr.d} | ${opposite ? '**예 (가짜 통과선)**' : '아니오'} |`)
}
const dmax = trans.length ? Math.max(...trans.map(t => t.d)) : 0
console.log(`\n전환에서의 Δ¢: 최대 ${dmax} · 평균 ${trans.length ? (trans.reduce((s, t) => s + t.d, 0) / trans.length).toFixed(1) : 0}`)
console.log(`가짜 통과선이 생기는 전환: ${trans.filter(t => (t.c0 > 15 && t.c1 < -15) || (t.c0 < -15 && t.c1 > 15)).length} / ${trans.length}`)
if (args.json) writeFileSync(args.json, JSON.stringify({ bpm: BPM, errMax: ERR_MAX, vib: VIB, seq: SEQ, kr: KR, errs, frames }, null, 0))
