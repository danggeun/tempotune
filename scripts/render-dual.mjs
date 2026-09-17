#!/usr/bin/env node
// 중음(더블스톱) 표시 전/후 렌더 — 실제 앱·실제 카드에 프레임을 주입해 그림으로 비교한다 (B17).
// 사용: node scripts/render-dual.mjs [--dist dist] [--out test-assets/dual] [--port 4177]
// 왜: "아래 음을 28 ¢ 틀리게 짚었는데 화면이 0 ¢ · 초록으로 완벽이라 말한다" 를 전/후 그림으로 증명한다.
//     '전'(v2.0.1) 은 같은 소리에서 둘째 성부를 주입하지 않은 화면 = 그때의 실제 화면과 같다.
import { chromium } from 'playwright'
import { waitForServer } from './lib/wait-server.mjs'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean))
const DIST = resolve(typeof args.dist === 'string' ? args.dist : join(ROOT, 'dist'))
const OUT = resolve(typeof args.out === 'string' ? args.out : join(ROOT, 'test-assets', 'dual'))
const PORT = +(args.port || 4177)
mkdirSync(OUT, { recursive: true })
if (!existsSync(join(DIST, 'index.html'))) execSync('npx vite build --base=/', { cwd: ROOT, stdio: 'ignore' })
const SIG = join(ROOT, 'test-assets', 'signals')
if (!existsSync(join(SIG, 'silence_lowfloor.wav'))) execSync('node scripts/gen-signals.mjs', { cwd: ROOT, stdio: 'ignore' })
const server = spawn('npx', ['-y', 'serve', '-s', '-l', String(PORT), DIST], { stdio: 'ignore', detached: process.platform !== 'win32', shell: process.platform === 'win32' })
await waitForServer(`http://localhost:${PORT}/`)

const exe = process.env.CHROMIUM_PATH || undefined
const browser = await chromium.launch({ executablePath: exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${join(SIG, 'silence_lowfloor.wav')}%noloop`, '--autoplay-policy=no-user-gesture-required'] })
/** 패널마다 새 컨텍스트 — 살아 있는 분석기 프레임과 섞이지 않게 (render-trace.mjs 와 같은 이유) */
async function shot(name, frames) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', permissions: ['microphone'] })
  const page = await ctx.newPage()
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForTimeout(1800)
  await page.evaluate(() => window.__tt.closeMic()) // 실시간 무음 프레임이 주입값을 덮어쓰지 않게
  await page.waitForTimeout(300)
  await page.addStyleTag({ content: '*,*::before,*::after{animation-play-state:paused!important}' })
  await page.evaluate(fr => window.__tt.tuner.inject(fr), frames)
  await page.waitForTimeout(300)
  const state = await page.evaluate(() => ({
    dual: document.getElementById('tuner-dual').textContent,
    glow: document.getElementById('tuner-card').classList.contains('in-tune'),
  }))
  await page.locator('#tuner-card').screenshot({ path: join(OUT, name + '.png') })
  await ctx.close()
  console.log(`  ${name.padEnd(34)} 카드 글로우 ${state.glow ? '켜짐' : '꺼짐'}  둘째 줄 "${state.dual}"`)
  return state
}
// 라4(−28 ¢) + 도♯5(+2 ¢) 를 같이 켠 상황 — 화면은 위 성부(도♯5)를 보여준다
const UP = { cents: 2, midi: 73 }
const rows = []
rows.push(['v2.0.1 (같은 소리)', await shot('01_before_v201', Array(8).fill(UP))])
rows.push(['v2.0.2 — 아래 음이 틀림', await shot('02_after_lower_off', Array(8).fill({ ...UP, dualMidi: 69, dualCents: -28 }))])
rows.push(['v2.0.2 — 둘 다 맞음', await shot('03_after_both_ok', Array(8).fill({ ...UP, dualMidi: 69, dualCents: -3 }))])
writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset=utf-8><title>더블스톱 표시 전/후</title>
<style>body{background:#111;color:#eee;font:13px/1.6 system-ui;padding:20px}figure{display:inline-block;margin:0 14px 14px 0}img{width:330px;border-radius:10px;display:block}figcaption{padding-top:6px;color:#bbb}</style>
<h1>더블스톱 표시 전/후 (B17)</h1><p>같은 소리: 라4를 28 ¢ 낮게 짚은 장3도 중음 (라4 −28 ¢ + 도♯5 +2 ¢)</p>
${['01_before_v201', '02_after_lower_off', '03_after_both_ok'].map((f, i) => `<figure><img src="${f}.png"><figcaption>${rows[i][0]}<br>글로우 ${rows[i][1].glow ? '켜짐' : '꺼짐'} · "${rows[i][1].dual || '—'}"</figcaption></figure>`).join('')}`)
await browser.close()
try { process.kill(process.platform === 'win32' ? server.pid : -server.pid) } catch {}
console.log(`\n→ ${join(OUT, 'index.html')}`)
