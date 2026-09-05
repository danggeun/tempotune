#!/usr/bin/env node
// 시각 회귀 스크린샷 — 라이트/다크 × 주요 화면을 폰 크기(390×844 @2x)로 찍는다.
// 사용: node scripts/screenshots.mjs [--out test-assets/screens/current] [--compare test-assets/screens/baseline]
// 왜: 리팩토링 중 "의도치 않은 UI 변화"를 픽셀 단위로 잡기 위해. 기준선과 비교하면 diff 이미지를 만든다.
// 전제: `npx vite build --base=/ && npx vite preview --base=/ --port 4173` 이 떠 있거나, --serve 로 이 스크립트가 직접 띄운다.
import { chromium } from 'playwright'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execSync } from 'node:child_process'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean))
const OUT = typeof args.out === 'string' ? args.out : join(ROOT, 'test-assets', 'screens', 'current')
const BASE = typeof args.compare === 'string' ? args.compare : null
const PORT = 4173
mkdirSync(OUT, { recursive: true })

let server = null
if (args.serve) {
  execSync('npx vite build --base=/', { cwd: ROOT, stdio: 'ignore' })
  server = spawn('npx', ['vite', 'preview', '--base=/', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' })
  await new Promise(r => setTimeout(r, 2500))
}

const exe = process.env.CHROMIUM_PATH || undefined
// 가짜 마이크에 '거의 무음' WAV를 물려 튜너가 결정적인 상태(음 없음)가 되게 한다. (기본 가짜 장치는 톤을 내서 바늘이 움직여 픽셀 diff가 생김)
const SILENCE = join(ROOT, 'test-assets', 'signals', 'silence_lowfloor.wav')
if (!existsSync(SILENCE)) execSync('node scripts/gen-signals.mjs', { cwd: ROOT, stdio: 'ignore' })
const browser = await chromium.launch({ executablePath: exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${SILENCE}%noloop`] })

// 화면 시나리오: 이름 → 준비 동작. 애니메이션이 끝날 시간을 준다.
const SCENES = {
  main: async p => {},
  metro_open: async p => { await p.click('#metro-collapse-btn'); await p.waitForTimeout(600) },
  menu: async p => { await p.click('#menu-btn'); await p.waitForTimeout(600) },
  settings: async p => { await p.click('#menu-btn'); await p.waitForTimeout(400); await p.click('#settings-open-btn'); await p.waitForTimeout(500) },
  editor: async p => { await p.evaluate(() => { document.getElementById('editor-page').style.display = 'flex' }); await p.waitForTimeout(300) },
}

const results = []
for (const scheme of ['light', 'dark']) {
  for (const [name, prep] of Object.entries(SCENES)) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, permissions: ['microphone'] })
    const page = await ctx.newPage()
    await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(1500)
    await page.addStyleTag({ content: '*,*::before,*::after{animation-play-state:paused!important;caret-color:transparent!important}' })
    await prep(page)
    const file = join(OUT, `${scheme}_${name}.png`)
    await page.screenshot({ path: file })
    let diff = null
    if (BASE) {
      const bf = join(BASE, `${scheme}_${name}.png`)
      if (existsSync(bf)) {
        const a = PNG.sync.read(readFileSync(bf)), b = PNG.sync.read(readFileSync(file))
        if (a.width === b.width && a.height === b.height) {
          const d = new PNG({ width: a.width, height: a.height })
          const n = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: 0.1 })
          diff = { pixels: n, pct: 100 * n / (a.width * a.height) }
          if (n > 0) writeFileSync(join(OUT, `${scheme}_${name}.diff.png`), PNG.sync.write(d))
        } else diff = { pixels: -1, pct: NaN, note: 'size mismatch' }
      } else diff = { pixels: -1, pct: NaN, note: 'no baseline' }
    }
    results.push({ scene: `${scheme}_${name}`, diff })
    await ctx.close()
  }
}
await browser.close(); server?.kill()

let bad = 0
for (const r of results) {
  const d = r.diff
  const s = d ? (d.pixels < 0 ? d.note : `${d.pct.toFixed(3)}% (${d.pixels}px)`) : 'captured'
  if (d && (d.pixels > 0 || d.pixels < 0)) bad++
  console.log(`${r.scene.padEnd(18)} ${s}`)
}
if (BASE && bad) { console.log(`\n${bad} scene(s) differ from baseline — inspect *.diff.png in ${OUT}`); process.exit(1) }
