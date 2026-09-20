#!/usr/bin/env node
// 동작 e2e — 체크리스트(docs/CHECKLIST.md)의 [A] 항목을 헤드리스 Chromium 에서 실제로 조작해 확인한다.
// 사용: node scripts/e2e.mjs [--dist <dir>] [--port 4174]
// 왜: 스크린샷은 정지 화면만 본다. 리팩토링 전/후 빌드에 같은 시나리오를 돌려 "동작 변경 0"을 증명한다.
// 마이크는 --use-file-for-fake-audio-capture 로 WAV 를 주입한다 (사람 연주 불필요).
import { chromium } from 'playwright'
import { waitForServer } from './lib/wait-server.mjs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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
await waitForServer(`http://localhost:${PORT}/`)

const exe = process.env.CHROMIUM_PATH || undefined
const launch = wav => chromium.launch({ executablePath: exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${join(SIG, wav)}`, '--autoplay-policy=no-user-gesture-required'] })
const URL_ = `http://localhost:${PORT}/`
const results = []
let browser
/** --only <정규식> 로 시나리오 이름을 골라 돌린다 (「작업 효율 규칙」: 바뀐 것과 관련된 e2e 만) */
const ONLY = typeof args.only === 'string' ? new RegExp(args.only) : null
async function scenario(name, wav, fn, ctxOpts = {}) {
  if (ONLY && !ONLY.test(name)) return
  browser = await launch(wav)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['microphone'], ...ctxOpts })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/tfhub|tensorflow|fonts.googleapis|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()) })
  try { await fn(page, ctx); assert.deepEqual(errors, [], 'console/page errors'); results.push([name, 'ok']) }
  catch (e) { results.push([name, 'FAIL: ' + (e.message || e).toString().split('\n').slice(0, 3).join(' / ')]) }
  await browser.close()
}
const tunerText = p => p.evaluate(() => ({ note: document.getElementById('tuner-note').textContent, acc: document.getElementById('tuner-acc').textContent, oct: document.getElementById('tuner-oct').textContent, cents: document.getElementById('tuner-cents').textContent, inTune: document.getElementById('tuner-card').classList.contains('in-tune') }))
const waitNote = async (p, pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await tunerText(p); if (pred(t)) return t; await p.waitForTimeout(100) } throw new Error('note not reached: ' + JSON.stringify(await tunerText(p))) }
const sleep = (p, ms) => p.waitForTimeout(ms)
/** 카드를 아래로 밀어 한 단계 내리기 (v2.3.2 M10). 헤더의 빈 가운데에서 시작한다 — 라벨·버튼은 ignore 대상 */
const swipeDown = async (p, sel = '#metro-hdr') => {
  const b = await p.locator(sel).boundingBox()
  const x = b.x + b.width / 2, y = b.y + Math.min(20, b.height / 2)
  await p.mouse.move(x, y); await p.mouse.down()
  for (let i = 1; i <= 6; i++) await p.mouse.move(x, y + (60 * i) / 6)
  await p.mouse.up(); await sleep(p, 700)
}
/** 조건이 참이 될 때까지 폴링. 비동기 동작(마이크 재개 등)을 sleep 으로 어림잡지 않기 위한 것 */
const waitUntil = async (p, fn, ms = 4000, what = 'condition') => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await p.evaluate(fn)) return true; await p.waitForTimeout(100) }
  throw new Error('timed out waiting for ' + what)
}

// ── 튜너 ──
await scenario('tuner: 440 Hz @A=442 → 라4 −8¢ (in-tune ±15)', 'violin_A4.wav', async p => {
  await p.goto(URL_); const t = await waitNote(p, t => t.note === '라' && /^-(7|8|9) ¢$/.test(t.cents))
  assert.equal(t.oct, '4'); assert.equal(t.inTune, true)
  await sleep(p, 300); assert.equal((await tunerText(p)).note, '라')
  // Hz 읽기표시 (v2.3.0): 음이름 왼쪽, 440 근처, 6칸 고정폭 + ' Hz' = 항상 9글자
  const hz = await p.evaluate(() => document.getElementById('tuner-hz').textContent)
  assert.match(hz, /^ 4(39|40|41)\.\d Hz$/, 'hz readout: ' + JSON.stringify(hz)); assert.equal(hz.length, 9)
})
await scenario('tuner: cello C2 → 도2 (Hz 는 두 자리여도 같은 폭)', 'cello_C2.wav', async p => {
  await p.goto(URL_); const t = await waitNote(p, t => t.note === '도'); assert.equal(t.oct, '2')
  await sleep(p, 250); const hz = await p.evaluate(() => document.getElementById('tuner-hz').textContent)
  assert.match(hz, /^  6[456]\.\d Hz$/, 'hz readout: ' + JSON.stringify(hz)); assert.equal(hz.length, 9, 'Hz 자리가 움직이면 안 된다')
})
await scenario('tuner: 도♯ shows ♯ + 레♭ enharmonic', 'violin_scale_Amaj.wav', async p => {
  await p.goto(URL_); const t = await waitNote(p, t => t.acc === '♯', 8000)
  const enh = await p.evaluate(() => document.getElementById('tuner-enharmonic').textContent); assert.match(enh, /^[A-G]♯\/[A-G]♭$/, '보조 줄 = 다른 체계 하나 + 그쪽 이명동음 (L8): ' + enh)
})
await scenario('tuner: silence → "--"', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500); const t = await tunerText(p); assert.equal(t.note, '--'); assert.equal(t.cents, '')
  assert.equal(await p.evaluate(() => document.getElementById('tuner-hz').textContent), '', '무음이면 Hz 도 비운다')
})
await scenario('tuner: ±5 setting makes 440@442 out of tune', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#menu-btn'); await p.click('#settings-open-btn'); await p.click('#cents-steps .step-btn[data-v="5"]'); await p.click('#settings-back-btn'); await p.click('.menu-close-btn')
  // 띠 폭 단언은 뺐다 — 게이지 줄을 걷어내(K9) 띠가 히스토리 캔버스 안에만 남았다.
  // ±5 가 먹었다는 증거는 같은 440 Hz 가 '라 이면서 안 맞음' 으로 뒤집히는 것 자체다.
  await waitNote(p, t => t.note === '라' && !t.inTune)
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
  // v2.3.2 M1: 헤더 ⚙ 로 설정에 바로 (메뉴를 거치지 않는다). M2: 닫기는 메뉴와 같은 X
  await p.click('#settings-hdr-btn'); await sleep(p, 400)
  assert.equal(await p.evaluate(() => document.getElementById('settings-page').classList.contains('open')), true, '헤더 ⚙ → 설정 직행')
  assert.equal(await p.evaluate(() => document.getElementById('menu-overlay').classList.contains('open')), false, '메뉴를 열지 않는다')
  await p.click('#settings-back-btn'); await sleep(p, 400)
  assert.equal(await p.evaluate(() => document.getElementById('settings-page').classList.contains('open')), false, 'X 로 닫힌다')
  await p.click('#menu-btn'); await p.click('#settings-open-btn')
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('fullscreen-row')).display), 'flex', '브라우저(비 standalone)에서는 전체화면 행이 보인다 (L10)')
  await p.click('#notenames-steps .step-btn[data-v="1"]'); await p.click('#settings-back-btn')
  assert.equal(await p.evaluate(() => document.querySelector('#menu-overlay .ref-note-btn[data-note="라"]').textContent), 'A')
  await p.click('.menu-close-btn')
  const t = await waitNote(p, t => t.note === 'A'); assert.equal(t.oct, '4')
  assert.equal(await p.evaluate(() => document.getElementById('tuner-enharmonic').textContent), '라')
  await p.reload(); await waitNote(p, t => t.note === 'A', 5000) // 영속
})

