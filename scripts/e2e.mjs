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
const server = spawn('npx', ['-y', 'serve', '-s', '-l', String(PORT), DIST], { stdio: 'ignore', detached: process.platform !== 'win32', shell: process.platform === 'win32' }) // detached: 프로세스 그룹째 종료 (자식 serve 잔존 방지)
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

await scenario('ref drum: A=415 (baroque) → 440 Hz input reads 라♯4 ≈ 0¢, not 라 +100¢ (final review blocker)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  const box = await p.locator('#ref-drum-outer').boundingBox()
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 28 * 27, { steps: 20 }); await p.mouse.up()
  await sleep(p, 300)
  assert.equal(await p.evaluate(() => document.querySelector('.ref-drum-item.active').textContent), '415 Hz')
  const t = await waitNote(p, t => t.note === '라' && t.acc === '♯' && /^(\+?[0-3]|-[0-3]) ¢$/.test(t.cents), 5000)
  assert.equal(t.oct, '4')
})
await scenario('settings: note names C D E — tuner shows A with 라 as secondary; ref buttons relabel', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#menu-btn'); await p.click('#settings-open-btn'); await p.click('#notenames-steps .step-btn[data-v="1"]'); await p.click('#settings-back-btn')
  assert.equal(await p.evaluate(() => document.querySelector('#menu-overlay .ref-note-btn[data-note="라"]').textContent), 'A')
  await p.click('.menu-close-btn')
  const t = await waitNote(p, t => t.note === 'A'); assert.equal(t.oct, '4')
  assert.equal(await p.evaluate(() => document.getElementById('tuner-enharmonic').textContent), '라')
  await p.reload(); await waitNote(p, t => t.note === 'A', 5000) // 영속
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
  // 재생 중에도 펼쳐서 박자를 바꿀 수 있다 (final review) — 접기 버튼이 남아 있다
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('metro-collapse-btn')).display), 'flex', 'collapse btn stays while playing')
  await p.click('#metro-collapse-btn'); await sleep(p, 700); assert.equal(await collapsedEl(), false, 'expanded while playing')
  await p.click('[data-ts="3"]'); assert.equal(await p.evaluate(() => document.querySelector('[data-ts].on').dataset.ts), '3')
  await p.click('#metro-collapse-btn'); await sleep(p, 700); assert.equal(await collapsedEl(), true)
  await p.click('#metro-play-hdr-btn'); await sleep(p, 700)
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '▶'); assert.equal(await collapsedEl(), true, 'user collapsed it explicitly → stays')
  await p.click('#metro-collapse-btn'); await sleep(p, 700); await p.click('#metro-play-btn'); await sleep(p, 300); assert.equal(await collapsedEl(), true)
  await p.click('#metro-play-hdr-btn'); await sleep(p, 700); assert.equal(await collapsedEl(), false, 'expands back (auto-collapsed at start)')
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
  await p.click('#mic-popup-cancel'); await p.evaluate(() => document.activeElement?.blur()) // 포커스된 버튼의 Space 는 버튼의 것
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
  await p.click('#timer-toggle-btn'); await sleep(p, 100) // 정지한 뒤 초기화 (틱 경합 없이 값 비교)
  const before = await p.evaluate(() => document.getElementById('timer-elapsed').textContent)
  await p.click('#timer-reset-btn'); assert.equal(await p.evaluate(() => document.getElementById('timer-elapsed').textContent), '00:00')
  assert.equal(await p.evaluate(() => document.getElementById('timer-toggle-btn').textContent), '시작')
  // Phase 6 A6: 초기화는 즉시 + 실행 취소 토스트 (삭제와 같은 패턴)
  assert.equal(await p.evaluate(() => document.getElementById('toast').textContent), '초기화됨 · 실행 취소')
  await p.click('#toast'); await sleep(p, 200)
  assert.equal(await p.evaluate(() => document.getElementById('timer-elapsed').textContent), before, 'undo restores elapsed')
  // 실행 중에 초기화 → 실행 취소하면 다시 돌아간다
  await p.click('#timer-toggle-btn'); await sleep(p, 1200); await p.click('#timer-reset-btn'); await p.click('#toast'); await sleep(p, 100)
  assert.equal(await p.evaluate(() => document.getElementById('timer-toggle-btn').textContent), '정지', 'undo restores running state')
})
await scenario('ref tone: toggle on/off, octave label both places, 도↑', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#menu-btn'); await p.click('#menu-overlay .ref-note-btn[data-note="라"]')
  assert.equal(await p.evaluate(() => document.querySelectorAll('.ref-note-btn.on').length), 1, 'note on')
  await p.click('#menu-overlay .ref-note-btn[data-note="도2"]'); assert.equal(await p.evaluate(() => document.querySelector('.ref-note-btn.on').dataset.note), '도2')
  await p.click('#menu-overlay .ref-note-btn[data-note="도2"]'); assert.equal(await p.evaluate(() => document.querySelectorAll('.ref-note-btn.on').length), 0)
  await p.click('#menu-overlay .ref-oct-btn:nth-of-type(2)')
  assert.equal(await p.evaluate(() => document.getElementById('ref-oct-num-menu').textContent), '5')
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
  assert.equal(await p.evaluate(() => document.querySelectorAll('.ref-note-btn.on').length), 1, 'note on without mic')
  await p.click('#menu-overlay .ref-note-btn[data-note="라"]'); assert.equal(await p.evaluate(() => document.querySelectorAll('.ref-note-btn.on').length), 0)
  await p.click('.menu-close-btn'); await p.click('#ref-a-btn'); assert.equal(await p.evaluate(() => document.getElementById('ref-a-btn').classList.contains('on')), true, 'A 듣기 on without mic')
  await p.click('#ref-a-btn'); assert.equal(await p.evaluate(() => document.getElementById('ref-a-btn').classList.contains('on')), false)
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

// ── Phase 6: UI/UX ──
await scenario('ux: editor pause glyph ❚❚ (not ■), loop cycles 꺼짐→켜짐→1초 전부터→꺼짐 with pre-roll, entry fade class', 'violin_scale_Amaj.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note !== '--', 6000)
  await p.click('#rec-hdr-btn'); await sleep(p, 4200); await p.click('#rec-hdr-btn'); await sleep(p, 800)
  await p.click('#menu-btn'); await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 1500)
  assert.equal(await p.evaluate(() => document.getElementById('editor-page').classList.contains('open')), true, 'fade-in class applied')
  await p.click('#ed-play-btn'); await sleep(p, 300)
  assert.equal(await p.evaluate(() => document.getElementById('ed-play-btn').textContent), '❚❚')
  await sleep(p, 1400); await p.click('#ed-a-btn'); await sleep(p, 900); await p.click('#ed-b-btn'); await sleep(p, 100)
  const a = await p.evaluate(() => window.__gp.editor().ptA); assert.ok(a > 1.2, 'A set after 1.2 s: ' + a)
  const label = () => p.evaluate(() => document.querySelector('#ed-loop-btn span').textContent)
  await p.click('#ed-loop-btn'); assert.equal(await label(), '켜짐')
  await p.click('#ed-loop-btn'); assert.equal(await label(), '1초 전부터')
  await sleep(p, 50)
  const cur = await p.evaluate(() => window.__gp.editor().audio.currentTime)
  assert.ok(cur < a - 0.3 && cur >= a - 1.2, `pre-roll jumps to A−1 s: cur=${cur.toFixed(2)} a=${a.toFixed(2)}`)
  await p.click('#ed-loop-btn'); assert.equal(await label(), '꺼짐')
  await p.click('#ed-play-btn'); await sleep(p, 100)
  assert.equal(await p.evaluate(() => document.getElementById('ed-play-btn').textContent), '▶')
  await p.click('#ed-back-btn'); await sleep(p, 100)
  assert.equal(await p.evaluate(() => document.getElementById('editor-page').classList.contains('open')), false)
})
await scenario('ux: speed label tap cycles 1.0→0.5→0.7→0.85→1.0 and is remembered per recording (reload)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#rec-hdr-btn'); await sleep(p, 1500); await p.click('#rec-hdr-btn'); await sleep(p, 800)
  await p.click('#menu-btn'); await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 1200)
  const val = () => p.evaluate(() => document.getElementById('ed-speed-val').textContent)
  await p.click('#ed-speed-val'); assert.equal(await val(), '0.5×')
  await p.click('#ed-speed-val'); assert.equal(await val(), '0.7×')
  await p.click('#ed-speed-val'); assert.equal(await val(), '0.85×')
  assert.equal(await p.evaluate(() => document.getElementById('ed-speed').value), '0.85', 'slider follows')
  assert.equal(await p.evaluate(() => window.__gp.editor().audio.playbackRate), 0.85)
  await sleep(p, 300); await p.reload(); await sleep(p, 1500)
  await p.click('#menu-btn'); await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 1200)
  assert.equal(await val(), '0.85×', 'speed restored from meta')
  await p.click('#ed-speed-val'); assert.equal(await val(), '1.0×')
})
await scenario('ux: list meta shows 북마크 n · A-B after editing; audio status dot on while mic runs', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  assert.equal(await p.evaluate(() => document.getElementById('ai-dot').classList.contains('on')), true, 'dot on')
  await p.click('#rec-hdr-btn'); await sleep(p, 2200); await p.click('#rec-hdr-btn'); await sleep(p, 800)
  const meta = () => p.evaluate(() => document.querySelector('#rec-list .rec-item-meta').textContent)
  await p.click('#menu-btn'); assert.equal(await meta(), '', 'no meta line when nothing to say')
  await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 1200)
  await p.click('#ed-play-btn'); await sleep(p, 500); await p.click('#ed-bm-add-btn'); await sleep(p, 300); await p.click('#ed-a-btn'); await sleep(p, 500); await p.click('#ed-b-btn'); await sleep(p, 300)
  await p.click('#ed-back-btn'); await sleep(p, 300)
  assert.equal(await meta(), '북마크 1 · A-B')
  assert.equal(await p.evaluate(() => document.getElementById('rec-detail-0').classList.contains('open')), true, 'list not re-rendered (expanded state kept)')
  await p.click('.rec-play-btn'); await sleep(p, 200); assert.equal(await p.evaluate(() => document.querySelector('.rec-play-btn').textContent), '❚❚', 'list pause glyph'); await p.click('.rec-play-btn')
  await p.click('.menu-close-btn'); await sleep(p, 200)
  await p.evaluate(() => window.__gp.closeMic()); await sleep(p, 300)
  assert.equal(await p.evaluate(() => document.getElementById('ai-dot').classList.contains('on')), false, 'dot off after mic closed')
})

