#!/usr/bin/env node
// UX 후보 비교 캡처 — 여러 dist(디자인 후보)를 같은 시나리오(마이크 WAV 주입)로 찍어 나란히 비교한다.
// 사용: node scripts/ux-compare.mjs --out /tmp/ux --variant cur=dist-cur --variant v1=dist-v1 --variant v2=dist-v1:/tmp/v2.css
//   variant 형식: 이름=dist경로[:오버라이드CSS경로]  (오버라이드는 페이지에 <style> 로 주입)
// 왜: 색·경계·크기 후보를 말로 비교하지 않고 실제 화면(음 맞음/틀림, 녹음 목록, 편집기, 설정)으로 본다.
import { chromium } from 'playwright'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : '/tmp/ux-compare'
const variants = argv.flatMap((a, i) => a === '--variant' ? [argv[i + 1]] : []).map(s => {
  const [name, rest] = s.split('='); const [dist, css] = rest.split(':')
  return { name, dist: resolve(ROOT, dist), css: css ? readFileSync(resolve(ROOT, css), 'utf8') : null }
})
const only = argv.includes('--scenes') ? argv[argv.indexOf('--scenes') + 1].split(',') : null
const schemes = argv.includes('--dark-too') ? ['light', 'dark'] : ['light']
mkdirSync(OUT, { recursive: true })
const SIG = join(ROOT, 'test-assets', 'signals')
if (!existsSync(join(SIG, 'violin_A4.wav'))) execSync('node scripts/gen-signals.mjs', { cwd: ROOT, stdio: 'ignore' })
const exe = process.env.CHROMIUM_PATH || undefined

// 장면: [이름, wav, 준비]
const rec = async p => { await p.click('#rec-hdr-btn'); await p.waitForTimeout(2600); await p.click('#rec-hdr-btn'); await p.waitForTimeout(700) }
const waitNote = async (p, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(() => document.getElementById('tuner-note').textContent !== '--')) return; await p.waitForTimeout(100) } }
const SCENES = [
  ['main_intune', 'violin_A4.wav', async p => { await waitNote(p); await p.waitForTimeout(600) }],
  ['main_out', 'violin_A4_m20.wav', async p => { await waitNote(p); await p.waitForTimeout(600) }],
  ['main_metro', 'violin_A4.wav', async p => { await waitNote(p); await p.click('#metro-collapse-btn'); await p.waitForTimeout(700) }],
  ['main_metro_play', 'violin_A4.wav', async p => { await waitNote(p); await p.click('#metro-collapse-btn'); await p.waitForTimeout(700); await p.click('#metro-play-btn'); await p.waitForTimeout(1200) }],
  ['menu_rec', 'violin_A4.wav', async p => { await waitNote(p); await rec(p); await rec(p); await p.click('#menu-btn'); await p.waitForTimeout(500); await p.click('.rec-play-btn'); await p.waitForTimeout(700) }],
  ['editor', 'violin_scale_Amaj.wav', async p => {
    await waitNote(p); await p.click('#rec-hdr-btn'); await p.waitForTimeout(3500); await p.click('#rec-hdr-btn'); await p.waitForTimeout(800)
    await p.click('#menu-btn'); await p.click('[data-action="edit"][data-idx="0"]'); await p.waitForTimeout(1500)
    await p.click('#ed-play-btn'); await p.waitForTimeout(700); await p.click('#ed-a-btn'); await p.waitForTimeout(900); await p.click('#ed-b-btn'); await p.waitForTimeout(200); await p.click('#ed-bm-add-btn'); await p.waitForTimeout(600)
    await p.click('#ed-loop-btn'); await p.waitForTimeout(300)
  }],
  ['settings', 'silence_lowfloor.wav', async p => { await p.click('#menu-btn'); await p.waitForTimeout(300); await p.click('#settings-open-btn'); await p.waitForTimeout(500) }],
  ['editor_zoom', 'violin_scale_Amaj.wav', async p => {
    await waitNote(p); await p.click('#rec-hdr-btn'); await p.waitForTimeout(7000); await p.click('#rec-hdr-btn'); await p.waitForTimeout(800)
    await p.click('#menu-btn'); await p.click('[data-action="edit"][data-idx="0"]'); await p.waitForTimeout(1500)
    await p.click('#ed-play-btn'); await p.waitForTimeout(1500); await p.click('#ed-a-btn'); await p.waitForTimeout(1200); await p.click('#ed-b-btn'); await p.waitForTimeout(200); await p.click('#ed-bm-add-btn'); await p.waitForTimeout(400); await p.click('#ed-play-btn')
    await p.click('#ed-zoom-btn'); await p.waitForTimeout(300)
  }],
  ['mic_off', 'silence_lowfloor.wav', async p => { await p.evaluate(() => window.__gp.closeMic()); await p.waitForTimeout(300) }],
]

let port = 4300
for (const v of variants) {
  // detached + 프로세스 그룹 kill: npx 만 죽이면 자식 serve 가 포트를 물고 남아 다음 실행이 옛 빌드를 찍는다
  const server = spawn('npx', ['-y', 'serve', '-s', '-l', String(port), v.dist], { stdio: 'ignore', detached: process.platform !== 'win32', shell: process.platform === 'win32' })
  await new Promise(r => setTimeout(r, 2200))
  for (const [scene, wav, prep] of SCENES) {
    if (only && !only.includes(scene)) continue
    const browser = await chromium.launch({ executablePath: exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${join(SIG, wav)}`, '--autoplay-policy=no-user-gesture-required'] })
    for (const scheme of schemes) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, permissions: ['microphone'] })
      const page = await ctx.newPage()
      await page.goto(`http://localhost:${port}/`)
      if (v.css) await page.addStyleTag({ content: v.css })
      await page.waitForTimeout(1200)
      try { await prep(page) } catch (e) { console.log(`  ${v.name}/${scheme}_${scene}: prep failed: ${e.message.split('\n')[0]}`) }
      await page.screenshot({ path: join(OUT, `${v.name}__${scheme}_${scene}.png`) })
      await ctx.close()
    }
    await browser.close()
    console.log(`${v.name} ${scene} done`)
  }
  try { process.kill(-server.pid, 'SIGTERM') } catch { server.kill() }
  port++
}