// ── 메트로놈 ──
// U1: 재생은 접힘을 건드리지 않는다. 접힘은 접기 버튼으로만 바뀐다.
await scenario('metro: play/stop 이 접힘을 바꾸지 않는다 (U1), header bpm', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 900)
  const collapsedEl = () => p.evaluate(() => (document.getElementById('metro-body-wrap') || document.getElementById('metro-body')).classList.contains('collapsed'))
  const hdr = () => p.evaluate(() => getComputedStyle(document.getElementById('metro-play-hdr-btn')).display)
  assert.equal(await collapsedEl(), true, 'collapsed after load on phone')
  assert.equal(await p.evaluate(() => document.getElementById('metro-size-btn').classList.contains('to-expand')), true, '접힘이면 버튼은 ∧(펼치러)')
  await p.click('#metro-size-btn'); await sleep(p, 700); assert.equal(await collapsedEl(), false)
  assert.equal(await p.evaluate(() => document.getElementById('metro-size-btn').classList.contains('to-full')), true, '펼침이면 버튼은 ⤢(전용으로)')
  await p.click('#metro-play-btn'); await sleep(p, 300)
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '■')
  assert.equal(await collapsedEl(), false, 'U1: 펼친 채 재생하면 펼친 채로 남는다')
  assert.equal(await hdr(), 'none', '펼쳐져 있으면 헤더 재생 버튼은 숨는다 (본체 버튼과 겹치지 않게)')
  await sleep(p, 1600)
  const lit = await p.evaluate(() => document.querySelectorAll('#beat-vis .led').length); assert.ok(lit >= 0)
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('metro-size-btn')).display), 'flex', 'size btn stays while playing')
  await p.click('[data-ts="3"]'); assert.equal(await p.evaluate(() => document.querySelector('[data-ts].on').dataset.ts), '3')
  // 재생 중에 아래로 밀어 접으면 접히고, 그때만 헤더 재생 버튼이 나온다 (M10: 내려가는 길은 스와이프)
  await swipeDown(p); assert.equal(await collapsedEl(), true, '재생 중 스와이프로 접기')
  assert.equal(await hdr(), 'flex', '접힌 채 재생 중 → 헤더 재생 버튼')
  await p.click('#metro-play-hdr-btn'); await sleep(p, 700)
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '▶')
  assert.equal(await collapsedEl(), true, 'U1: 정지해도 접힘은 그대로')
  assert.equal(await hdr(), 'none', '정지하면 헤더 재생 버튼은 사라진다')
  // 접힌 채 재생 → 접힌 채로 남는다
  await p.click('#metro-size-btn'); await sleep(p, 700); assert.equal(await collapsedEl(), false)
  await swipeDown(p); assert.equal(await collapsedEl(), true)
  await p.click('#metro-size-btn'); await sleep(p, 700); await p.click('#metro-play-btn'); await sleep(p, 300)
  assert.equal(await collapsedEl(), false, 'U1: 펼친 채 재생 — 여전히 펼침')
  await p.click('#metro-play-btn'); await sleep(p, 300)
})
await scenario('metro: bpm +/- , clamp, drag, time sig 6/8 disables subdiv, dots count', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 500); await p.click('#metro-size-btn'); await sleep(p, 600)
  const bpm = () => p.evaluate(() => +document.getElementById('metro-bpm').textContent)
  await p.click('.m-adj:nth-child(2)'); assert.equal(await bpm(), 81)
  await p.click('.m-adj:nth-child(1)'); await p.click('.m-adj:nth-child(1)'); assert.equal(await bpm(), 79)
  assert.equal(await p.evaluate(() => document.getElementById('metro-hdr-bpm').textContent), '79')
  for (let i = 0; i < 70; i++) await p.click('.m-adj:nth-child(1)'); assert.equal(await bpm(), 40, 'clamp min (M7: 40~200)')
  const box = await p.locator('#metro-bpm-wrap').boundingBox()
  await p.mouse.move(box.x + 30, box.y + 40); await p.mouse.down(); await p.mouse.move(box.x + 30, box.y + 40 - 100, { steps: 10 }); await p.mouse.up()
  assert.equal(await bpm(), 90, 'drag 100px = +50 bpm')
  await p.click('[data-ts="6"]'); assert.equal(await p.evaluate(() => document.getElementById('sd-grid').style.pointerEvents), 'none')
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('[data-sd="1"] .flag')).display), 'block', '6/8 shows eighth-note flag')
  // K5: 헤더는 세이코식 LED 9칸 **고정** — 전에는 틱 수만큼 점을 만들어 4/4·3분할이면 12개로 폰에서 넘쳤다
  await p.click('#metro-play-btn'); await sleep(p, 150)
  assert.equal(await p.evaluate(() => document.querySelectorAll('#beat-vis .led').length), 9)
  await p.click('[data-ts="3"]'); await p.click('[data-sd="2"]'); await sleep(p, 150); assert.equal(await p.evaluate(() => document.querySelectorAll('#beat-vis .led').length), 9)
  await p.click('#metro-play-btn')
})
// M12: 재생 중 박자표를 바꾸면 마디가 다시 시작된다 — 그때 첫 박이 늘 **왼쪽 끝**이어야 한다(정지 후 새로 시작할 때와 같은 기준).
// 전에는 화면의 스윕 방향이 리셋되지 않아 바꾸는 순간의 방향에 따라 좌/우가 갈렸다.
await scenario('metro: 재생 중 박자를 바꿔도 첫 박은 왼쪽부터 (M12)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 800); await p.click('#mic-popup-cancel').catch(() => {})
  await p.click('#metro-size-btn'); await sleep(p, 600); await p.click('#metro-size-btn'); await sleep(p, 700) // 전용 모드 (13칸 줄이 크게 보인다)
  await p.click('#metro-play-btn'); await sleep(p, 300)
  /** 다음 정박(hit-acc)이 몇 번 칸에서 나는지 */
  const firstBeatCell = async () => p.evaluate(async () => {
    const t0 = performance.now()
    while (performance.now() - t0 < 6000) {
      const l = [...document.querySelectorAll('#sweep-leds .led')]
      const i = l.findIndex(d => d.classList.contains('hit-acc'))
      if (i >= 0) return i
      await new Promise(r => setTimeout(r, 4))
    }
    return -1
  })
  for (const ts of ['2', '3', '4', '3']) {
    await p.click(`[data-ts="${ts}"]`); await sleep(p, 120)
    assert.equal(await firstBeatCell(), 0, `${ts}/4 로 바꾼 뒤 첫 박은 왼쪽 끝(0번 칸)`)
  }
  // 세분을 바꿔도 같다
  await p.click('[data-sd="2"]'); await sleep(p, 120)
  assert.equal(await firstBeatCell(), 0, '세분을 바꿔도 첫 박은 왼쪽 끝')
  await p.click('#metro-play-btn')
})
await scenario('metro: 정박 모드 — 마디도 첫 박 강세도 없다 (K3)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 500); await p.click('#metro-size-btn'); await sleep(p, 600)
  await p.click('[data-ts="1"]')
  assert.equal(await p.evaluate(() => document.querySelector('[data-ts].on').dataset.ts), '1', '정박 버튼이 켜진다')
  // 재생해도 어느 틱에서도 액센트(hit-acc)가 나오지 않아야 한다 — 이게 이 모드의 전부다
  await p.click('#metro-play-btn')
  let sawAccent = false, sawBeat = false
  for (let i = 0; i < 40; i++) { if (await p.evaluate(() => !!document.querySelector('#beat-vis .led.hit-acc'))) sawAccent = true; if (await p.evaluate(() => !!document.querySelector('#beat-vis .led.hit-beat'))) sawBeat = true; await sleep(p, 40) }
  assert.equal(sawBeat, true, '정박은 초록으로 친다')
  await p.click('#metro-play-btn')
  assert.equal(sawAccent, false, '정박 모드에서는 액센트가 없어야 한다')
})
await scenario('metro: 전용 모드 — 튜너 숨김·마이크 해제·복귀, LED 가 끝→끝으로 쓸고 양 끝에서 초록 (K10·K5)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#metro-size-btn'); await sleep(p, 600); await p.click('#metro-size-btn'); await sleep(p, 700) // 접힘 → 펼침 → 전용 (순환, M10)
  assert.equal(await p.evaluate(() => document.getElementById('metro-card').classList.contains('full')), true)
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('tuner-card')).display), 'none', '튜너 카드 숨김')
  await waitUntil(p, () => !window.__tt.stats().micOpen, 3000, '전용 모드는 마이크를 놓는다 (K6)')
  assert.equal(await p.evaluate(() => document.querySelectorAll('#sweep-leds .led').length), 13)
  // M3: 선택 pill = 밝기(면·글자) + 얇은 빨간 테두리. 글자까지 빨갛던 옛 방식으로는 돌아가지 않는다
  const colors = await p.evaluate(() => { const on = document.querySelector('#metro-card.full .m-seg.on'); const cs = getComputedStyle(on); return { border: cs.borderTopColor, color: cs.color, bg: cs.backgroundColor } })
  assert.equal(colors.border, 'rgb(241, 95, 84)', '선택 pill 테두리는 액센트 (M3)')
  assert.equal(colors.color, 'rgb(223, 227, 232)', '글자는 밝기로 (--text)')
  assert.equal(colors.bg, 'rgb(46, 51, 60)', '면도 한 단 (--surface-2)')
  await p.click('[data-sd="2"]'); await p.click('#metro-play-btn')
  const seen = new Set(), hits = new Set(); let flashed = false
  for (let i = 0; i < 40; i++) {
    const r = await p.evaluate(() => { const l = Array.from(document.querySelectorAll('#sweep-leds .led')); const c = document.getElementById('metro-card').classList; return { mv: l.findIndex(d => d.classList.contains('mv')), hit: l.findIndex(d => d.classList.contains('hit-beat') || d.classList.contains('hit-acc')), sub: l.findIndex(d => d.classList.contains('hit-sub')), flash: c.contains('flash-strong') || c.contains('lit-weak') } })
    if (r.mv >= 0) seen.add(r.mv); if (r.hit >= 0) hits.add(r.hit); if (r.sub >= 0) hits.add('s' + r.sub); if (r.flash) flashed = true
    await sleep(p, 40)
  }
  await p.click('#metro-play-btn')
  assert.equal(flashed, false, '전용 모드에서는 카드가 박마다 번쩍이지 않는다 (L6-a)')
  // L11: 쓸고 가는 불의 색 — 재생 중엔 .mv 가 칸을 옮겨 다니며 늘 전이 중이라, 정지 후 한 칸에 붙여 놓고 잰다
  const mvColor = await p.evaluate(async () => { const d = document.querySelectorAll('#sweep-leds .led')[3]; d.classList.add('mv'); await new Promise(r => setTimeout(r, 150)); const c = getComputedStyle(d).backgroundColor; d.classList.remove('mv'); return c })
  assert.equal(mvColor, 'rgb(77, 85, 96)', '쓸고 가는 불은 --line-strong (M4): ' + mvColor)
  // M5: 전용 줄에서만 히트가 한 단 크다
  const scales = await p.evaluate(async () => { const out = {}; const d = document.querySelectorAll('#sweep-leds .led')[5]
    for (const c of ['hit-sub', 'hit-beat', 'hit-acc']) { d.classList.add(c); await new Promise(r => setTimeout(r, 120)); out[c] = getComputedStyle(d).transform; d.classList.remove(c) } return out })
  assert.match(scales['hit-acc'], /^matrix\(1\.9/, '첫 박 1.9 배 (M5): ' + scales['hit-acc'])
  assert.match(scales['hit-beat'], /^matrix\(1\.6/, '박 1.6 배 (M5)')
  assert.ok(seen.size >= 6, `불이 여러 칸을 지나가야 한다: ${[...seen]}`)
  assert.ok(hits.has(0) || hits.has(12), `정박은 양 끝 칸에서: ${[...hits]}`)
  assert.ok([...hits].some(h => h === 's6'), `2분할은 가운데 칸(6)에서: ${[...hits]}`)
  // M10: 전용 모드에서 버튼은 ∨(접힘으로 한 바퀴), 아래 스와이프는 한 단계(펼침으로)
  const sizeBtn = () => p.evaluate(() => { const b = document.getElementById('metro-size-btn'); return { disp: getComputedStyle(b).display, toExpand: b.classList.contains('to-expand'), toFull: b.classList.contains('to-full') } })
  assert.deepEqual(await sizeBtn(), { disp: 'flex', toExpand: false, toFull: false }, '전용 모드의 글리프는 ∨(회전 없음)')
  await swipeDown(p) // 전용 → 펼침 (한 단계)
  assert.equal(await p.evaluate(() => document.getElementById('metro-card').classList.contains('full')), false, '스와이프 → 전용 해제')
  assert.equal(await p.evaluate(() => document.getElementById('metro-body-wrap').classList.contains('collapsed')), false, '스와이프는 한 단계 — 펼침까지')
  await swipeDown(p) // 펼침 → 접힘
  assert.equal(await p.evaluate(() => document.getElementById('metro-body-wrap').classList.contains('collapsed')), true, '한 번 더 밀면 접힘')
  await p.click('#metro-size-btn'); await sleep(p, 500); await p.click('#metro-size-btn'); await sleep(p, 500) // 접힘 → 펼침 → 전용
  // 나가면 튜너와 마이크가 돌아온다 — 그리고 다시 여는 0.2~0.5 초 동안 "MIC 를 켜면 시작해요" 가 한 프레임도 뜨지 않는다 (L4)
  await p.click('#metro-size-btn')
  const seenHint = await p.evaluate(async () => { const t0 = performance.now(); let hint = false; while (performance.now() - t0 < 3000) { if (document.getElementById('tuner-note').textContent === 'MIC 를 켜면 시작해요') hint = true; if (window.__tt.stats().micOpen) break; await new Promise(r => setTimeout(r, 16)) } return hint })
  assert.equal(seenHint, false, '자동 재개 중엔 "켜라" 고 말하지 않는다 (L4)')
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('tuner-card')).display), 'flex')
  await waitUntil(p, () => window.__tt.stats().micOpen, 4000, '전용 모드를 나가면 마이크가 돌아온다')
  // M9: 화면을 칠하는 박 표시는 **접혔을 때만**. 순환 버튼으로 전용에서 나오면 바로 접힘이다(M10)
  const flashesWhile = async () => { let f = false; for (let i = 0; i < 30; i++) { if (await p.evaluate(() => { const c = document.getElementById('metro-card').classList; return c.contains('flash-strong') || c.contains('lit-weak') })) { f = true; break } await sleep(p, 40) } return f }
  // 접힌 채 재생 — 접혀 있으면 본체 버튼이 안 보이므로 Space 로. 방금 누른 버튼에 포커스가 남아 있으면
  // Space 가 그 버튼의 것이 되므로(C1 규칙) 먼저 포커스를 뗀다
  await p.evaluate(() => document.activeElement && document.activeElement.blur())
  await p.keyboard.press('Space'); await sleep(p, 400)
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '■', 'Space 로 재생 시작')
  assert.equal(await flashesWhile(), true, '접혔을 때는 카드가 박마다 칠해진다 — 띠 하나뿐이라 이게 원거리 신호다')
  await p.click('#metro-size-btn'); await sleep(p, 700) // 펼침
  assert.equal(await flashesWhile(), false, '펼치면 LED 줄이 박을 말하므로 화면은 칠하지 않는다 (M9)')
  await p.click('#metro-play-btn')
})
await scenario('metro: 전용 모드 다이얼 — 링을 돌린 만큼 BPM, 끝에서 멈춤, 용어·눈금 (v2.3.0)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 800); await p.click('#mic-popup-cancel').catch(() => {})
  await p.click('#metro-size-btn'); await sleep(p, 500); await p.click('#metro-size-btn'); await sleep(p, 700) // 접힘 → 펼침 → 전용
  // 그림: 40~200 을 5 마다 눈금(33), 20 마다 숫자(9: 40·60·…·200), 이정표 용어 4(Largo 부터), 점 줄은 없다 (M7)
  const n = await p.evaluate(() => ({ tick: document.querySelectorAll('#dial-svg .dial-tick').length, num: document.querySelectorAll('#dial-svg .dial-num').length, name: document.querySelectorAll('#dial-svg .dial-name').length, beats: document.getElementById('sweep-beats') }))
  assert.deepEqual(n, { tick: 33, num: 9, name: 4, beats: null })
  assert.equal(await p.evaluate(() => document.getElementById('dial-bpm').textContent), '80')
  assert.equal(await p.evaluate(() => document.getElementById('dial-name').textContent), 'Andante')
  // 링을 돌린다: 중심 기준 각도를 +27° 만큼 (= 20 BPM) 시계 방향으로, 여러 번에 나눠서
  const rot = async (deg, steps = 12) => {
    const c = await p.evaluate(() => { const r = document.getElementById('dial').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width * 0.37 } })
    const at = a => ({ x: c.x + c.r * Math.sin(a * Math.PI / 180), y: c.y - c.r * Math.cos(a * Math.PI / 180) })
    let a = 0; const p0 = at(a)
    await p.mouse.move(p0.x, p0.y); await p.mouse.down()
    for (let i = 1; i <= steps; i++) { a = deg * i / steps; const q = at(a); await p.mouse.move(q.x, q.y) }
    await p.mouse.up()
  }
  await rot(33.75); await sleep(p, 100) // 1.6875°/BPM (40~200 이 270°) → +20 BPM
  let bpm = await p.evaluate(() => +document.getElementById('dial-bpm').textContent)
  assert.ok(Math.abs(bpm - 100) <= 1, `+33.75° 는 +20 BPM: ${bpm}`)
  assert.equal(await p.evaluate(() => document.getElementById('metro-bpm').textContent), String(bpm), '펼침 화면 숫자와 같은 값')
  assert.equal(await p.evaluate(() => document.getElementById('dial-name').textContent), 'Andante')
  await rot(-67.5); await sleep(p, 100)                                    // −40 → 60 Larghetto
  bpm = await p.evaluate(() => +document.getElementById('dial-bpm').textContent)
  assert.ok(Math.abs(bpm - 60) <= 1, `−67.5° 는 −40 BPM: ${bpm}`)
  assert.equal(await p.evaluate(() => document.getElementById('dial-name').textContent), 'Larghetto')
  await rot(-200, 30); await sleep(p, 100)                                 // 끝을 넘겨 돌려도 40 에서 멈춘다
  assert.equal(await p.evaluate(() => document.getElementById('dial-bpm').textContent), '40')
  await rot(20, 10); await sleep(p, 100)                                   // 되감을 필요 없이 바로 올라간다
  bpm = await p.evaluate(() => +document.getElementById('dial-bpm').textContent)
  assert.ok(bpm >= 50 && bpm <= 53, `끝에서 되돌리면 즉시 반응: ${bpm}`)
  // 배치: 위에서부터 LED → 다이얼 → [− ▶ +] → 음량 → 박자표 → 분할, 재생이 가운데
  const ys = await p.evaluate(() => ['sweep-leds', 'dial', 'metro-play-btn', 'metro-vol-pad', 'ts-grid', 'sd-grid'].map(id => document.getElementById(id).getBoundingClientRect().top))
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1], `순서: ${ys}`)
  const xs = await p.evaluate(() => { const b = Array.from(document.querySelectorAll('#metro-btn-row button')); return b.map(e => [e.id || e.textContent, Math.round(e.getBoundingClientRect().left)]).sort((a, b) => a[1] - b[1]).map(e => e[0]) })
  assert.deepEqual(xs, ['−', 'metro-play-btn', '+'])
  await p.click('#metro-size-btn')
})
// ── 화면 크기 행렬 (v2.3.1, L7) — 전용 모드는 어떤 화면에서도 스크롤·넘침이 없고 글자가 읽혀야 한다.
// 기기별 땜빵이 아니라 규칙(다이얼이 남는 높이를 흡수, 글자는 렌더 크기 고정)으로 닫고, 이 행렬이 회귀를 잡는다.
// Chromium 은 env(safe-area-inset-*) 가 0 이라 노치·홈 인디케이터를 #app padding 으로 흉내 낸다(근사 — 실기기 1회 확인).
const LAYOUT_MATRIX = [
  ['Android 소형', 360, 640, 12, 12], ['iPhone SE', 375, 667, 12, 12], ['iPhone 13 mini', 375, 812, 59, 46],
  ['iPhone 15', 393, 852, 59, 46], ['Pixel', 412, 915, 36, 30], ['iPhone Pro Max', 430, 932, 59, 46], ['태블릿', 768, 1024, 24, 20],
]
for (const [name, w, h, top, bot] of LAYOUT_MATRIX) await scenario(`layout: 전용 모드 ${name} ${w}×${h} — 스크롤·넘침 0, 글자 렌더 크기 유지`, 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 800); await p.click('#mic-popup-cancel').catch(() => {})
  await p.addStyleTag({ content: `#app{padding-top:${top}px!important;padding-bottom:${bot}px!important}` })
  // 크기 버튼은 순환이라, 넓은 화면(항상 펼침)과 폰은 전용까지 걸리는 횟수가 다르다 → 될 때까지 누른다 (M10)
  for (let i = 0; i < 3 && !(await p.evaluate(() => document.getElementById('metro-card').classList.contains('full'))); i++) { await p.click('#metro-size-btn'); await sleep(p, 500) }
  assert.equal(await p.evaluate(() => document.getElementById('metro-card').classList.contains('full')), true, '전용 모드 진입')
  const r = await p.evaluate(() => {
    const clip = document.getElementById('metro-body-clip'), card = document.getElementById('metro-card').getBoundingClientRect()
    const dial = document.getElementById('dial').getBoundingClientRect()
    const segs = Array.from(document.querySelectorAll('#metro-card.full .m-seg')).map(e => e.getBoundingClientRect())
    const glyphs = Array.from(document.querySelectorAll('#metro-card.full #sd-grid .m-seg')).map(b => { const g = b.querySelector('.note-glyph').getBoundingClientRect(), r = b.getBoundingClientRect(); return Math.max(r.left - g.left, g.right - r.right) })
    const num = document.querySelector('#dial-svg .dial-num').getBoundingClientRect()
    const names = Array.from(document.querySelectorAll('#dial-svg .dial-name')).filter(n => getComputedStyle(n).display !== 'none').length
    const last = document.getElementById('sd-grid').getBoundingClientRect()
    return { overflowY: clip.scrollHeight - clip.clientHeight, segOverflow: Math.max(0, ...segs.map(s => s.right - card.right)), glyphOverflow: Math.max(0, ...glyphs),
      dial: dial.width, numBoxH: num.height, names, lastRowInside: last.bottom <= card.bottom + 0.5 && last.bottom <= window.innerHeight,
      hdr: getComputedStyle(document.getElementById('hdr')).display, logo: document.getElementById('logo') }
  })
  assert.equal(r.hdr, 'none', '전용 모드는 헤더 줄을 접는다 (L10)'); assert.equal(r.logo, null, '워드마크는 없다 (L10)')
  assert.ok(r.overflowY <= 0, `세로 넘침 ${r.overflowY}px — 스크롤이 필요하면 안 된다`)
  assert.ok(r.segOverflow <= 0.5, `pill 가로 넘침 ${r.segOverflow}px`)
  assert.ok(r.glyphOverflow <= 0.5, `음표 글리프가 버튼 밖으로 ${r.glyphOverflow}px`)
  assert.ok(r.lastRowInside, '리듬 줄이 카드·화면 안에 있어야 한다')
  assert.ok(r.dial >= 150 && r.dial <= 320.5, `다이얼 ${r.dial}px`)
  assert.ok(r.numBoxH >= 11, `숫자 렌더 크기 유지 (bbox ${r.numBoxH}px, 10px 글자면 ≈13)`)
  assert.equal(r.names, r.dial >= 226 ? 4 : 0, `용어는 226px 이상에서만 (다이얼 ${r.dial})`)
  await p.click('#metro-size-btn'); await sleep(p, 300)
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('hdr')).display), 'flex', '나가면 헤더가 돌아온다')
}, { viewport: { width: w, height: h } })
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
  await p.click('#settings-back-btn'); await p.click('.menu-close-btn'); await p.click('#metro-size-btn'); await sleep(p, 600)
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
  p.once('dialog', d => d.accept('가'.repeat(60))) // C6: 60자 입력 → 40자로 잘린다
  await p.click('#ed-title-edit'); await sleep(p, 300)
  assert.equal(await p.evaluate(() => document.getElementById('editor-title-display').textContent.length), 40, '이름 40자 상한')
  // C6: 40자 이름은 카드를 넓히거나 여러 줄로 흐르지 않고 한 줄 말줄임으로 잘린다
  const nm = await p.evaluate(() => { const n = document.querySelector('#rec-list .rec-item-name'), it = n.closest('.rec-item'); return { clipped: n.scrollWidth > n.clientWidth, h: n.offsetHeight, over: it.scrollWidth > it.clientWidth } })
  assert.equal(nm.clipped, true, '한 줄 말줄임 (여러 줄로 흐르지 않는다)')
  assert.equal(nm.over, false, '카드 가로 넘침 없음')
  assert.ok(nm.h < 30, '한 줄 높이: ' + nm.h)
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
await scenario('rec: 연속 삭제 두 건 → 실행 취소 토스트가 각각 살아 있다 (D2)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  const names = () => p.evaluate(() => Array.from(document.querySelectorAll('#rec-list .rec-item-name')).map(e => e.textContent))
  for (let i = 0; i < 2; i++) { await p.click('#rec-hdr-btn'); await sleep(p, 1200); await p.click('#rec-hdr-btn'); await sleep(p, 800) }
  assert.equal((await names()).length, 2)
  await p.click('#menu-btn')
  await p.click('[data-action="delete"][data-idx="0"]'); await sleep(p, 200)
  await p.click('[data-action="delete"][data-idx="0"]'); await sleep(p, 200)
  assert.equal((await names()).length, 0)
  assert.equal(await p.evaluate(() => document.querySelectorAll('#toast-host .toast.show.actionable').length), 2, '실행 취소 토스트 2개가 동시에 떠 있다')
  await p.click('#toast'); await sleep(p, 400) // 가장 최근 = 두 번째 삭제
  assert.equal((await names()).length, 1, '두 번째 실행 취소')
  await p.click('#toast'); await sleep(p, 400) // 남아 있던 첫 번째 토스트
  assert.equal((await names()).length, 2, '첫 번째 실행 취소도 살아 있다 (v2.0.3 에서는 덮여 사라졌다)')
})
await scenario('rec: 남기기 — 예고문 안에서만, 토글·유지·설정 꺼지면 숨김 (F2)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#rec-hdr-btn'); await sleep(p, 1200); await p.click('#rec-hdr-btn'); await sleep(p, 800)
  await p.click('#menu-btn'); await sleep(p, 400)
  const meta = () => p.evaluate(() => document.querySelector('#rec-list .rec-item-meta').textContent)
  const link = () => p.evaluate(() => { const l = document.querySelector('#rec-list .rec-keep-link'); return l ? l.textContent : null })
  assert.equal(await p.evaluate(() => document.querySelectorAll('#rec-list .rec-item-btn').length), 3, '버튼 줄은 편집·다운로드·삭제 셋뿐')
  assert.equal(await link(), null, '예고 전에는 남기기 글자도 없다 (정보는 있는 것만)')
  // 녹음을 27일 전으로 돌려 예고 구간(마지막 7일)에 넣는다
  await p.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('tempotune_rec', 3); q.onsuccess = () => r(q.result) })
    const tx = db.transaction('recordings', 'readwrite'), st = tx.objectStore('recordings')
    const rows = await new Promise(r => { const g = st.getAll(); g.onsuccess = () => r(g.result) })
    for (const row of rows) { row.ts -= 27 * 86400000; st.put(row) }
    await new Promise(r => { tx.oncomplete = r }); db.close()
  })
  await p.reload(); await sleep(p, 1500); await p.click('#menu-btn'); await sleep(p, 400)
  assert.match(await meta(), /^\d일 후 삭제 · 남기기$/, '예고 + 남기기: ' + await meta())
  if (process.env.GP_SHOT) await p.screenshot({ path: process.env.GP_SHOT.replace('.png', '_warn.png') })
  await p.click('#rec-list .rec-keep-link'); await sleep(p, 300)
  assert.equal(await meta(), '자동 삭제 안 함', '남긴 뒤 표시')
  if (process.env.GP_SHOT) { await sleep(p, 3000); await p.screenshot({ path: process.env.GP_SHOT.replace('.png', '_kept.png') }) }
  await p.reload(); await sleep(p, 1500); await p.click('#menu-btn'); await sleep(p, 400)
  assert.equal(await meta(), '자동 삭제 안 함', '리로드 후에도 유지 (meta 에 저장)')
  // 자동 삭제 설정을 끄면 표시가 사라진다 (지킬 게 없다) — 플래그는 남는다
  await p.click('#settings-open-btn'); await sleep(p, 300)
  await p.click('#autodelete-steps .step-btn[data-v="0"]'); await sleep(p, 300)
  await p.click('#settings-back-btn'); await sleep(p, 300)
  assert.equal(await meta(), '', '설정 꺼짐 → 표시 없음')
  await p.click('#settings-open-btn'); await sleep(p, 300)
  await p.click('#autodelete-steps .step-btn[data-v="1"]'); await sleep(p, 300)
  await p.click('#settings-back-btn'); await sleep(p, 300)
  assert.equal(await meta(), '자동 삭제 안 함', '다시 켜면 플래그가 살아 있다')
  await p.click('#rec-list .rec-keep-link'); await sleep(p, 300)
  assert.match(await meta(), /^\d일 후 삭제 · 남기기$/, '해제하면 예고로 돌아간다')
  // 31일 전 = 기한 지난 항목을 남긴 상태에서 해제하면 미리 알린다 (되돌리기)
  await p.click('#rec-list .rec-keep-link'); await sleep(p, 300)
  await p.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('tempotune_rec', 3); q.onsuccess = () => r(q.result) })
    const tx = db.transaction('recordings', 'readwrite'), st = tx.objectStore('recordings')
    const rows = await new Promise(r => { const g = st.getAll(); g.onsuccess = () => r(g.result) })
    for (const row of rows) { row.ts -= 5 * 86400000; st.put(row) }
    await new Promise(r => { tx.oncomplete = r }); db.close()
  })
  await p.reload(); await sleep(p, 1500); await p.click('#menu-btn'); await sleep(p, 400)
  assert.equal(await meta(), '자동 삭제 안 함', '기한이 지나도 남긴 항목은 로드된다')
  await p.click('#rec-list .rec-keep-link'); await sleep(p, 300)
  assert.match(await p.evaluate(() => document.getElementById('toast').textContent), /되돌리기/, '기한 지난 해제는 경고 토스트')
  await p.click('#toast'); await sleep(p, 300)
  assert.equal(await meta(), '자동 삭제 안 함', '되돌리기로 다시 남김')
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

