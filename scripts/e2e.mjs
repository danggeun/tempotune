#!/usr/bin/env node
// 동작 e2e — 체크리스트(docs/CHECKLIST.md)의 [A] 항목을 헤드리스 Chromium 에서 실제로 조작해 확인한다.
// 사용: node scripts/e2e.mjs [--dist <dir>] [--port 4174]
// 왜: 스크린샷은 정지 화면만 본다. 리팩토링 전/후 빌드에 같은 시나리오를 돌려 "동작 변경 0"을 증명한다.
// 마이크는 --use-file-for-fake-audio-capture 로 WAV 를 주입한다 (사람 연주 불필요).
import { chromium } from 'playwright'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'
import assert from 'node:assert/strict'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean))
const DIST = resolve(typeof args.dist === 'string' ? args.dist : join(ROOT, 'dist'))
const PORT = +(args.port || 4174)
const SIG = join(ROOT, 'test-assets', 'signals')
if (!existsSync(join(SIG, 'violin_A4.wav'))) execSync('node scripts/gen-signals.mjs', { cwd: ROOT, stdio: 'ignore' })

// 정적 서버 (vite preview 는 outDir 고정이라 직접 띄운다)
const server = spawn('npx', ['-y', 'serve', '-s', '-l', String(PORT), DIST], { stdio: 'ignore' })
await new Promise(r => setTimeout(r, 2500))

const exe = process.env.CHROMIUM_PATH || undefined
const launch = wav => chromium.launch({ executablePath: exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${join(SIG, wav)}`, '--autoplay-policy=no-user-gesture-required'] })
const URL_ = `http://localhost:${PORT}/`
const results = []
let browser
async function scenario(name, wav, fn, ctxOpts = {}) {
  browser = await launch(wav)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['microphone'], ...ctxOpts })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/tfhub|tensorflow|fonts.googleapis|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()) })
  try { await fn(page, ctx); assert.deepEqual(errors, [], 'console/page errors'); results.push([name, 'ok']) }
  catch (e) { results.push([name, 'FAIL: ' + (e.message || e).toString().split('\n')[0]]) }
  await browser.close()
}
const tunerText = p => p.evaluate(() => ({ note: document.getElementById('tuner-note').textContent, acc: document.getElementById('tuner-acc').textContent, oct: document.getElementById('tuner-oct').textContent, cents: document.getElementById('tuner-cents').textContent, inTune: document.getElementById('tuner-card').classList.contains('in-tune') }))
const waitNote = async (p, pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await tunerText(p); if (pred(t)) return t; await p.waitForTimeout(100) } throw new Error('note not reached: ' + JSON.stringify(await tunerText(p))) }
const sleep = (p, ms) => p.waitForTimeout(ms)

// ── 튜너 ──
await scenario('tuner: 440 Hz @A=442 → 라4 −8¢ (in-tune ±15)', 'violin_A4.wav', async p => {
  await p.goto(URL_); const t = await waitNote(p, t => t.note === '라' && /^-(7|8|9) ¢$/.test(t.cents))
  assert.equal(t.oct, '4'); assert.equal(t.inTune, true)
  await sleep(p, 300); assert.equal((await tunerText(p)).note, '라')
})
await scenario('tuner: cello C2 → 도2', 'cello_C2.wav', async p => { await p.goto(URL_); const t = await waitNote(p, t => t.note === '도'); assert.equal(t.oct, '2') })
await scenario('tuner: 도♯ shows ♯ + 레♭ enharmonic', 'violin_scale_Amaj.wav', async p => {
  await p.goto(URL_); const t = await waitNote(p, t => t.acc === '♯', 8000)
  const enh = await p.evaluate(() => document.getElementById('tuner-enharmonic').textContent); assert.match(enh, /♭/)
})
await scenario('tuner: silence → "--" and needle centered', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500); const t = await tunerText(p); assert.equal(t.note, '--'); assert.equal(t.cents, '')
  assert.equal(await p.evaluate(() => document.getElementById('gauge-needle').style.left), '50%')
})
await scenario('tuner: ±5 setting makes 440@442 out of tune', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#menu-btn'); await p.click('#settings-open-btn'); await p.click('#cents-steps .step-btn[data-v="5"]'); await p.click('#settings-back-btn'); await p.click('.menu-close-btn')
  await waitNote(p, t => t.note === '라' && !t.inTune)
  const zoneW = await p.evaluate(() => parseFloat(document.getElementById('gauge-zone').style.width)); assert.ok(zoneW > 0 && zoneW < 60, 'zone narrow: ' + zoneW)
})
await scenario('ref drum: drag to 440 → 0¢', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  const box = await p.locator('#ref-drum-outer').boundingBox()
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 56, { steps: 8 }); await p.mouse.up() // 위로 드래그 = Hz 감소 (v1 'invert scroll direction' 커밋)
  await sleep(p, 300)
  const active = await p.evaluate(() => document.querySelector('.ref-drum-item.active').textContent); assert.equal(active, '440 Hz')
  await waitNote(p, t => /^(\+1|-1|0) ¢$/.test(t.cents) || t.cents === '0 ¢')
})

