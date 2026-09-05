#!/usr/bin/env node
// 합성 현악기 테스트 신호 생성기
// 왜: 실제 녹음 없이 튜너/연주감지를 수치로 검증하기 위해. 순수 사인파는 실제 악기의
//     어려움(배음, 비브라토, 활 잡음, 어택)을 재현하지 못하므로 물리적으로 그럴듯한 톤을 만든다.
// 출력: test-assets/signals/<name>.wav (mono 16-bit 44.1k) + <name>.json (시간축 정답)
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-assets', 'signals')
mkdirSync(OUT, { recursive: true })
const SR = 44100

// ── 결정적 난수 (재현 가능) ──
let seed = 12345
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000 }
const randn = () => { let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }

// ── 기본 블록 ──
function silence(sec) { return new Float32Array(Math.round(sec * SR)) }
function concat(...parts) {
  const n = parts.reduce((s, p) => s + p.length, 0); const out = new Float32Array(n); let o = 0
  for (const p of parts) { out.set(p, o); o += p.length } return out
}
function envelope(n, attack, release) {
  const env = new Float32Array(n); const a = Math.round(attack * SR), r = Math.round(release * SR)
  for (let i = 0; i < n; i++) {
    let e = 1
    if (i < a) e = i / a
    if (i > n - r) e = Math.min(e, (n - i) / r)
    env[i] = e
  }
  return env
}
// 1차 고역 통과 잡음 (활 잡음 모사)
function bowNoise(n, gainDb) {
  const g = Math.pow(10, gainDb / 20); const out = new Float32Array(n); let prev = 0, prevIn = 0
  for (let i = 0; i < n; i++) { const x = randn(); const y = 0.95 * (prev + x - prevIn); prevIn = x; prev = y; out[i] = y * g * 0.3 }
  return out
}
function pinkNoise(n, gain = 1) {
  // Paul Kellet 근사
  const out = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < n; i++) {
    const w = randn() * 0.1
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520
    b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11 * gain; b6 = w * 0.115926
  }
  return out
}
function whiteNoise(n, gain = 1) { const out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = randn() * 0.3 * gain; return out }

/**
 * 활 현악기 톤. f0 함수(시간→Hz)를 받아 배음 합성.
 * - 배음 진폭 1/n^1.1 (톱니에 가까운 스펙트럼), 짝수 배음 -2 dB
 * - 비브라토: vibHz, vibCents (0이면 없음), 시작 후 vibDelay 초부터
 * - 미세 지터: jitterCents (연주자 손 흔들림)
 * - 활 잡음 noiseDb
 */
function bowed(f0Fn, sec, { vibHz = 5.5, vibCents = 15, vibDelay = 0.25, jitterCents = 2, noiseDb = -30, attack = 0.08, release = 0.2, nHarm = 20, amp = 0.35, harmAmp = null } = {}) {
  const n = Math.round(sec * SR); const out = new Float32Array(n)
  let phase = 0; let jitter = 0
  const env = envelope(n, attack, release)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    jitter = jitter * 0.999 + randn() * 0.001 * jitterCents
    const vib = t > vibDelay ? vibCents * Math.sin(2 * Math.PI * vibHz * (t - vibDelay)) : 0
    const f = f0Fn(t) * Math.pow(2, (vib + jitter) / 1200)
    phase += 2 * Math.PI * f / SR
    let s = 0
    for (let h = 1; h <= nHarm; h++) {
      if (f * h > SR * 0.45) break
      const a = harmAmp ? harmAmp(h) : Math.pow(h, -1.1) * (h % 2 === 0 ? 0.79 : 1)
      s += a * Math.sin(phase * h)
    }
    out[i] = s * amp * env[i]
  }
  const noise = bowNoise(n, noiseDb)
  for (let i = 0; i < n; i++) out[i] += noise[i] * env[i]
  return out
}
function mix(a, b, gainB = 1) { const n = Math.max(a.length, b.length); const out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = (a[i] || 0) + (b[i] || 0) * gainB; return out }
function rms(x) { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length) }
function scaleToSnr(signal, noise, snrDb) { const g = rms(signal) / (rms(noise) * Math.pow(10, snrDb / 20)); return mix(signal, noise, g) }

