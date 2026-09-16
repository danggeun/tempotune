#!/usr/bin/env node
// 트레이스 비교 렌더 — 실제 앱, 실제 캔버스 크기, 합성 프레임 주입.
// 사용: node scripts/render-trace.mjs [--dist dist] [--out test-assets/trace] [--port 4176]
// 왜 (C1 · B11): "음 바뀔 때 흰 줄이 옆으로 팍팍" 과 "히스토리가 너무 길게 남는다" 를 그림으로 비교해
//     (a) 고쳐졌음을 증명하고 (b) 창 길이를 취향으로 고를 수 있게 한다. 「v2.0.2 계획」에서 승격 약속한 스크립트.
// 전/후 비교 방법: 같은 cents 열을 주입하면서 midi 를 **고정** 하면 세그먼트가 하나도 생략되지 않아
//     v2.0.1 의 그림과 정확히 같아진다(가로줄 포함). midi 를 실제대로 주면 v2.0.2 의 그림이 된다.
import { chromium } from 'playwright'
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean))
const DIST = resolve(typeof args.dist === 'string' ? args.dist : join(ROOT, 'dist'))
const OUT = resolve(typeof args.out === 'string' ? args.out : join(ROOT, 'test-assets', 'trace'))
const PORT = +(args.port || 4176)
mkdirSync(OUT, { recursive: true })
if (!existsSync(join(DIST, 'index.html'))) execSync('npx vite build --base=/', { cwd: ROOT, stdio: 'ignore' })
const SIG = join(ROOT, 'test-assets', 'signals')
if (!existsSync(join(SIG, 'silence_lowfloor.wav'))) execSync('node scripts/gen-signals.mjs', { cwd: ROOT, stdio: 'ignore' })

const server = spawn('npx', ['-y', 'serve', '-s', '-l', String(PORT), DIST], { stdio: 'ignore', detached: process.platform !== 'win32', shell: process.platform === 'win32' })
await new Promise(r => setTimeout(r, 2500))

// ── 합성 프레임: 실제 연주의 통계를 쓴다 ──
// 「실측 발견 — 확정 버그」: 한 음이 유지되는 길이 중앙값 6프레임(128 ms), 빠른 패시지는 초당 7~8회 전환.
// 음 안에서는 프레임 간 변화 중앙 0.7 센트(이미 매끄럽다) + 비브라토 성분.
function frames({ fps = 46.875, seconds = 9, kind = 'fast' } = {}) {
  const n = Math.round(fps * seconds), out = []
  let midi = 69, cents = -35, i = 0
  const hold = kind === 'fast' ? 6 : Math.round(fps * 1.4) // 빠른 패시지 128 ms / 느린 음 1.4 s
  const scale = [69, 71, 73, 74, 76, 74, 73, 71] // 라 시 도♯ 레 미 …
  let si = 0, left = hold
  for (; i < n; i++) {
    if (--left <= 0) { si = (si + 1) % scale.length; midi = scale[si]; cents = (si % 2 ? 1 : -1) * (30 + (si * 7) % 15); left = hold }
    cents += Math.sin(i / 2.6) * 1.8 + (kind === 'fast' ? 0 : Math.sin(i / 5) * 4) // 비브라토·활 흔들림
    out.push({ cents: Math.max(-50, Math.min(50, Math.round(cents))), midi })
  }
  return out
}