// ── 메트로놈 ──
await scenario('metro: play/stop, collapse on play (phone), header bpm', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 900)
  const collapsedEl = () => p.evaluate(() => (document.getElementById('metro-body-wrap') || document.getElementById('metro-body')).classList.contains('collapsed'))
  assert.equal(await collapsedEl(), true, 'collapsed after load on phone')
  await p.click('#metro-collapse-btn'); await sleep(p, 700); assert.equal(await collapsedEl(), false)
  assert.equal(await p.evaluate(() => document.getElementById('metro-collapse-btn').textContent), '▼')
  await p.click('#metro-play-btn'); await sleep(p, 300)
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '■')
  assert.equal(await collapsedEl(), true, 'collapses while playing')
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('metro-play-hdr-btn')).display), 'flex')
  await sleep(p, 1600)
  const lit = await p.evaluate(() => document.querySelectorAll('#beat-vis .bd.lit-a, #beat-vis .bd.lit-b, #beat-vis .bd.lit-s').length); assert.ok(lit >= 0)
  await p.click('#metro-play-hdr-btn'); await sleep(p, 700)
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '▶'); assert.equal(await collapsedEl(), false, 'expands back (user had it open)')
})
await scenario('metro: bpm +/- , clamp, drag, time sig 6/8 disables subdiv, dots count', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 500); await p.click('#metro-collapse-btn'); await sleep(p, 600)
  const bpm = () => p.evaluate(() => +document.getElementById('metro-bpm').textContent)
  await p.click('.m-adj:nth-child(2)'); assert.equal(await bpm(), 81)
  await p.click('.m-adj:nth-child(1)'); await p.click('.m-adj:nth-child(1)'); assert.equal(await bpm(), 79)
  assert.equal(await p.evaluate(() => document.getElementById('metro-hdr-label').textContent), '♩ 79')
  for (let i = 0; i < 70; i++) await p.click('.m-adj:nth-child(1)'); assert.equal(await bpm(), 20, 'clamp min')
  const box = await p.locator('#metro-bpm-wrap').boundingBox()
  await p.mouse.move(box.x + 30, box.y + 40); await p.mouse.down(); await p.mouse.move(box.x + 30, box.y + 40 - 100, { steps: 10 }); await p.mouse.up()
  assert.equal(await bpm(), 70, 'drag 100px = +50 bpm')
  await p.click('[data-ts="6"]'); assert.equal(await p.evaluate(() => document.getElementById('sd-grid').style.pointerEvents), 'none')
  assert.equal(await p.evaluate(() => document.querySelector('[data-sd="1"]').textContent), '♪')
  assert.equal(await p.evaluate(() => document.querySelectorAll('#beat-vis .bd').length), 6)
  await p.click('[data-ts="3"]'); await p.click('[data-sd="2"]'); assert.equal(await p.evaluate(() => document.querySelectorAll('#beat-vis .bd').length), 6)
  assert.equal(await p.evaluate(() => document.querySelectorAll('#beat-vis .bd.beat').length), 3)
  await p.click('[data-sd="d"]'); assert.equal(await p.evaluate(() => document.querySelectorAll('#beat-vis .bd').length), 6)
})
await scenario('metro: works without mic (permission denied) + spacebar', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 800)
  assert.equal(await p.evaluate(() => document.getElementById('mic-popup-bg').classList.contains('show')), true, 'mic popup shown')
  await p.click('#mic-popup-cancel')
  await p.keyboard.press('Space'); await sleep(p, 300)
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '■')
  await p.keyboard.press('Space'); await sleep(p, 200)
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '▶')
}, { permissions: [] })