await scenario('keys: Space 의 주인은 지금 보이는 화면 (C1)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  const metroOn = () => p.evaluate(() => document.getElementById('metro-play-btn').textContent === '■')
  const edGlyph = () => p.evaluate(() => document.getElementById('ed-play-btn').textContent)
  // 메인 화면: 기존대로 메트로놈
  const blur = () => p.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur() }) // 버튼에 포커스가 남아 있으면 Space 는 그 버튼의 것 (의도된 동작)
  await blur(); await p.keyboard.press('Space'); await sleep(p, 300)
  assert.equal(await metroOn(), true, '메인에서는 메트로놈')
  await p.keyboard.press('Space'); await sleep(p, 300); assert.equal(await metroOn(), false)
  // 메뉴가 열려 있으면 아무 일도 없다
  await p.click('#menu-btn'); await sleep(p, 300)
  await blur(); await p.keyboard.press('Space'); await sleep(p, 300)
  assert.equal(await metroOn(), false, '메뉴 뒤에서 메트로놈이 켜지지 않는다')
  await p.click('.menu-close-btn'); await sleep(p, 400)
  // 편집기에서는 편집기 재생
  await p.click('#rec-hdr-btn'); await sleep(p, 1500); await p.click('#rec-hdr-btn'); await sleep(p, 800)
  await p.click('#menu-btn'); await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 1500)
  await blur(); await p.keyboard.press('Space'); await sleep(p, 700)
  assert.equal(await metroOn(), false, '편집기에서 메트로놈이 켜지지 않는다')
  assert.equal(await edGlyph(), '❚❚', '편집기 재생이 시작된다')
  await p.keyboard.press('Space'); await sleep(p, 400); assert.equal(await edGlyph(), '▶', '한 번 더 누르면 멈춘다')
})