// ── WAV 쓰기 ──
function writeWav(name, x) {
  const n = x.length; const ab = Buffer.alloc(44 + n * 2)
  ab.write('RIFF', 0); ab.writeUInt32LE(36 + n * 2, 4); ab.write('WAVE', 8); ab.write('fmt ', 12)
  ab.writeUInt32LE(16, 16); ab.writeUInt16LE(1, 20); ab.writeUInt16LE(1, 22); ab.writeUInt32LE(SR, 24)
  ab.writeUInt32LE(SR * 2, 28); ab.writeUInt16LE(2, 32); ab.writeUInt16LE(16, 34); ab.write('data', 36); ab.writeUInt32LE(n * 2, 40)
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v))
  const norm = peak > 0.95 ? 0.95 / peak : 1
  for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, x[i] * norm)); ab.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), 44 + i * 2) }
  writeFileSync(join(OUT, name + '.wav'), ab)
}
function writeExpected(name, segments, meta = {}) {
  writeFileSync(join(OUT, name + '.json'), JSON.stringify({ sr: SR, ...meta, segments }, null, 2))
}

// ── 음 이름 도우미 ──
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12)
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }
const n2m = s => { const m = s.match(/^([A-G]#?)(-?\d)$/); return NOTE[m[1]] + (parseInt(m[2]) + 1) * 12 }

// ── 세트 1: 단음 (악기별 개방현 + 극단) ──
const single = [
  ['violin_G3', 'G3'], ['violin_D4', 'D4'], ['violin_A4', 'A4'], ['violin_E5', 'E5'], ['violin_E6_harmonic', 'E6'],
  ['viola_C3', 'C3'], ['cello_C2', 'C2'], ['cello_G2', 'G2'], ['cello_D3', 'D3'], ['cello_A3', 'A3'],
  ['bass_E1', 'E1'], ['bass_A1', 'A1'],
]
for (const [name, note] of single) {
  const m = n2m(note), f = midiHz(m)
  const tone = bowed(() => f, 2.0)
  const x = concat(silence(0.3), tone, silence(0.3))
  writeWav(name, x)
  writeExpected(name, [
    { t0: 0, t1: 0.3, midi: null, playing: false },
    { t0: 0.3, t1: 2.3, midi: m, hz: f, playing: true },
    { t0: 2.3, t1: 2.6, midi: null, playing: false },
  ], { kind: 'single', note })
}

// 비브라토 없음 / 강한 비브라토 / 느린 어택 변형 (A4)
{
  const f = 440
  writeWav('violin_A4_novib', concat(silence(0.3), bowed(() => f, 2, { vibCents: 0 }), silence(0.3)))
  writeExpected('violin_A4_novib', [{ t0: 0, t1: .3, midi: null, playing: false }, { t0: .3, t1: 2.3, midi: 69, hz: f, playing: true }, { t0: 2.3, t1: 2.6, midi: null, playing: false }], { kind: 'single' })
  writeWav('violin_A4_widevib', concat(silence(0.3), bowed(() => f, 2, { vibCents: 30, vibHz: 6.5 }), silence(0.3)))
  writeExpected('violin_A4_widevib', [{ t0: 0, t1: .3, midi: null, playing: false }, { t0: .3, t1: 2.3, midi: 69, hz: f, playing: true, vibCents: 30 }, { t0: 2.3, t1: 2.6, midi: null, playing: false }], { kind: 'single' })
  writeWav('violin_A4_slowattack', concat(silence(0.3), bowed(() => f, 2, { attack: 0.3 }), silence(0.3)))
  writeExpected('violin_A4_slowattack', [{ t0: 0, t1: .3, midi: null, playing: false }, { t0: .3, t1: 2.3, midi: 69, hz: f, playing: true }, { t0: 2.3, t1: 2.6, midi: null, playing: false }], { kind: 'single' })
  // 살짝 낮게/높게 조율된 음 (cents 정확도)
  for (const c of [-20, -7, 7, 20]) {
    const fc = f * Math.pow(2, c / 1200); const nm = 'violin_A4_' + (c > 0 ? 'p' : 'm') + Math.abs(c)
    writeWav(nm, concat(silence(0.3), bowed(() => fc, 2, { vibCents: 0 }), silence(0.3)))
    writeExpected(nm, [{ t0: 0, t1: .3, midi: null, playing: false }, { t0: .3, t1: 2.3, midi: 69, hz: fc, cents: c, playing: true }, { t0: 2.3, t1: 2.6, midi: null, playing: false }], { kind: 'single' })
  }
}

// ── 세트 2: 스케일 (락 지연, 음 전환) ──
{
  const notes = ['A4', 'B4', 'C#5', 'D5', 'E5', 'F#5', 'G#5', 'A5'] // A장조
  const dur = 0.5; const parts = [silence(0.3)]; const segs = [{ t0: 0, t1: 0.3, midi: null, playing: false }]
  let t = 0.3
  for (const nt of notes) { const m = n2m(nt); parts.push(bowed(() => midiHz(m), dur, { attack: .03, release: .04, vibDelay: .15 })); segs.push({ t0: t, t1: t + dur, midi: m, hz: midiHz(m), playing: true }); t += dur }
  parts.push(silence(0.3)); segs.push({ t0: t, t1: t + .3, midi: null, playing: false })
  writeWav('violin_scale_Amaj', concat(...parts)); writeExpected('violin_scale_Amaj', segs, { kind: 'scale' })

  const cn = ['C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'B2', 'C3']
  const p2 = [silence(0.3)]; const s2 = [{ t0: 0, t1: 0.3, midi: null, playing: false }]; t = 0.3
  for (const nt of cn) { const m = n2m(nt); p2.push(bowed(() => midiHz(m), dur, { attack: .05, release: .05, vibDelay: .2 })); s2.push({ t0: t, t1: t + dur, midi: m, hz: midiHz(m), playing: true }); t += dur }
  p2.push(silence(0.3)); s2.push({ t0: t, t1: t + .3, midi: null, playing: false })
  writeWav('cello_scale_Cmaj', concat(...p2)); writeExpected('cello_scale_Cmaj', s2, { kind: 'scale' })

  // 글리산도 (연속 추적)
  const g = bowed(tt => 440 * Math.pow(2, Math.min(1, tt / 2) * 12 / 12), 2.2, { vibCents: 0 })
  writeWav('violin_gliss_A4_A5', concat(silence(.3), g, silence(.3)))
  writeExpected('violin_gliss_A4_A5', [{ t0: 0, t1: .3, midi: null, playing: false }, { t0: .3, t1: 2.5, gliss: { hz0: 440, hz1: 880, t0: .3, t1: 2.3 }, playing: true }, { t0: 2.5, t1: 2.8, midi: null, playing: false }], { kind: 'gliss' })
}

// ── 세트 3: 방해 신호 (오검출) ──
{
  writeWav('noise_white', whiteNoise(Math.round(2 * SR), 0.3)); writeExpected('noise_white', [{ t0: 0, t1: 2, midi: null, playing: false }], { kind: 'noise' })
  writeWav('noise_pink', pinkNoise(Math.round(2 * SR), 1.5)); writeExpected('noise_pink', [{ t0: 0, t1: 2, midi: null, playing: false }], { kind: 'noise' })
  writeWav('silence_lowfloor', mix(silence(Math.round(2 * SR) / SR), whiteNoise(Math.round(2 * SR), 0.003))); writeExpected('silence_lowfloor', [{ t0: 0, t1: 2, midi: null, playing: false }], { kind: 'noise' })

  // 말소리 모사: f0가 100~250 Hz 사이를 랜덤워크, 150~300 ms 음절, 사이에 무성 잡음/무음
  const parts = []; const segs = []; let t = 0; let f = 160
  for (let k = 0; k < 10; k++) {
    const d = 0.15 + rand() * 0.15
    f = Math.max(100, Math.min(250, f * Math.pow(2, (rand() - .5) * 0.6)))
    const f0 = f; const drift = (rand() - .5) * 0.5
    parts.push(bowed(tt => f0 * Math.pow(2, drift * tt / d), d, { vibCents: 0, attack: .02, release: .03, nHarm: 12, noiseDb: -20 }))
    segs.push({ t0: t, t1: t + d, midi: null, playing: false, speech: true }); t += d
    const gap = 0.05 + rand() * 0.15
    parts.push(rand() < 0.5 ? whiteNoise(Math.round(gap * SR), 0.08) : silence(gap))
    segs.push({ t0: t, t1: t + gap, midi: null, playing: false }); t += gap
  }
  writeWav('speech_like', concat(...parts)); writeExpected('speech_like', segs, { kind: 'speech' })

  // SNR 세트: A4 + 핑크 잡음
  const tone = concat(silence(.3), bowed(() => 440, 2), silence(.3))
  for (const snr of [20, 10, 0]) {
    const nm = 'violin_A4_snr' + snr
    writeWav(nm, scaleToSnr(tone, pinkNoise(tone.length, 1), snr))
    writeExpected(nm, [{ t0: 0, t1: .3, midi: null, playing: false, noisy: true }, { t0: .3, t1: 2.3, midi: 69, hz: 440, playing: true, snr }, { t0: 2.3, t1: 2.6, midi: null, playing: false, noisy: true }], { kind: 'snr', snr })
  }

  // 메트로놈 클릭 혼입 (스피커→마이크 누설 모사): A4 + 80 BPM 클릭
  const clicks = new Float32Array(tone.length); const period = Math.round(60 / 80 * SR)
  for (let s = 0; s < clicks.length; s += period) for (let i = 0; i < 0.03 * SR && s + i < clicks.length; i++) clicks[s + i] = Math.sin(2 * Math.PI * 1800 * i / SR) * Math.exp(-i / (0.006 * SR)) * 0.5
  writeWav('violin_A4_with_clicks', mix(tone, clicks))
  writeExpected('violin_A4_with_clicks', [{ t0: 0, t1: .3, midi: null, playing: false, clicks: true }, { t0: .3, t1: 2.3, midi: 69, hz: 440, playing: true, clicks: true }, { t0: 2.3, t1: 2.6, midi: null, playing: false, clicks: true }], { kind: 'clicks', bpm: 80 })

  // 참조: 순수 사인파 (하네스 자체 검증용 — 여기서 오차가 0에 가깝지 않으면 하네스 버그)
  const sine = new Float32Array(Math.round(2 * SR)); for (let i = 0; i < sine.length; i++) sine[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR)
  writeWav('ref_sine_A4', sine); writeExpected('ref_sine_A4', [{ t0: 0, t1: 2, midi: 69, hz: 440, playing: true }], { kind: 'ref' })
}

// ── 세트 4: 리뷰에서 추가된 현실 시나리오 ──
{
  const seg = (m, playing = true) => ({ midi: m, hz: midiHz(m), playing })
  const single = (name, tone, m, meta = {}) => { writeWav(name, concat(silence(.3), tone, silence(.3))); writeExpected(name, [{ t0: 0, t1: .3, midi: null, playing: false }, { t0: .3, t1: .3 + tone.length / SR, ...seg(m) }, { t0: .3 + tone.length / SR, t1: .6 + tone.length / SR, midi: null, playing: false }], { kind: 'realistic', ...meta }) }
  // 기본음이 약한 저음현 (폰 마이크 HPF): 기본음 −30 dB
  const weak = h => (h === 1 ? 0.03 : Math.pow(h, -1.1))
  single('cello_C2_weakfund', bowed(() => midiHz(n2m('C2')), 2, { harmAmp: weak }), n2m('C2'), { note: 'C2 weak fundamental' })
  single('bass_E1_weakfund', bowed(() => midiHz(n2m('E1')), 2, { harmAmp: weak }), n2m('E1'), { note: 'E1 weak fundamental' })
  single('violin_G3_weakfund', bowed(() => midiHz(n2m('G3')), 2, { harmAmp: weak }), n2m('G3'), { note: 'G3 weak fundamental' })
  // 공명하는 개방현: 스톱한 G3 + 개방 G2 가 −20 dB 로 울림
  const g3 = bowed(() => midiHz(n2m('G3')), 2), g2ring = bowed(() => midiHz(n2m('G2')), 2, { vibCents: 0, noiseDb: -60 })
  single('cello_G3_with_openG2_ringing', mix(g3, g2ring, 0.1), n2m('G3'), { note: 'sympathetic open string −20 dB' })
  // 플라졸렛(자연 하모닉스): 배음 1~2개만
  single('violin_E6_flageolet', bowed(() => midiHz(n2m('E6')), 2, { harmAmp: h => (h === 1 ? 1 : h === 2 ? 0.15 : 0), vibCents: 0, noiseDb: -40 }), n2m('E6'), { note: 'flageolet 1–2 partials' })
  // 스타카토 런 + 쉼표: 120 bpm 8분음표(150 ms 소리 + 100 ms 공백), 중간에 8분 쉼표(250 ms)
  {
    const notes = ['A4', 'B4', 'C#5', 'D5', null, 'E5', 'F#5', 'G#5', 'A5', null, 'A4', 'B4', 'C#5', 'D5']
    const parts = [silence(.3)], segs = [{ t0: 0, t1: .3, midi: null, playing: false }]; let t = .3
    for (const nt of notes) {
      if (nt === null) { parts.push(silence(.25)); segs.push({ t0: t, t1: t + .25, midi: null, playing: false, rest: true }); t += .25; continue }
      const m = n2m(nt); parts.push(bowed(() => midiHz(m), .15, { attack: .015, release: .04, vibCents: 0 })); segs.push({ t0: t, t1: t + .15, ...seg(m) }); t += .15
      parts.push(silence(.1)); segs.push({ t0: t, t1: t + .1, midi: null, playing: false, gap: true }); t += .1
    }
    parts.push(silence(.3)); segs.push({ t0: t, t1: t + .3, midi: null, playing: false })
    writeWav('violin_staccato_run', concat(...parts)); writeExpected('violin_staccato_run', segs, { kind: 'realistic', note: 'staccato 150 ms + 100 ms gaps + rests' })
  }
  // 긴 모음 말소리: 400–600 ms 음절 (사람이 "아——" 하듯), 음절 간 피치 점프
  {
    const parts = [], segs = []; let t = 0, f = 140
    for (let k = 0; k < 6; k++) {
      const d = 0.4 + rand() * 0.2; f = Math.max(100, Math.min(250, f * Math.pow(2, (rand() - .5) * 0.6))); const f0 = f, drift = (rand() - .5) * 0.4
      parts.push(bowed(tt => f0 * Math.pow(2, drift * tt / d), d, { vibCents: 0, attack: .03, release: .05, nHarm: 12, noiseDb: -20 }))
      segs.push({ t0: t, t1: t + d, midi: null, playing: false, speech: true }); t += d
      const gap = 0.08 + rand() * 0.12; parts.push(rand() < .5 ? whiteNoise(Math.round(gap * SR), 0.08) : silence(gap)); segs.push({ t0: t, t1: t + gap, midi: null, playing: false }); t += gap
    }
    writeWav('speech_long_vowels', concat(...parts)); writeExpected('speech_long_vowels', segs, { kind: 'speech', note: '400–600 ms vowels' })
  }

  // 억양 있는 말소리: 음절 안에서 피치가 60~150¢ 단조 이동 (실제 대화의 억양 윤곽), 음절 150–300 ms
  {
    const parts = [], segs = []; let t = 0, f = 160
    for (let k = 0; k < 10; k++) {
      const d = 0.15 + rand() * 0.15
      f = Math.max(100, Math.min(250, f * Math.pow(2, (rand() - .5) * 0.6))); const f0 = f, move = (rand() < .5 ? -1 : 1) * (60 + rand() * 90) / 1200
      parts.push(bowed(tt => f0 * Math.pow(2, move * tt / d), d, { vibCents: 0, attack: .02, release: .03, nHarm: 12, noiseDb: -20 }))
      segs.push({ t0: t, t1: t + d, midi: null, playing: false, speech: true }); t += d
      const gap = 0.05 + rand() * 0.15; parts.push(rand() < .5 ? whiteNoise(Math.round(gap * SR), 0.08) : silence(gap)); segs.push({ t0: t, t1: t + gap, midi: null, playing: false }); t += gap
    }
    writeWav('speech_intonation', concat(...parts)); writeExpected('speech_intonation', segs, { kind: 'speech', note: 'intonation 60–150¢ per syllable' })
  }
  // 48 kHz (Android 기본 샘플레이트) — 같은 A4 톤을 48 k 로 렌더
  {
    const SR48 = 48000, n = Math.round(2 * SR48), out = new Float32Array(n); let ph = 0
    for (let i = 0; i < n; i++) { const vib = i / SR48 > .25 ? 15 * Math.sin(2 * Math.PI * 5.5 * (i / SR48 - .25)) : 0; ph += 2 * Math.PI * 440 * Math.pow(2, vib / 1200) / SR48; let s = 0; for (let h = 1; h <= 20; h++) s += Math.pow(h, -1.1) * Math.sin(ph * h); out[i] = 0.35 * s * Math.min(1, i / (0.08 * SR48), (n - i) / (0.2 * SR48)) }
    const x = new Float32Array(Math.round(.3 * SR48) + n + Math.round(.3 * SR48)); x.set(out, Math.round(.3 * SR48))
    const ab = Buffer.alloc(44 + x.length * 2)
    ab.write('RIFF', 0); ab.writeUInt32LE(36 + x.length * 2, 4); ab.write('WAVE', 8); ab.write('fmt ', 12); ab.writeUInt32LE(16, 16); ab.writeUInt16LE(1, 20); ab.writeUInt16LE(1, 22); ab.writeUInt32LE(SR48, 24); ab.writeUInt32LE(SR48 * 2, 28); ab.writeUInt16LE(2, 32); ab.writeUInt16LE(16, 34); ab.write('data', 36); ab.writeUInt32LE(x.length * 2, 40)
    for (let i = 0; i < x.length; i++) ab.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 0x7fff), 44 + i * 2)
    writeFileSync(join(OUT, 'violin_A4_48k.wav'), ab)
    writeFileSync(join(OUT, 'violin_A4_48k.json'), JSON.stringify({ sr: SR48, kind: 'realistic', note: '48 kHz', segments: [{ t0: 0, t1: .3, midi: null, playing: false }, { t0: .3, t1: 2.3, midi: 69, hz: 440, playing: true }, { t0: 2.3, t1: 2.6, midi: null, playing: false }] }, null, 2))
  }
}

console.log('signals written to', OUT)