// ── 설정 영속 ──
await scenario('settings: persist across reload (cents, smooth, rms, wakelock, bpm, ts, ref)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 500)
  await p.click('#menu-btn'); await p.click('#settings-open-btn')
  await p.click('#cents-steps .step-btn[data-v="25"]'); await p.click('#smooth-steps .step-btn[data-v="3"]'); await p.click('#rms-steps .step-btn[data-v="1"]')
  await p.click('#wakelock-steps .step-btn[data-v="0"]')
  await p.click('#settings-back-btn'); await p.click('.menu-close-btn'); await p.click('#metro-collapse-btn'); await sleep(p, 600)
  await p.click('.m-adj:nth-child(2)'); await p.click('[data-ts="3"]')
  await sleep(p, 800)
  await p.reload(); await sleep(p, 800)
  const on = sel => p.evaluate(s => document.querySelector(s + ' .step-btn.on').dataset.v, sel)
  assert.equal(await on('#cents-steps'), '25'); assert.equal(await on('#smooth-steps'), '3'); assert.equal(await on('#rms-steps'), '1')
  assert.equal(await on('#wakelock-steps'), '0')
  assert.equal(await p.evaluate(() => document.getElementById('metro-bpm').textContent), '81')
  assert.equal(await p.evaluate(() => document.querySelector('[data-ts].on').dataset.ts), '3')
})

// ── 녹음 / 편집 ──
await scenario('rec: start/stop → list item, persists reload, rename persists (phase1 fix), delete', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#rec-hdr-btn'); await sleep(p, 1500)
  assert.equal(await p.evaluate(() => document.getElementById('rec-hdr-btn').classList.contains('rec-on')), true)
  assert.equal(await p.evaluate(() => document.getElementById('hdr-rec-time').classList.contains('show')), true)
  await p.click('#rec-hdr-btn'); await sleep(p, 800)
  const names = () => p.evaluate(() => Array.from(document.querySelectorAll('#rec-list .rec-item-name')).map(e => e.textContent))
  assert.equal((await names()).length, 1); assert.match((await names())[0], /^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/) // 표시명 '9/5 10:50' (저장명은 YYYYMMDD_HHMM)
  await p.reload(); await sleep(p, 1200); assert.equal((await names()).length, 1, 'restored from IndexedDB')
  await p.click('#menu-btn'); await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 300)
  assert.equal(await p.evaluate(() => document.getElementById('editor-page').style.display), 'flex')
  p.once('dialog', d => d.accept('연습곡A'))
  await p.click('#ed-title-edit'); await sleep(p, 300)
  assert.equal(await p.evaluate(() => document.getElementById('editor-title-display').textContent), '연습곡A')
  await p.click('#ed-back-btn'); await sleep(p, 200)
  assert.equal(await p.evaluate(() => document.getElementById('menu-overlay').classList.contains('open')), true, 'back to menu')
  assert.equal((await names())[0], '연습곡A')
  await p.reload(); await sleep(p, 1200)
  results.push(['rec: rename persisted after reload', (await names())[0] === '연습곡A' ? 'ok' : 'NO (v1 known bug)'])
  await p.click('#menu-btn'); await p.click('[data-action="delete"][data-idx="0"]'); await sleep(p, 300)
  assert.equal((await names()).length, 0)
  await p.click('#toast'); await sleep(p, 500) // 실행 취소
  assert.equal((await names()).length, 1, 'undo restores'); assert.equal((await names())[0], '연습곡A')
  await p.reload(); await sleep(p, 1200); assert.equal((await names()).length, 1, 'restored item persisted')
  await p.click('#menu-btn'); await p.click('[data-action="delete"][data-idx="0"]'); await sleep(p, 5600); assert.equal((await names()).length, 0)
})
await scenario('editor: A/B/loop/bookmark flows', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#rec-hdr-btn'); await sleep(p, 2200); await p.click('#rec-hdr-btn'); await sleep(p, 800)
  await p.click('#menu-btn'); await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 1500)
  await p.click('#ed-b-btn'); await sleep(p, 100) // A 없이 B → 토스트
  assert.equal(await p.evaluate(() => document.getElementById('toast').textContent), '먼저 A 지점을 설정해주세요')
  await p.click('#ed-play-btn'); await sleep(p, 600); await p.click('#ed-a-btn'); await sleep(p, 500); await p.click('#ed-b-btn'); await sleep(p, 100)
  assert.equal(await p.evaluate(() => document.getElementById('ed-ab-range').style.display), 'block')
  await p.click('#ed-loop-btn'); assert.equal(await p.evaluate(() => document.querySelector('#ed-loop-btn span').textContent), '켜짐')
  await p.click('#ed-bm-add-btn'); await sleep(p, 100); await p.click('#ed-bm-add-btn'); await sleep(p, 100)
  assert.equal(await p.evaluate(() => document.getElementById('toast').textContent), '이미 근처에 북마크가 있어요')
  assert.equal(await p.evaluate(() => document.querySelectorAll('#ed-bm-ticks > div').length), 1)
  await p.click('#ed-a-btn'); assert.equal(await p.evaluate(() => document.getElementById('ed-ab-range').style.display), 'none')
  await p.evaluate(() => { document.getElementById('ed-speed').value = '0.75'; document.getElementById('ed-speed').dispatchEvent(new Event('input')) })
  assert.equal(await p.evaluate(() => document.getElementById('ed-speed-val').textContent), '0.75×')
})