await scenario('keys: 닫힌 메뉴·설정은 Tab 순서에 없다 (C2)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await sleep(p, 1200)
  const inside = []
  for (let i = 0; i < 30; i++) {
    await p.keyboard.press('Tab')
    inside.push(await p.evaluate(() => {
      const a = document.activeElement
      return !!(a && (a.closest('#menu-overlay') || a.closest('#settings-page') || a.closest('#mic-popup-bg')))
    }))
  }
  assert.equal(inside.some(Boolean), false, '닫힌 오버레이 안으로 포커스가 들어가지 않는다')
  // 열면 정상적으로 포커스가 간다 (기능이 죽지 않았다는 확인)
  await p.click('#menu-btn'); await sleep(p, 400)
  await p.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur() })
  let reached = false
  for (let i = 0; i < 30 && !reached; i++) {
    await p.keyboard.press('Tab')
    reached = await p.evaluate(() => !!(document.activeElement && document.activeElement.closest('#menu-overlay')))
  }
  assert.equal(reached, true, '열린 메뉴는 포커스를 받는다')
})

await scenario('metro: 재생 중에 화면이 넓어지면 헤더 재생 버튼이 사라진다 (C8)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 1200)
  const hdr = () => p.evaluate(() => getComputedStyle(document.getElementById('metro-play-hdr-btn')).display)
  const collapsed = () => p.evaluate(() => document.getElementById('metro-body-wrap').classList.contains('collapsed'))
  // 로드 직후 폰에서는 접혀 있다. 접힌 채 재생을 시작한다 (헤더 버튼이 나오는 유일한 조건)
  assert.equal(await collapsed(), true, '폰: 로드 직후 접힘')
  await p.click('#metro-size-btn'); await sleep(p, 700); await p.click('#metro-play-btn'); await sleep(p, 300)
  await swipeDown(p)
  assert.equal(await collapsed(), true, '재생 중 스와이프로 접기')
  assert.equal(await hdr(), 'flex', '폰: 접힌 채 재생 중 헤더 버튼')
  await p.setViewportSize({ width: 900, height: 844 }); await sleep(p, 600)
  assert.equal(await hdr(), 'none', '넓은 화면: 헤더 버튼 없음')
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(p, 600)
  assert.equal(await hdr(), 'flex', '다시 폰: 헤더 버튼 복귀')
  assert.equal(await collapsed(), true, 'U1: 폭이 바뀌어도 접힘은 사용자가 정한 그대로')
  // 폰에서 재생 중에 일부러 펼친 카드는, 높이만 바뀌는 resize(안드로이드 주소창 숨김·키보드)에 다시 접히면 안 된다
  await p.click('#metro-size-btn'); await sleep(p, 700); assert.equal(await collapsed(), false, '재생 중 수동 펼침')
  await p.setViewportSize({ width: 390, height: 700 }); await sleep(p, 600)
  assert.equal(await collapsed(), false, '높이만 바뀐 resize 에는 접히지 않는다')
  await p.click('#metro-play-btn'); await sleep(p, 600)
  assert.equal(await hdr(), 'none', '정지하면 헤더 버튼 사라짐')
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
  await p.click('#metro-size-btn'); await sleep(p, 600); await p.click('#metro-play-btn'); await sleep(p, 2500)
  let shown = 0; for (let i = 0; i < 10; i++) { if ((await tunerText(p)).note === '라') shown++; await sleep(p, 120) }
  assert.ok(shown >= 6, 'note visible in most samples while clicking: ' + shown + '/10')
  await p.click('#metro-play-btn') // U1: 펼친 채 재생 중이라 헤더 버튼은 없다
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
  await p.goto(URL_); await sleep(p, 500); await p.click('#metro-size-btn'); await sleep(p, 600)
  await p.click('#metro-play-btn'); await sleep(p, 900)
  // 헤더 ♩BPM 라벨을 드래그해 올린다 (2 px/BPM → 60 px = +30). 헤더는 접힘과 무관하게 항상 보인다
  const box = await p.locator('#metro-hdr-label').boundingBox()
  await p.mouse.move(box.x + 10, box.y + 10); await p.mouse.down(); await p.mouse.move(box.x + 10, box.y + 10 - 60, { steps: 6 }); await p.mouse.up()
  assert.equal(await p.evaluate(() => document.getElementById('metro-bpm').textContent), '110')
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '■')
  const seen = new Set(); for (let i = 0; i < 25; i++) { seen.add(await p.evaluate(() => Array.from(document.querySelectorAll('#beat-vis .led')).findIndex(d => d.classList.contains('mv') || d.className.includes('hit')))); await sleep(p, 60) }
  assert.ok(seen.size >= 2, 'beat dots advancing after bpm change: ' + [...seen].join(','))
  await p.click('#metro-play-btn') // U1: 펼친 채 재생 중이라 헤더 버튼은 없다
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
  const a = await p.evaluate(() => window.__tt.editor().ptA); assert.ok(a > 1.2, 'A set after 1.2 s: ' + a)
  const label = () => p.evaluate(() => document.querySelector('#ed-loop-btn span').textContent)
  await p.click('#ed-loop-btn'); assert.equal(await label(), '켜짐')
  await p.click('#ed-loop-btn'); assert.equal(await label(), '1초 전부터')
  await sleep(p, 50)
  const cur = await p.evaluate(() => window.__tt.editor().audio.currentTime)
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
  assert.equal(await p.evaluate(() => window.__tt.editor().audio.playbackRate), 0.85)
  await sleep(p, 300); await p.reload(); await sleep(p, 1500)
  await p.click('#menu-btn'); await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 1200)
  assert.equal(await val(), '0.85×', 'speed restored from meta')
  await p.click('#ed-speed-val'); assert.equal(await val(), '1.0×')
})
await scenario('ux: 가장자리 스와이프로 뒤로 — 메뉴·설정·편집기, 가운데서 긋거나 세로로 긋거나 짧으면 무시 (v2.3.0)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  const swipe = async (x0, y0, x1, y1, steps = 8) => { await p.mouse.move(x0, y0); await p.mouse.down(); for (let i = 1; i <= steps; i++) await p.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await p.mouse.up() }
  const menuOpen = () => p.evaluate(() => document.getElementById('menu-overlay').classList.contains('open'))
  const settingsOpen = () => p.evaluate(() => document.getElementById('settings-page').classList.contains('open'))
  const W = await p.evaluate(() => innerWidth)
  // 메뉴 → 본화면
  await p.click('#menu-btn'); await sleep(p, 300); assert.equal(await menuOpen(), true)
  await swipe(200, 400, 320, 400); await sleep(p, 300); assert.equal(await menuOpen(), true, '가운데서 그은 건 무시')
  await swipe(8, 400, 12, 560); await sleep(p, 300); assert.equal(await menuOpen(), true, '세로로 그은 건 스크롤')
  await swipe(8, 400, 8 + W * 0.2, 400); await sleep(p, 500); assert.equal(await menuOpen(), true, '35 % 못 미치면 제자리')
  assert.equal(await p.evaluate(() => document.getElementById('menu-overlay').style.transform), '', '되돌아간 뒤 transform 은 지운다')
  await swipe(8, 400, 8 + W * 0.5, 400); await sleep(p, 600); assert.equal(await menuOpen(), false, '절반 넘게 끌면 닫힘')
  assert.equal(await p.evaluate(() => document.getElementById('menu-overlay').style.transform), '', '닫힌 뒤 transform 은 지운다')
  // 설정 → 메뉴 (메뉴는 남아 있어야 한다)
  await p.click('#menu-btn'); await sleep(p, 300); await p.click('#settings-open-btn'); await sleep(p, 300); assert.equal(await settingsOpen(), true)
  await swipe(8, 300, W * 0.6, 300); await sleep(p, 600)
  assert.equal(await settingsOpen(), false, '설정 닫힘'); assert.equal(await menuOpen(), true, '메뉴는 그대로')
  // 편집기 → 메뉴
  await p.click('.menu-close-btn'); await sleep(p, 200)
  await p.click('#rec-hdr-btn'); await sleep(p, 1500); await p.click('#rec-hdr-btn'); await sleep(p, 800)
  await p.click('#menu-btn'); await sleep(p, 200); await p.click('[data-action="edit"][data-idx="0"]'); await sleep(p, 1200)
  const edOpen = () => p.evaluate(() => document.getElementById('editor-page').classList.contains('open'))
  assert.equal(await edOpen(), true)
  // 파형 스크럽(가로 드래그)은 가장자리 영역(24 px) 밖에서 시작해야 서로 안 다툰다 — 겹치면 ignore 목록이 막지만, 겹치지 않는 게 먼저다
  const trackLeft = await p.evaluate(() => document.getElementById('ed-track').getBoundingClientRect().left)
  assert.ok(trackLeft > 24, `파형 왼쪽 끝이 가장자리 영역 안에 들어오면 스크럽과 뒤로가 겹친다: left=${trackLeft}`)
  await swipe(8, 60, W * 0.6, 60); await sleep(p, 700)
  assert.equal(await edOpen(), false, '편집기 닫힘'); assert.equal(await menuOpen(), true, '닫히면 메뉴로')
  await p.click('.menu-close-btn')
})
await scenario('ux: list meta shows 북마크 n · A-B after editing', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
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
  await p.goto(URL_); await sleep(p, 500); await p.click('#metro-size-btn'); await sleep(p, 600); await p.click('#metro-play-btn'); await sleep(p, 800)
  assert.equal(await p.evaluate(() => window.__tt.stats().acState), 'running')
  // 외부 suspend 직후의 'suspended' 는 단언하지 않는다 — 앱이 statechange 에서 **즉시** 되살리므로(main.ts onContextState)
  // 그 순간을 잡는 검사는 경합이다(v2.0.2 에서 '가끔 실패' 로 기록됐던 원인). 검사할 것은 "결국 running 으로 돌아오는가" 다.
  const before = await p.evaluate(async () => { const ac = window.__tt.ac(); const p0 = ac.suspend(); const s = ac.state; await p0; return s })
  assert.ok(before === 'suspended' || before === 'running', 'suspend 호출은 됐다: ' + before)
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await sleep(p, 600)
  assert.equal(await p.evaluate(() => window.__tt.stats().acState), 'running', 'resumed')
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '■')
})
// ── P1: 숨김 시 마이크 해제 (v2.0.3) ──
const setVisibility = (p, state) => p.evaluate(st => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')) }, state)
await scenario('lifecycle: 화면이 숨겨지면 마이크를 놓고 메트로놈도 멈춘다 — 타이머는 계속 (P1·M11)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#menu-btn'); await p.click('#timer-toggle-btn'); await p.click('.menu-close-btn'); await sleep(p, 300)
  await p.click('#metro-size-btn'); await sleep(p, 500); await p.click('#metro-play-btn'); await sleep(p, 500)
  assert.equal(await p.evaluate(() => window.__tt.stats().micOpen), true, '시작: 마이크 열림')
  // 숨김 → 마이크는 놓고, **메트로놈은 멈추고**(M11: 안드로이드에서 나간 앱이 계속 울렸다), 타이머는 그대로 돈다
  await setVisibility(p, 'hidden'); await sleep(p, 400)
  assert.equal(await p.evaluate(() => window.__tt.stats().micOpen), false, '숨김: 마이크를 놓아야 다른 앱이 쓸 수 있다')
  assert.equal(await p.evaluate(() => document.getElementById('timer-toggle-btn').textContent), '정지', '숨김: 타이머는 멈추지 않는다 (연습이 끝난 게 아니다)')
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '▶', '숨김: 메트로놈은 멈춘다 (M11)')
  // 복귀 → 권한 창 없이 다시 열리고 음이 다시 뜬다.
  // 마이크 재개는 비동기(getUserMedia)다. 여기서 waitNote 로 기다리면 **숨기기 전에 남아 있던 음이름 텍스트**를
  // 보고 즉시 통과해 버려서 아무것도 기다리지 않는다 — 그래서 micOpen 을 직접 기다린다 (이 테스트가
  // 2/3 확률로 실패하던 원인. 앱이 아니라 테스트가 너무 일찍 단정하고 있었다).
  await setVisibility(p, 'visible')
  const hintOnReturn = await p.evaluate(async () => { const t0 = performance.now(); let hint = false; while (performance.now() - t0 < 3000) { if (document.getElementById('tuner-note').textContent === 'MIC 를 켜면 시작해요') hint = true; if (window.__tt.stats().micOpen) break; await new Promise(r => setTimeout(r, 16)) } return hint })
  assert.equal(hintOnReturn, false, '복귀 재개 중에도 "켜라" 고 말하지 않는다 (L4)')
  await waitUntil(p, () => window.__tt.stats().micOpen === true, 5000, '복귀: 마이크 다시 열림')
  await waitNote(p, t => t.note === '라', 5000)
  assert.equal(await p.evaluate(() => document.getElementById('tuner-note').textContent !== '탭하여 시작'), true, '복귀: 탭 안내 없이 바로')
  assert.equal(await p.evaluate(() => document.getElementById('metro-play-btn').textContent), '▶', '복귀: 메트로놈이 저절로 다시 켜지지는 않는다 (놀라게 하지 않는다)')
})
await scenario('lifecycle: 웹에서 녹음 중이면 숨겨져도 마이크를 놓지 않는다 (녹음이 끊기면 안 된다) (P1)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await waitNote(p, t => t.note === '라')
  await p.click('#menu-btn'); await sleep(p, 300); await p.click('#rec-toggle-btn'); await sleep(p, 600)
  await setVisibility(p, 'hidden'); await sleep(p, 400)
  assert.equal(await p.evaluate(() => window.__tt.stats().micOpen), true, '녹음 중: 마이크 유지')
  await setVisibility(p, 'visible'); await sleep(p, 300)
  await p.click('#rec-toggle-btn'); await sleep(p, 800)
  assert.equal(await p.evaluate(() => document.querySelectorAll('.rec-item').length), 1, '녹음이 저장됐다')
})
await scenario('lifecycle: idle → context suspended (audio focus released); metronome start resumes it', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 800); await p.click('#mic-popup-cancel'); await p.evaluate(() => document.activeElement?.blur())
  await p.keyboard.press('Space'); await sleep(p, 500); assert.equal(await p.evaluate(() => window.__tt.stats().acState), 'running')
  await p.keyboard.press('Space'); await sleep(p, 700); assert.equal(await p.evaluate(() => window.__tt.stats().acState), 'suspended', 'idle suspend')
  await p.keyboard.press('Space'); await sleep(p, 500); assert.equal(await p.evaluate(() => window.__tt.stats().acState), 'running')
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
  const st = await p.evaluate(() => window.__tt.stats()); assert.ok(st.frameMs < 12, 'p95 frame ms: ' + st.frameMs)
  results.push(['perf: worker frame p95 = ' + st.frameMs.toFixed(2) + ' ms @' + st.sampleRate + ' Hz', 'ok'])
})