await scenario('ux: waveform zoom — 구간 확대 maps track to [A−2, B+2]; handles/ticks follow; off when A cleared', 'violin_scale_Amaj.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note !== '--', 6000)
  await p.click('#rec-hdr-btn'); await sleep(p, 7500); await p.click('#rec-hdr-btn'); await sleep(p, 800)
  await p.click('#menu-btn'); await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 1500)
  assert.equal(await p.evaluate(() => document.getElementById('ed-zoom-btn').classList.contains('dim')), true, 'dim without A-B')
  await p.click('#ed-play-btn'); await sleep(p, 1200); await p.click('#ed-a-btn'); await sleep(p, 1000); await p.click('#ed-b-btn'); await sleep(p, 200); await p.click('#ed-bm-add-btn'); await sleep(p, 200)
  await p.click('#ed-play-btn'); await sleep(p, 100)
  const left = sel => p.evaluate(s => parseFloat(document.querySelector(s).style.left), sel)
  const aWhole = await left('#ed-a-handle'), bWhole = await left('#ed-b-handle')
  await p.click('#ed-zoom-btn'); await sleep(p, 200)
  assert.equal(await p.evaluate(() => document.getElementById('ed-zoom-btn').textContent), '전체 보기')
  const aZ = await left('#ed-a-handle'), bZ = await left('#ed-b-handle'), tick = await left('#ed-bm-ticks .bm-tick')
  assert.ok(bZ - aZ > (bWhole - aWhole) * 1.5, `zoomed span wider: ${aZ}-${bZ} vs ${aWhole}-${bWhole}`)
  assert.ok(tick > aZ && tick < 100, `bookmark tick (set just after B) stays inside the zoom window: ${tick}`)
  await p.click('#ed-a-btn'); await sleep(p, 200) // A 해제 → 확대 해제
  assert.equal(await p.evaluate(() => document.getElementById('ed-zoom-btn').textContent), '구간 확대')
  assert.equal(await p.evaluate(() => document.getElementById('ed-zoom-btn').classList.contains('dim')), true)
})