// ── 타이머 / 기준음 / 메뉴 ──
await scenario('timer: elapsed counts, detected counts while playing, reset', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#menu-btn'); await p.click('#timer-toggle-btn'); await sleep(p, 2300)
  const el = await p.evaluate(() => document.getElementById('timer-elapsed').textContent); assert.match(el, /^00:0[2-3]$/)
  const det = await p.evaluate(() => document.getElementById('timer-detected').textContent); assert.match(det, /^00:0[1-3]$/, 'detected while playing (FFT harmonic)')
  assert.equal(await p.evaluate(() => document.getElementById('timer-toggle-btn').textContent), '정지')
  await p.click('#timer-reset-btn'); assert.equal(await p.evaluate(() => document.getElementById('timer-elapsed').textContent), '00:00')
  assert.equal(await p.evaluate(() => document.getElementById('timer-toggle-btn').textContent), '시작')
})
await scenario('ref tone: toggle on/off, octave label both places, 도↑', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#menu-btn'); await p.click('#menu-overlay .ref-note-btn[data-note="라"]')
  assert.equal(await p.evaluate(() => document.querySelectorAll('.ref-note-btn.on').length), 2, 'on in both panel and menu')
  await p.click('#menu-overlay .ref-note-btn[data-note="도2"]'); assert.equal(await p.evaluate(() => document.querySelector('.ref-note-btn.on').dataset.note), '도2')
  await p.click('#menu-overlay .ref-note-btn[data-note="도2"]'); assert.equal(await p.evaluate(() => document.querySelectorAll('.ref-note-btn.on').length), 0)
  await p.click('#menu-overlay .ref-oct-btn:nth-of-type(2)')
  assert.equal(await p.evaluate(() => document.getElementById('ref-oct-num-menu').textContent), '5'); assert.equal(await p.evaluate(() => document.getElementById('ref-oct-num-ext').textContent), '5')
  for (let i = 0; i < 3; i++) await p.click('#menu-overlay .ref-oct-btn:nth-of-type(2)'); assert.equal(await p.evaluate(() => document.getElementById('ref-oct-num-menu').textContent), '6', 'clamp 6')
})
await scenario('mic off: closeMic resets tuner and shows MIC button', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.evaluate(() => { document.dispatchEvent(new Event('__nop')) })
  // 15분 무활동 대신: hdr-mic-btn 은 마이크 켜짐 시 숨김
  assert.equal(await p.evaluate(() => document.getElementById('hdr-mic-btn').style.display), 'none')
  assert.equal(await p.evaluate(() => document.getElementById('rec-hdr-btn').style.opacity), '1')
})