await scenario('lifecycle: inactivity watch closes the mic without the practice timer running', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500); assert.equal(await p.evaluate(() => window.__tt.stats().micOpen), true)
  // 15분을 기다릴 수 없으니 lastActivityMs 를 과거로 돌리고 감시 주기(30 s)를 기다린다 — 무음 파일이면 활동이 갱신되지 않는다
  await p.evaluate(() => { window.__tt.backdate(16 * 60 * 1000) })
  await sleep(p, 31000)
  assert.equal(await p.evaluate(() => window.__tt.stats().micOpen), false, 'mic closed by inactivity watch')
  assert.equal(await p.evaluate(() => document.getElementById('hdr-mic-btn').style.display), 'flex')
})
await scenario('lifecycle: 오래 켜둔 뒤 마이크를 다시 켜도 즉시 꺼지지 않는다 (D3)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500); assert.equal(await p.evaluate(() => window.__tt.stats().micOpen), true)
  await p.evaluate(() => { window.__tt.backdate(20 * 60 * 1000); window.__tt.closeMic() })
  await sleep(p, 300)
  await p.click('#hdr-mic-btn'); await sleep(p, 1200)
  assert.equal(await p.evaluate(() => window.__tt.stats().micOpen), true, 'mic opened')
  await sleep(p, 35000) // 감시 주기 30 s 를 한 번 넘긴다
  assert.equal(await p.evaluate(() => window.__tt.stats().micOpen), true, '켠 시각 기준이라 바로 꺼지지 않는다 (v2.0.3 에서는 꺼졌다)')
})
await scenario('sw update: new version is applied only when idle (prompt mode, no stale-chunk window)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500)
  const reg = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r })
  assert.equal(reg, true, 'sw registered on web')
})

