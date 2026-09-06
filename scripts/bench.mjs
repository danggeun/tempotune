#!/usr/bin/env node
// 튜너 벤치마크 — test-assets/signals/*.wav 를 알고리즘 어댑터에 흘려 지표를 낸다.
// 사용: node scripts/bench.mjs [--adapters v1,v1skip4] [--out test-assets/bench/result.md] [--json out.json]
// 왜: "다운그레이드 없음"을 수치로 증명하기 위해. 매 PR에서 이 표를 비교한다.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createV1 } from './lib/adapter-v1.mjs'
import { harmonicRel } from './lib/metrics.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SIG = join(ROOT, 'test-assets', 'signals')
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean))

const ADAPTERS = {
  v1: sr => createV1({ sampleRate: sr }),
  v1skip4: sr => createV1({ sampleRate: sr, skip: 4 }),
}
// 이후 단계에서 등록: v2 (core/pitch)
try { const m = await import('./lib/adapter-v2.mjs'); Object.assign(ADAPTERS, m.adapters) } catch (e) { if (!/Cannot find module/.test(e.message)) throw e }

const HOP = 1024, STEADY_SKIP = 0.15 // 온셋 후 0.15 s 이후를 정상 상태로 간주
const OFFSET_GRACE = 0.1 // 음 종료 후 (창 길이 + 0.1 s) 동안은 채점 제외 — 창 안에 아직 소리가 남아 있어 어떤 튜너도 알 수 없는 구간

function readWav(path) {
  const b = readFileSync(path)
  const sr = b.readUInt32LE(24), bits = b.readUInt16LE(34), ch = b.readUInt16LE(22)
  let off = 12; while (b.toString('ascii', off, off + 4) !== 'data') off += 8 + b.readUInt32LE(off + 4)
  const n = b.readUInt32LE(off + 4) / (bits / 8) / ch; const x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(off + 8 + i * ch * 2) / 32768
  return { sr, x }
}
const segAt = (segs, t) => segs.find(s => t >= s.t0 && t < s.t1)
const hzToMidi = hz => Math.round(12 * Math.log2(hz / 440)) + 69
const expectedHz = (seg, t) => seg.gliss ? seg.gliss.hz0 * Math.pow(seg.gliss.hz1 / seg.gliss.hz0, Math.max(0, Math.min(1, (t - seg.gliss.t0) / (seg.gliss.t1 - seg.gliss.t0)))) : seg.hz
const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }
const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

function runFile(adapterFactory, wavPath) {
  const { sr, x } = readWav(wavPath)
  const exp = JSON.parse(readFileSync(wavPath.replace(/\.wav$/, '.json'), 'utf8'))
  const ad = adapterFactory(sr)
  const W = ad.windowSize; const win = new Float32Array(W)
  const frames = []
  for (let end = HOP; end <= x.length; end += HOP) {
    win.fill(0); const start = Math.max(0, end - W); win.set(x.subarray(start, end), W - (end - start))
    const r = ad.process(win)
    frames.push({ t: end / sr, ...r })
  }
  // 지표
  const centsErr = [], falseNote = [], playTP = [], playFP = [], playFN = [], ms = []
  const harmKinds = new Map() // 어떤 배음 관계로 틀렸는지 (진단용)
  // 정상상태 프레임을 세 갈래로 분할한다 (합 = steadyN): 맞음(centsErr) · 배음 오류(harmN) · 표시 없음(missN).
  // 세 비율이 같은 분모를 쓰지 않으면 배음 오류가 늘 때 누락률이 함께 부풀어 오독을 부른다.
  let steadyN = 0, harmN = 0, missN = 0
  const lockLat = []; let nonPlayFrames = 0
  for (const s of exp.segments) {
    if (s.midi != null || s.gliss) {
      // 락 지연: 온셋 후 최초로 3프레임 연속 올바른 음이름
      const fs = frames.filter(f => f.t >= s.t0 && f.t < s.t1)
      let lat = null
      for (let i = 0; i + 2 < fs.length; i++) {
        const ok = k => fs[i + k].hz > 0 && hzToMidi(fs[i + k].hz) === hzToMidi(expectedHz(s, fs[i + k].t))
        if (ok(0) && ok(1) && ok(2)) { lat = fs[i].t - s.t0; break }
      }
      if (!s.gliss) lockLat.push(lat == null ? (s.t1 - s.t0) : lat) // 글리산도는 '락' 정의가 무의미 (리뷰)
    }
  }
  for (const f of frames) {
    ms.push(f.ms)
    const s = segAt(exp.segments, f.t); if (!s) continue
    const shown = f.hz > 0
    if (s.midi != null || s.gliss) {
      const eh = expectedHz(s, f.t)
      if (f.t - s.t0 >= STEADY_SKIP) {
        steadyN++
        if (shown) {
          // 배음/하위배음 관계 오류는 '센트 오차' 가 아니라 별도 종류의 실패다 (실측 발견 B3).
          // 이전에는 ±1옥타브만 셌고 나머지(2옥타브·⅓ 등)가 −2400 ¢ 같은 값으로 센트 통계를 오염시켰다.
          const rel = harmonicRel(f.hz, eh)
          if (rel) { harmN++; harmKinds.set(rel, (harmKinds.get(rel) ?? 0) + 1) }
          else centsErr.push(1200 * Math.log2(f.hz / eh))
        } else missN++ // 정상 상태인데 표시 없음 → 누락
      }
      if (s.playing) (f.playing ? playTP : playFN).push(1)
    } else {
      // 직전 소리 구간(연주/말소리) 종료 후 grace 안이면 채점 제외 (창에 소리가 남아 있음)
      const prev = exp.segments.find(p => (p.midi != null || p.gliss || p.speech) && f.t >= p.t1 && f.t < p.t1 + W / sr + OFFSET_GRACE)
      if (prev) continue
      if (!s.speech) falseNote.push(shown ? 1 : 0) // 말소리는 튜너가 음을 표시해도 오류가 아님 (연주감지 F1로만 채점)
      nonPlayFrames++; if (f.playing) playFP.push(1)
    }
  }
  const ce = centsErr.filter(v => !Number.isNaN(v))
  const tp = playTP.length, fp = playFP.length, fn = playFN.length
  const f1 = tp + fp + fn === 0 ? NaN : 2 * tp / (2 * tp + fp + fn)
  return {
    file: basename(wavPath, '.wav'), kind: exp.kind, frames: frames.length,
    centsBias: median(ce), centsP90: pct(ce.map(Math.abs), .9), missingPct: steadyN ? 100 * missN / steadyN : NaN,
    harmPct: steadyN ? 100 * harmN / steadyN : NaN,
    harmKinds: [...harmKinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' '),
    falseNotePct: falseNote.length ? 100 * falseNote.reduce((a, b) => a + b, 0) / falseNote.length : NaN,
    lockMs: lockLat.length ? 1000 * median(lockLat) : NaN,
    playF1: f1, falsePlayPct: nonPlayFrames ? 100 * playFP.length / nonPlayFrames : NaN, timeErrPct: tp + fn ? 100 * (fp + fn) / (tp + fn) : NaN, msP95: pct(ms, .95),
  }
}