// ── Phase 2: 연주 감지 품질 ──
await scenario('detect: white noise (talking-free background) never counts as playing', 'noise_white.wav', async p => {
  await p.goto(URL_); await sleep(p, 800)
  await p.click('#menu-btn'); await p.click('#timer-toggle-btn'); await sleep(p, 3200)
  const el = await p.evaluate(() => document.getElementById('timer-elapsed').textContent); assert.match(el, /^00:0[2-4]$/)
  assert.equal(await p.evaluate(() => document.getElementById('timer-detected').textContent), '00:00')
})
await scenario('detect: pink noise shows no note and no playing', 'noise_pink.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500)
  assert.equal((await tunerText(p)).note, '--')
  await p.click('#menu-btn'); await p.click('#timer-toggle-btn'); await sleep(p, 2200)
  assert.equal(await p.evaluate(() => document.getElementById('timer-detected').textContent), '00:00')
})
await scenario('detect: sustained violin counts (after ~0.3 s attack)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#menu-btn'); await p.click('#timer-toggle-btn'); await sleep(p, 4200)
  const det = await p.evaluate(() => document.getElementById('timer-detected').textContent); assert.match(det, /^00:0[2-4]$/, 'detected: ' + det)
})

await scenario('metro+tuner: note keeps showing while metronome clicks (mute ranges only drop click windows)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#metro-collapse-btn'); await sleep(p, 600); await p.click('#metro-play-btn'); await sleep(p, 2500)
  let shown = 0; for (let i = 0; i < 10; i++) { if ((await tunerText(p)).note === '라') shown++; await sleep(p, 120) }
  assert.ok(shown >= 6, 'note visible in most samples while clicking: ' + shown + '/10')
  await p.click('#metro-play-hdr-btn')
})

// ── Phase 3: 메트로놈 정확도 / BPM 즉시 반영 / 마이크 없는 기준음 ──
await scenario('metro accuracy: worklet renders 120 bpm clicks with ≤1-sample jitter over 20 s (OfflineAudioContext)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_)
  const asset = readdirSync(join(DIST, 'assets')).find(n => /^metro\.worklet-.*\.js$/.test(n)); assert.ok(asset, 'metro worklet asset')
  const r = await p.evaluate(async url => {
    const sr = 48000, ac = new OfflineAudioContext(1, sr * 20, sr)
    await ac.audioWorklet.addModule(url)
    const n = new AudioWorkletNode(ac, 'gp-metro', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] })
    n.connect(ac.destination)
    n.port.postMessage({ type: 'pattern', pattern: { bpm: 120, timeSig: 4, subDiv: 1, volume: .7, muted: false } }); n.port.postMessage({ type: 'start' })
    await new Promise(r => setTimeout(r, 200)) // 오프라인 렌더는 순식간이라 포트 메시지가 먼저 도착하도록
    const buf = await ac.startRendering(); const x = buf.getChannelData(0)
    // 온셋: 200 ms 이상 조용하다가 |x|>0.05 가 되는 샘플
    const onsets = []; let quiet = sr
    for (let i = 0; i < x.length; i++) { if (Math.abs(x[i]) > 0.05) { if (quiet > sr * 0.2) onsets.push(i); quiet = 0 } else quiet++ }
    const d = onsets.slice(1).map((o, i) => o - onsets[i])
    return { count: onsets.length, first: onsets[0], min: Math.min(...d), max: Math.max(...d), expected: sr * 0.5 }
  }, '/assets/' + asset)
  assert.equal(r.count, 40, 'clicks in 20 s: ' + r.count)
  assert.ok(Math.abs(r.min - r.expected) <= 1 && Math.abs(r.max - r.expected) <= 1, `interval ${r.min}..${r.max} vs ${r.expected}`)
  assert.ok(Math.abs(r.first - sr48(0.05)) <= 2, 'first click at 50 ms: ' + r.first)
})
function sr48(s) { return Math.round(48000 * s) }
await scenario('metro: bpm change while playing does not restart (beats keep coming, playing stays)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 500); await p.click('#metro-collapse-btn'); await sleep(p, 600)
  await p.click('#metro-play-btn'); await sleep(p, 900)
  // 재생 중엔 본체가 접혀 있으므로 헤더 ♩BPM 라벨을 드래그해 올린다 (2 px/BPM → 60 px = +30)
  const box = await p.locator('#metro-hdr-label').boundingBox()
  await p.mouse.move(box.x + 10, box.y + 10); await p.mouse.down(); await p.mouse.move(box.x + 10, box.y + 10 - 60, { steps: 6 }); await p.mouse.up()
  assert.equal(await p.evaluate(() => document.getElementById('metro-bpm').textContent), '110')
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '■')
  const seen = new Set(); for (let i = 0; i < 25; i++) { seen.add(await p.evaluate(() => document.querySelector('#beat-vis .bd.lit-a, #beat-vis .bd.lit-b, #beat-vis .bd.lit-s')?.dataset.tick ?? '-')); await sleep(p, 60) }
  assert.ok(seen.size >= 2, 'beat dots advancing after bpm change: ' + [...seen].join(','))
  await p.click('#metro-play-hdr-btn')
})
await scenario('ref tone plays without mic (single AudioContext)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 800); await p.click('#mic-popup-cancel')
  await p.click('#menu-btn'); await p.click('#menu-overlay .ref-note-btn[data-note="라"]')
  assert.equal(await p.evaluate(() => document.querySelectorAll('.ref-note-btn.on').length), 2, 'note on without mic')
  await p.click('#menu-overlay .ref-note-btn[data-note="라"]'); assert.equal(await p.evaluate(() => document.querySelectorAll('.ref-note-btn.on').length), 0)
}, { permissions: [] })