// ── 트레이스·바늘 (v2.0.2 C1 / B10) ──
// 왜 주입인가: 기존 스크린샷 12장은 트레이스가 비어 있어 이 변경을 전혀 검증하지 못한다. 합성 프레임을
// 밀어넣으면 "음이 바뀌는 자리"를 픽셀로 특정할 수 있다.
const TRACE_FRAMES = (flatten = false) => {
  const f = []
  for (let i = 0; i < 60; i++) f.push({ cents: -40, midi: 69 })          // 라4 를 −40 ¢ 로 지속
  for (let i = 0; i < 60; i++) f.push({ cents: 45, midi: flatten ? 69 : 71 })  // 시4 +45 ¢ (flatten 이면 라4 인 척)
  return f
}
/** 캔버스에서 '한 행에 이어진 흰 픽셀' 의 최대 개수 — 가로줄이 있으면 수백이 된다 */
const maxRowRun = p => p.evaluate(() => {
  const c = document.getElementById('tuner-history')
  const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data
  let best = 0
  for (let y = 0; y < c.height; y++) {
    let run = 0
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4
      const white = d[i] > 170 && d[i + 1] > 170 && d[i + 2] > 170
      run = white ? run + 1 : 0
      if (run > best) best = run
    }
  }
  return best
})
await scenario('tuner trace: 음이 바뀌는 자리에 가로줄을 긋지 않는다 (C1)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500)
  // (1) 대조군 — midi 를 고정하면 세그먼트가 절대 생략되지 않는다 = v2.0.1 의 그림. 가로줄이 나와야 한다.
  await p.evaluate(f => window.__tt.tuner.inject(f), TRACE_FRAMES(true))
  await sleep(p, 200)
  const before = await maxRowRun(p)
  assert.ok(before > 150, `대조군에 가로줄이 있어야 검사가 유효하다 (run=${before})`)
  // (2) 실제 동작 — 음이 바뀌면 끊는다
  await p.evaluate(() => window.__tt.tuner.setHistSec(4)) // 버퍼 초기화
  await p.evaluate(f => window.__tt.tuner.inject(f), TRACE_FRAMES(false))
  await sleep(p, 200)
  const after = await maxRowRun(p)
  assert.ok(after < 30, `전환 자리에 가로줄이 없어야 한다 (run=${after}, 대조군 ${before})`)
})
await scenario('tuner trace: 창 길이가 샘플레이트와 무관하게 초로 고정된다 (B11)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await sleep(p, 2000)
  const d = await p.evaluate(() => window.__tt.tuner.diag())
  assert.equal(d.sec, 4, 'histSec')
  assert.ok(Math.abs(d.len * 1024 / d.sr - 4) < 0.1, `창이 4초여야 한다: ${d.len}프레임 @${d.sr} = ${(d.len * 1024 / d.sr).toFixed(2)}초`)
  assert.ok(d.len < 360, `v2.0.1(360프레임)보다 짧아야 한다: ${d.len}`)
})
// ── 중음(더블스톱) 표시 (B17) ──
await scenario('더블스톱: 아래 성부를 같이 알려주고, 그 음이 틀리면 카드가 "완벽" 으로 빛나지 않는다 (B17)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500)
  // 마이크를 닫아 실시간 무음 프레임이 주입한 상태를 덮어쓰지 않게 한다 (무음 프레임은 hz=-1 → 표시 초기화)
  await p.evaluate(() => window.__tt.closeMic()); await sleep(p, 300)
  const read = () => p.evaluate(() => ({
    dual: document.getElementById('tuner-dual').textContent,
    dualCls: document.getElementById('tuner-dual').className,
    note: document.getElementById('tuner-note').className,
    card: document.getElementById('tuner-card').className,
  }))
  // (1) 단음 — 중음 줄은 비어 있고, 맞으면 카드가 빛난다 (기존 동작 보존)
  await p.evaluate(() => window.__tt.tuner.inject([{ cents: 2, midi: 73 }]))
  await sleep(p, 150)
  let r = await read()
  assert.equal(r.dual, '', '단음에는 중음 줄이 없어야 한다: ' + r.dual)
  assert.ok(/in-tune/.test(r.card), '단음이 맞으면 카드가 빛난다: ' + r.card)
  // (2) 중음 — 아래 성부가 −28 ¢. 화면 음(위 성부)은 그대로 초록인데 카드 전체 글로우는 빠진다
  await p.evaluate(() => window.__tt.tuner.inject(Array(8).fill({ cents: 2, midi: 73, dualMidi: 69, dualCents: -28 })))
  await sleep(p, 150)
  r = await read()
  assert.ok(/더블스톱/.test(r.dual) && /-28/.test(r.dual), '둘째 음과 그 오차를 적어야 한다: ' + r.dual)
  assert.ok(/on/.test(r.dualCls) && !/tune/.test(r.dualCls), '틀린 둘째 음은 초록이 아니다: ' + r.dualCls)
  assert.equal(r.note, 'tune', '화면 음(위 성부)은 여전히 맞다고 표시: ' + r.note)
  assert.ok(!/in-tune/.test(r.card), '아래 음이 틀렸으면 카드 전체는 빛나지 않는다: ' + r.card)
  // (3) 둘 다 맞는 중음 — 카드가 다시 빛난다
  await p.evaluate(() => window.__tt.tuner.inject(Array(8).fill({ cents: 2, midi: 73, dualMidi: 69, dualCents: -3 })))
  await sleep(p, 150)
  r = await read()
  assert.ok(/tune/.test(r.dualCls), '맞는 둘째 음은 초록: ' + r.dualCls)
  assert.ok(/in-tune/.test(r.card), '두 성부가 모두 맞으면 카드가 빛난다: ' + r.card)
  // (4) 중음이 끝나면 줄이 사라진다 (최소 표시 시간 400 ms 뒤)
  await p.evaluate(() => window.__tt.tuner.inject([{ cents: 2, midi: 73 }]))
  await sleep(p, 500)
  await p.evaluate(() => window.__tt.tuner.inject([{ cents: 2, midi: 73 }]))
  await sleep(p, 100)
  r = await read()
  assert.equal(r.dual, '', '중음이 끝나면 줄이 사라진다: ' + r.dual)
  assert.ok(/in-tune/.test(r.card), '단음으로 돌아오면 카드 글로우도 돌아온다: ' + r.card)
})
// ── 녹음 파일 이름·컨테이너 (B13) ──
await scenario('recording: 비 iOS 는 webm 유지(안드로이드 무변경) + 확장자가 내용과 일치 (B13)', 'violin_A4.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500)
  // Chromium 의 'audio/mp4' 는 실제로 **MP4 안의 Opus** 를 낸다(start 후 mimeType 확인) — 이름만 m4a 인,
  // 아이폰에서 못 여는 파일이 된다. 그래서 mp4 우선은 iOS 에서만 적용한다. 이 브라우저(비 iOS)는 webm 이어야 한다.
  const probe = await p.evaluate(async () => {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true })
    const r = new MediaRecorder(st, { mimeType: 'audio/mp4' })
    r.start(); await new Promise(res => setTimeout(res, 200)); const t = r.mimeType; r.stop()
    st.getTracks().forEach(x => x.stop())
    return { plainMp4Gives: t, aac: MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2') }
  })
  assert.ok(/opus/.test(probe.plainMp4Gives) || probe.aac, 'audio/mp4 가 AAC 가 아니면 iOS 전용 분기가 맞다: ' + probe.plainMp4Gives)
  await p.click('#menu-btn'); await sleep(p, 400)
  await p.click('#rec-toggle-btn'); await sleep(p, 1200); await p.click('#rec-toggle-btn'); await sleep(p, 1200)
  // 확장자는 mimeType 문자열이 아니라 blob 앞부분(ftyp / EBML)으로 정해진다 → 이름과 내용이 항상 일치해야 한다
  const info = await p.evaluate(async () => {
    const a = document.querySelector('.rec-dl-link')
    const res = await fetch(a.href); const head = new Uint8Array((await res.arrayBuffer()).slice(0, 12))
    const isWebm = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3
    const isMp4 = head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70
    return { name: a.download, isWebm, isMp4 }
  })
  assert.ok(info.name && /\.(m4a|webm)$/.test(info.name), '파일 이름 확장자: ' + info.name)
  if (info.isWebm) assert.match(info.name, /\.webm$/, '내용이 webm 이면 이름도 webm')
  if (info.isMp4) assert.match(info.name, /\.m4a$/, '내용이 mp4 면 이름도 m4a')
  assert.ok(info.isWebm || info.isMp4, '알 수 없는 컨테이너')
  if (!probe.aac) assert.ok(info.isWebm, '비 iOS + AAC 불가 → v2.0.1 과 같은 webm 이어야 한다(안드로이드 무변경)')
})