const exe = process.env.CHROMIUM_PATH || undefined
const browser = await chromium.launch({ executablePath: exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${join(SIG, 'silence_lowfloor.wav')}%noloop`, '--autoplay-policy=no-user-gesture-required'] })
/**
 * 패널마다 **새 컨텍스트**를 쓴다. 같은 페이지에서 연속으로 주입하면 살아 있는 분석기 프레임과 섞여
 * 가끔 캔버스가 비어 나온다 (렌더 하네스 문제. 실제 앱 동작과 무관).
 */
async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', permissions: ['microphone'] })
  const page = await ctx.newPage()
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForTimeout(1800)
  await page.addStyleTag({ content: '*,*::before,*::after{animation-play-state:paused!important}' })
  return { ctx, page }
}
const first = await freshPage()
const size = await first.page.evaluate(() => { const c = document.getElementById('tuner-history'); return { w: c.offsetWidth, h: c.offsetHeight } })
const diag0 = await first.page.evaluate(() => window.__gp.tuner.diag())
console.log(`캔버스 실측 ${size.w}×${size.h} px · 기본 창 ${diag0.sec}초 = ${diag0.len}프레임 (sr ${diag0.sr}) → ${(diag0.len / size.h).toFixed(2)} 점/px`)
await first.ctx.close()

// ── 실제 분석기가 낸 스케일 (scripts/sim-scale.mjs 출력) 전/후 ──
// '전' 은 midi 를 고정해 주입한다 → 경계 폐기도 끊기도 일어나지 않아 v2.0.1 의 그림과 같아진다.
const scaleRows = []
for (const fx of ['scale-80bpm', 'scale-80bpm-outoftune']) {
  const file = join(ROOT, 'test-assets', 'trace', fx + '.json')
  if (!existsSync(file)) { console.log(`  (건너뜀: ${fx}.json 없음 — node scripts/sim-scale.mjs --json 으로 생성)`); continue }
  const frames = JSON.parse(readFileSync(file, 'utf8')).frames
  for (const [tag, map] of [['v2.0.1', f => (f.rawCents === null ? null : { cents: f.rawCents, midi: 69 })], ['v2.0.2', f => (f.cents === null ? null : { cents: f.cents, midi: f.midi })]]) {
    const { ctx, page } = await freshPage()
    await page.evaluate(fr => window.__gp.tuner.inject(fr), frames.map(map))
    await page.waitForTimeout(250) // rAF 페인트 뒤에 읽어야 끊긴 자리 수가 갱신돼 있다
    const info = await page.evaluate(() => window.__gp.tuner.diag())
    const name = `${fx}_${tag}`
    await page.locator('#tuner-history').screenshot({ path: join(OUT, name + '.png') })
    scaleRows.push({ fx, tag, name, skipped: info.skipped })
    console.log(`  ${fx.padEnd(24)} ${tag}  끊긴 자리 ${info.skipped}`)
    await ctx.close()
  }
}
const { ctx, page } = await freshPage()

const rows = []
for (const kind of ['fast', 'slow']) {
  const data = frames({ kind })
  for (const [label, sec, flatten] of [
    ['v2.0.1_7.68s', 7.68, true],   // 전: 창 7.68초 + 가로줄 있음
    ['v2.0.2_4.0s', 4.0, false],    // 후(기본값)
    ['variant_3.0s', 3.0, false],
    ['variant_5.0s', 5.0, false],
    ['variant_4.0s_with_seam', 4.0, true], // 창만 줄이고 C1 을 안 했다면
  ]) {
    const info = await page.evaluate(([data, sec, flatten]) => {
      window.__gp.tuner.setHistSec(sec)
      const f = flatten ? data.map(d => ({ cents: d.cents, midi: 69 })) : data // midi 고정 = 세그먼트 생략이 절대 안 일어남 = v2.0.1 그림
      window.__gp.tuner.inject(f)
      return window.__gp.tuner.diag()
    }, [data, sec, flatten])
    await page.waitForTimeout(120)
    const file = join(OUT, `${kind}_${label}.png`)
    await page.locator('#tuner-history').screenshot({ path: file })
    rows.push({ kind, label, sec, gaps: !flatten, len: info.len, perPx: +(info.len / size.h).toFixed(2), file })
    console.log(`  ${kind.padEnd(5)} ${label.padEnd(24)} 창 ${String(sec).padStart(5)}초  ${String(info.len).padStart(4)}프레임  ${(info.len / size.h).toFixed(2)} 점/px`)
  }
}
// 나란히 비교할 수 있게 대비 HTML
const html = `<!doctype html><meta charset=utf-8><title>트레이스 비교</title>
<style>body{background:#111;color:#eee;font:13px/1.5 system-ui;padding:20px}
h2{margin:28px 0 8px;font-size:15px}.row{display:flex;gap:14px;flex-wrap:wrap}
figure{margin:0}figcaption{font-size:11px;color:#aaa;margin-top:6px;text-align:center}
img{display:block;background:#000;border:1px solid #333;width:${size.w}px}</style>
${['fast', 'slow'].map(k => `<h2>${k === 'fast' ? '빠른 패시지 (음 유지 128 ms — 실측 중앙값)' : '느린 음 (1.4 s)'}</h2><div class=row>` +
  rows.filter(r => r.kind === k).map(r => `<figure><img src="${r.kind}_${r.label}.png"><figcaption>${r.label}<br>${r.len}프레임 · ${r.perPx} 점/px<br>${r.gaps ? '전환선 끊음' : '전환선 있음'}</figcaption></figure>`).join('') + '</div>').join('')}`
const scaleHtml = scaleRows.length ? `<h2>실제 분석기가 낸 스케일 (도레미파솔라시도시라솔파미레도 · 80 BPM)</h2><div class=row>` +
  scaleRows.map(r => `<figure><img src="${r.name}.png"><figcaption>${r.fx.includes('outoftune') ? '음정 ±40 ¢' : '음정 ±5 ¢ (정확)'}<br>${r.tag}<br>끊긴 자리 ${r.skipped}</figcaption></figure>`).join('') + '</div>' : ''
writeFileSync(join(OUT, 'index.html'), scaleHtml + html)
console.log(`\n비교 페이지: ${join(OUT, 'index.html')}`)
await browser.close()
try { process.kill(process.platform === 'win32' ? server.pid : -server.pid) } catch { /* */ }