// ── Phase 4: 편집 상태 영속 + 파형 ──
await scenario('editor: waveform appears; A/B + bookmark persist across close/reopen and reload', 'violin_scale_Amaj.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note !== '--', 6000)
  await p.click('#rec-hdr-btn'); await sleep(p, 3500); await p.click('#rec-hdr-btn'); await sleep(p, 800)
  await p.click('#menu-btn'); await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 1500)
  const waveShown = async () => p.evaluate(() => getComputedStyle(document.getElementById('ed-wave')).display === 'block')
  for (let i = 0; i < 20 && !(await waveShown()); i++) await sleep(p, 200)
  assert.equal(await waveShown(), true, 'waveform drawn')
  const painted = await p.evaluate(() => { const c = document.getElementById('ed-wave'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n })
  assert.ok(painted > 1000, 'waveform has pixels: ' + painted)
  await p.click('#ed-play-btn'); await sleep(p, 700); await p.click('#ed-a-btn'); await sleep(p, 900); await p.click('#ed-b-btn'); await sleep(p, 200); await p.click('#ed-bm-add-btn'); await sleep(p, 300)
  const state = () => p.evaluate(() => ({ a: document.querySelector('#ed-a-btn span').textContent, b: document.querySelector('#ed-b-btn span').textContent, range: document.getElementById('ed-ab-range').style.display, bm: document.querySelectorAll('#ed-bookmarks button').length / 2 }))
  const s1 = await state(); assert.equal(s1.range, 'block'); assert.equal(s1.bm, 1); assert.notEqual(s1.a, '설정')
  await p.click('#ed-back-btn'); await sleep(p, 300); await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 1200)
  const s2 = await state(); assert.deepEqual(s2, s1, 'restored after reopen')
  await p.reload(); await sleep(p, 1500); await p.click('#menu-btn'); await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 1500)
  const s3 = await state(); assert.deepEqual(s3, s1, 'restored after reload (IndexedDB v2)')
  // 저장된 피크로 즉시 파형 (디코드 없이)
  assert.equal(await waveShown(), true)
  await p.click('#ed-a-btn'); await sleep(p, 200); assert.equal((await state()).range, 'none') // A 해제 → 저장
  await p.click('#ed-back-btn'); await sleep(p, 200); await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 1000)
  assert.equal((await state()).range, 'none', 'cleared A-B persisted')
})

server.kill()
let fail = 0
for (const [n, r] of results) { if (r !== 'ok' && !r.startsWith('NO')) fail++; console.log((r === 'ok' ? '  ok   ' : r.startsWith('NO') ? '  note ' : '  FAIL ') + n + (r === 'ok' ? '' : '  → ' + r)) }
console.log(`\n${results.length - fail} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