await scenario('playback: 조용한 녹음에 보정 게인이 붙고 재생이 계속된다 (B12c)', 'violin_A4_m20.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500)
  await p.click('#menu-btn'); await sleep(p, 400)
  await p.click('#rec-toggle-btn'); await sleep(p, 2000); await p.click('#rec-toggle-btn'); await sleep(p, 1500)
  await p.click('.rec-play-btn'); await sleep(p, 900)
  const st = await p.evaluate(() => window.__tt.playback())
  assert.equal(st.active, true, '재생 중으로 표시돼야 유휴 suspend 가 재생을 끊지 않는다')
  assert.ok(st.gains.some(g => g > 1), `조용한 녹음에 보정 게인이 붙어야 한다: ${JSON.stringify(st.gains)}`)
  const t1 = st.times[0]
  await sleep(p, 700)
  const t2 = (await p.evaluate(() => window.__tt.playback())).times[0]
  assert.ok(t2 > t1, `재생이 진행돼야 한다 ${t1} → ${t2}`)
  assert.equal(await p.evaluate(() => window.__tt.stats().acState), 'running', '컨텍스트가 살아 있어야 소리가 난다')
})

// 정확히 짚은 스케일은 **끊기지 않고 가운데 근처에서 이어져야 한다** (사용자 요구, 2026-09-13)
// 데이터는 합성 추정이 아니라 `scripts/sim-scale.mjs` 가 **실제 분석기**에 스케일을 통과시켜 뽑은 프레임 열이다
// (80 BPM · 도레미파솔라시도시라솔파미레도 · 음정 오차 ±5 ¢ · 비브라토 ±10 ¢).
// 픽셀로 '끊김' 을 추정하지 않는다 — 트레이스는 오래된 쪽이 alpha .22 까지 흐려져 밝기 임계가 불안정하다.
// 대신 그리기 루프가 실제로 몇 개를 끊었는지(`__tt.tuner.diag().skipped`) 직접 센다.
const traceFixture = name => JSON.parse(readFileSync(join(ROOT, 'test-assets', 'trace', name + '.json'), 'utf8')).frames
  .map(f => (f.cents === null ? null : { cents: f.cents, midi: f.midi }))