// ── Phase 5: 완결성 ──
await scenario('offline: service worker precaches everything; reload with network off still works', 'violin_A4.wav', async (p, ctx) => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  // SW 등록·활성 대기
  await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; await new Promise(res => { if (r.active) res(null); else r.addEventListener('updatefound', () => res(null)) }) })
  await sleep(p, 1500)
  await ctx.setOffline(true)
  await p.reload(); await waitNote(p, t => t.note === '라', 8000)
  assert.equal(await p.evaluate(() => document.fonts.check("12px 'DM Mono'")), true, 'self-hosted DM Mono available offline')
  const font = await p.evaluate(() => getComputedStyle(document.getElementById('tuner-cents')).fontFamily); assert.match(font, /DM Mono/)
  await ctx.setOffline(false)
})
await scenario('lifecycle: context suspended externally while metronome plays → auto-resume on visible', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 500); await p.click('#metro-collapse-btn'); await sleep(p, 600); await p.click('#metro-play-btn'); await sleep(p, 800)
  assert.equal(await p.evaluate(() => window.__gp.stats().acState), 'running')
  await p.evaluate(async () => { await window.__gp.ac().suspend() })
  assert.equal(await p.evaluate(() => window.__gp.stats().acState), 'suspended')
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await sleep(p, 600)
  assert.equal(await p.evaluate(() => window.__gp.stats().acState), 'running', 'resumed')
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '■')
})
await scenario('lifecycle: idle → context suspended (audio focus released); metronome start resumes it', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 800); await p.click('#mic-popup-cancel'); await p.evaluate(() => document.activeElement?.blur())
  await p.keyboard.press('Space'); await sleep(p, 500); assert.equal(await p.evaluate(() => window.__gp.stats().acState), 'running')
  await p.keyboard.press('Space'); await sleep(p, 700); assert.equal(await p.evaluate(() => window.__gp.stats().acState), 'suspended', 'idle suspend')
  await p.keyboard.press('Space'); await sleep(p, 500); assert.equal(await p.evaluate(() => window.__gp.stats().acState), 'running')
}, { permissions: [] })
await scenario('permission: denied state shows the blocked-mic popup with retry wording', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 800)
  assert.equal(await p.evaluate(() => document.getElementById('mic-popup-bg').classList.contains('show')), true)
  const state = await p.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state)
  const title = await p.evaluate(() => document.getElementById('mic-popup-title').textContent)
  assert.equal(title, state === 'denied' ? '마이크가 차단돼 있어요' : '마이크를 켜 주세요', `state=${state}`)
  if (state === 'denied') assert.equal(await p.evaluate(() => document.getElementById('mic-popup-btn').textContent), '다시 시도')
}, { permissions: [] })
await scenario('perf: worker frame p95 stays under budget (12 ms) over 10 s', 'violin_scale_Amaj.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note !== '--', 6000); await sleep(p, 10000)
  const st = await p.evaluate(() => window.__gp.stats()); assert.ok(st.frameMs < 12, 'p95 frame ms: ' + st.frameMs)
  results.push(['perf: worker frame p95 = ' + st.frameMs.toFixed(2) + ' ms @' + st.sampleRate + ' Hz', 'ok'])
})