const f = v => Number.isNaN(v) ? '—' : (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))
function summarize(rows) {
  // 종류(kind)별 중앙값을 먼저 구하고 그 중앙값들의 중앙값 — 2초 단음 파일 20개가 요약을 지배하지 않도록 (리뷰)
  const kinds = [...new Set(rows.map(r => r.kind))]
  const by = k => kinds.map(kind => median(rows.filter(r => r.kind === kind).map(r => r[k]).filter(v => !Number.isNaN(v)))).filter(v => !Number.isNaN(v))
  // 파일 간 요약은 중앙값 (snr0 같은 극단 스트레스 파일이 평균을 지배하지 않도록). 표는 파일별 상세를 그대로 보여준다.
  return { centsBiasAbs: median(by('centsBias').map(Math.abs)), centsP90: median(by('centsP90')), missingPct: median(by('missingPct')), harmPct: median(by('harmPct')), falseNotePct: median(by('falseNotePct')), lockMs: median(by('lockMs')), playF1: median(by('playF1')), timeErrPct: median(by('timeErrPct')), msP95: pct(by('msP95'), .95) }
}

const names = (typeof args.adapters === 'string' ? args.adapters : 'v1').split(',')
const files = readdirSync(SIG).filter(n => n.endsWith('.wav')).sort().map(n => join(SIG, n))
let md = `# 튜너 벤치마크\n\n생성: ${new Date().toISOString().slice(0, 10)} · 신호 ${files.length}개 · hop ${HOP} · 정상상태 판정 온셋+${STEADY_SKIP}s\n\n`
md += `지표: bias=정상상태 cents 오차 중앙값(부호), p90=|오차| 90퍼센타일, miss=정상상태인데 표시 없음 %(분모=정상상태 프레임 전체), harm=배음 관계 오류 %(×2·÷2·÷3·÷4… 전부. 같은 분모. 이 프레임은 센트 통계에서 제외), false=비연주 구간에 음 표시 %, lock=온셋→올바른 음이름 3프레임 연속 (ms, 중앙값), F1=연주감지, fPlay=비연주 구간을 연주로 본 %, tErr=연주시간 계산 오차 %((FP+FN)/실제), ms=프레임 처리시간 p95\n\n`
const all = {}
for (const name of names) {
  const rows = files.map(p => runFile(ADAPTERS[name], p))
  all[name] = rows
  const s = summarize(rows)
  md += `## ${name}\n\n**요약(종류별 중앙값의 중앙값)**: |bias| ${f(s.centsBiasAbs)}¢ · p90 ${f(s.centsP90)}¢ · miss ${f(s.missingPct)}% · harm ${f(s.harmPct)}% · false ${f(s.falseNotePct)}% · lock ${f(s.lockMs)} ms · F1 ${f(s.playF1)} · tErr ${f(s.timeErrPct)}% · ${f(s.msP95)} ms\n\n`
  md += `| 파일 | 종류 | bias¢ | p90¢ | miss% | harm% | false% | lock ms | F1 | fPlay% | tErr% | ms |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`
  for (const r of rows) md += `| ${r.file} | ${r.kind} | ${f(r.centsBias)} | ${f(r.centsP90)} | ${f(r.missingPct)} | ${f(r.harmPct)} | ${f(r.falseNotePct)} | ${f(r.lockMs)} | ${f(r.playF1)} | ${f(r.falsePlayPct)} | ${f(r.timeErrPct)} | ${f(r.msP95)} |\n`
  md += '\n'
}
const out = typeof args.out === 'string' ? args.out : join(ROOT, 'test-assets', 'bench', 'latest.md')
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, md)
if (typeof args.json === 'string') writeFileSync(args.json, JSON.stringify(all, null, 1))
console.log(md)