await scenario('tuner trace: 정확히 짚은 스케일은 음이 바뀌어도 끊기지 않는다 (실제 분석기 출력)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500)
  await p.evaluate(f => window.__tt.tuner.inject(f), traceFixture('scale-80bpm'))
  await sleep(p, 250)
  const d = await p.evaluate(() => window.__tt.tuner.diag())
  assert.equal(d.skipped, 0, `정확히 짚은 스케일에서는 한 군데도 끊기면 안 된다 (끊김 ${d.skipped})`)
  // 그리고 가운데 근처에 머물러야 한다 — 초록 띠(±15 ¢)를 넘어 멀리 나가는 픽셀이 거의 없어야
  const spread = await p.evaluate(() => {
    const c = document.getElementById('tuner-history'), g = c.getContext('2d')
    const d = g.getImageData(0, 0, c.width, c.height).data
    const cx = c.width / 2; let far = 0, all = 0
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (Math.abs(x - cx) <= 4) continue
      const i = (y * c.width + x) * 4
      const r = d[i], g2 = d[i + 1], b = d[i + 2]
      const white = r > 120 && g2 > 120 && b > 120
      const green = g2 > 110 && g2 > r * 2.2 && g2 > b * 1.4 // in-tune 트레이스 (초록 띠 13,75,36 은 제외된다)
      if (white || green) { all++; if (Math.abs(x - cx) / (c.width / 2) > 0.6) far++ } // 0.6 = ±30 ¢
    }
    return { far, all }
  })
  assert.ok(spread.all > 0 && spread.far / spread.all < 0.05, `±30 ¢ 밖 픽셀은 5 % 미만이어야 한다 (${spread.far}/${spread.all})`)
})
await scenario('tuner trace: 음정이 크게 흔들린 연주에서는 가짜 통과선을 끊는다 (규칙이 실제로 작동)', 'silence_lowfloor.wav', async p => {
  await p.goto(URL_); await sleep(p, 1500)
  await p.evaluate(f => window.__tt.tuner.inject(f), traceFixture('scale-80bpm-outoftune'))
  await sleep(p, 250)
  const d = await p.evaluate(() => window.__tt.tuner.diag())
  // 경계 프레임을 버리고 나면 남는 '가짜 통과선' 은 많지 않다 — 규칙이 실제로 발동하는지만 본다
  assert.ok(d.skipped >= 1, `±40 ¢ 로 흔들린 연주에서는 가짜 통과선을 끊어야 한다 (끊김 ${d.skipped})`)
})

try { process.kill(-server.pid, 'SIGTERM') } catch { server.kill() }
let fail = 0
for (const [n, r] of results) { if (r !== 'ok' && !r.startsWith('NO')) fail++; console.log((r === 'ok' ? '  ok   ' : r.startsWith('NO') ? '  note ' : '  FAIL ') + n + (r === 'ok' ? '' : '  → ' + r)) }
console.log(`\n${results.length - fail} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