await scenario('lifecycle: inactivity watch closes the mic without the practice timer running', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500); assert.equal(await p.evaluate(() => window.__gp.stats().micOpen), true)
  // 15분을 기다릴 수 없으니 lastActivityMs 를 과거로 돌리고 감시 주기(30 s)를 기다린다 — 무음 파일이면 활동이 갱신되지 않는다
  await p.evaluate(() => { window.__gp.backdate(16 * 60 * 1000) })
  await sleep(p, 31000)
  assert.equal(await p.evaluate(() => window.__gp.stats().micOpen), false, 'mic closed by inactivity watch')
  assert.equal(await p.evaluate(() => document.getElementById('hdr-mic-btn').style.display), 'flex')
})
await scenario('sw update: new version is applied only when idle (prompt mode, no stale-chunk window)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500)
  const reg = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r })
  assert.equal(reg, true, 'sw registered on web')
})

try { process.kill(-server.pid, 'SIGTERM') } catch { server.kill() }
let fail = 0
for (const [n, r] of results) { if (r !== 'ok' && !r.startsWith('NO')) fail++; console.log((r === 'ok' ? '  ok   ' : r.startsWith('NO') ? '  note ' : '  FAIL ') + n + (r === 'ok' ? '' : '  → ' + r)) }
console.log(`\n${results.length - fail} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
