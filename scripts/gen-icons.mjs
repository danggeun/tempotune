#!/usr/bin/env node
// 앱 아이콘 생성 — resources/ 의 SVG 레이어(1024² 뷰박스)에서 플랫폼별 PNG 를 뽑는다. 그림은 SVG 에서만 고친다.
//   · iOS / PWA 'any':  icon.svg 를 풀블리드 그대로 (OS 가 스퀘어클로 깎는다 — 미리 둥글면 안 된다)
//   · PWA maskable:     배경 + 전경을 중앙 원 안으로
//   · Android adaptive: 전경(투명, 바닥 그림자 없음)을 중앙 66 % 안으로, 배경은 icon-background. 밀도별로 직접 렌더
//   · Android 13 테마:  icon-monochrome(흰 실루엣) — 전경과 같은 맞춤으로 밀도별 렌더
//   · 브라우저 탭:      favicon.svg(글자가 안 읽히는 크기라 호 T 한 글자) → 32 px
// 사용: node scripts/gen-icons.mjs [--out DIR]
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUTDIR = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null
export const LAYERS = { full: 'resources/icon.svg', background: 'resources/icon-background.svg', foreground: 'resources/icon-foreground.svg', mono: 'resources/icon-monochrome.svg', favicon: 'resources/favicon.svg' }
export const MASKABLE_CIRCLE = 0.74   // 규격 80 % 에 6 %p 여유
export const ADAPTIVE_SAFE = 0.66     // 108dp 중 보이는 72dp
export const ADAPTIVE_PX = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }
export const WEB_ICON_PX = [144, 180, 192, 512]   // 안드로이드 런처 xxhdpi·xxxhdpi(144·192), 아이폰 홈 화면 60pt×3(180), 스플래시·공유(512)
export const MASKABLE_PX = [144, 192, 512]

const PAGE = '<!doctype html><html><head><style>html,body{margin:0}</style></head><body><canvas id=c></canvas></body></html>'

/** 브라우저 안에서 실행 — SVG 를 벡터 그대로 목표 크기에 그린다. 맞춤 모드면 잉크 bbox 대각선을 지름 circle 원에 넣는다.
 *  snap: 글자 층을 ¼ px 단위로 옮겨 보며 가장자리가 가장 또렷한 자리(획이 픽셀 경계에 가장 잘 맞는 자리)를 고른다 — 작은 아이콘에서 흐림을 줄인다 */
const drawFn = async (P) => {
  const load = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i }
  const S = P.S, c = document.getElementById('c'); c.width = S; c.height = S; const x = c.getContext('2d')
  const bg = P.bg ? await load(P.bg) : null
  if (!P.art) { x.drawImage(bg, 0, 0, S, S); return null }
  const art = await load(P.art)
  let k = S / 1024, ox = 0, oy = 0, info = null
  if (P.circle) { // 원본 크기로 한 번 그려 잉크(알파) 범위를 잰다
    const N = 1024, t = document.createElement('canvas'); t.width = N; t.height = N
    const tx = t.getContext('2d'); tx.drawImage(art, 0, 0, N, N); const d = tx.getImageData(0, 0, N, N).data
    let x0 = N, x1 = -1, y0 = N, y1 = -1
    for (let yy = 0; yy < N; yy++) for (let xx = 0; xx < N; xx++) {
      if (d[(yy * N + xx) * 4 + 3] < 24) continue
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy
    }
    const aw = x1 - x0 + 1, ah = y1 - y0 + 1
    k = (P.circle * S) / Math.hypot(aw, ah); ox = S / 2 - (x0 + aw / 2) * k; oy = S / 2 - (y0 + ah / 2) * k
    info = { artW: aw / N, artH: ah / N, diag: Math.hypot(aw, ah) / N }
  }
  const place = (dx, dy) => { x.clearRect(0, 0, S, S); if (bg) x.drawImage(bg, 0, 0, S, S); x.drawImage(art, ox + dx, oy + dy, 1024 * k, 1024 * k) }
  const edge = () => { // 밝기×알파의 라플라시안 분산 — 클수록 가장자리가 또렷하다
    const d = x.getImageData(0, 0, S, S).data, v = new Float32Array(S * S)
    for (let i = 0; i < S * S; i++) v[i] = (0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]) * d[i * 4 + 3] / 255
    let sum = 0, sq = 0, n = 0
    for (let yy = 1; yy < S - 1; yy++) for (let xx = 1; xx < S - 1; xx++) {
      const i = yy * S + xx, l = Math.abs(4 * v[i] - v[i - 1] - v[i + 1] - v[i - S] - v[i + S]); sum += l; sq += l * l; n++
    }
    return sq / n - (sum / n) ** 2
  }
  let best = [0, 0]
  if (P.snap) {
    let top = -1
    for (const dx of [0, 0.25, 0.5, 0.75]) for (const dy of [0, 0.25, 0.5, 0.75]) { place(dx, dy); const e = edge(); if (e > top) { top = e; best = [dx, dy] } }
  }
  place(...best)
  return info
}

const svg = (f) => 'data:image/svg+xml;base64,' + readFileSync(join(ROOT, f)).toString('base64')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
let info = null
async function render(size, mode, circle = 0) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(PAGE)
  const P = {
    full: { bg: svg(LAYERS.background), art: svg(LAYERS.full), snap: true }, // 배경을 먼저 깔아 두면 ¼ px 옮겨도 가장자리가 비지 않는다
    background: { bg: svg(LAYERS.background) },
    maskable: { bg: svg(LAYERS.background), art: svg(LAYERS.foreground), circle, snap: true },
    foreground: { art: svg(LAYERS.foreground), circle, snap: true },
    mono: { art: svg(LAYERS.mono), circle, snap: true },
    favicon: { art: svg(LAYERS.favicon) }, // 타일까지 한 그림이라 옮기지 않는다
  }[mode]
  info = (await page.evaluate(drawFn, { S: size, ...P })) ?? info
  const buf = await page.screenshot({ type: 'png', omitBackground: mode === 'mono' || mode === 'foreground' || mode === 'favicon' }); await page.close(); return buf
}
mkdirSync(join(ROOT, 'resources', 'android'), { recursive: true }); mkdirSync(join(ROOT, 'www/public/icons'), { recursive: true })
const full = await render(1024, 'full')
if (OUTDIR) { mkdirSync(OUTDIR, { recursive: true }); writeFileSync(join(OUTDIR, 'preview.png'), full); await browser.close(); console.log('preview written'); process.exit(0) }
writeFileSync(join(ROOT, 'resources/icon.png'), full)
// 홈 화면·런처가 쓰는 크기마다 SVG 에서 바로 그린다 — 다른 크기를 줄여 쓰면(192 → 180 등) 글자 가장자리가 흐려진다
for (const px of WEB_ICON_PX) writeFileSync(join(ROOT, `www/public/icons/icon-${px}.png`), await render(px, 'full'))
for (const px of MASKABLE_PX) writeFileSync(join(ROOT, `www/public/icons/icon-maskable-${px}.png`), await render(px, 'maskable', MASKABLE_CIRCLE))
writeFileSync(join(ROOT, 'resources/icon-background.png'), await render(1024, 'background'))
writeFileSync(join(ROOT, 'resources/icon-foreground.png'), await render(1024, 'foreground', ADAPTIVE_SAFE * 0.94))
for (const [density, px] of Object.entries(ADAPTIVE_PX)) { // 밀도별 정식 크기로 직접 렌더
  writeFileSync(join(ROOT, `resources/android/ic_launcher_foreground-${density}.png`), await render(px, 'foreground', ADAPTIVE_SAFE * 0.94))
  writeFileSync(join(ROOT, `resources/android/ic_launcher_monochrome-${density}.png`), await render(px, 'mono', ADAPTIVE_SAFE * 0.94))
}
writeFileSync(join(ROOT, 'resources/icon-monochrome.png'), await render(1024, 'mono', ADAPTIVE_SAFE * 0.94))
writeFileSync(join(ROOT, 'www/public/icons/favicon-32.png'), await render(32, 'favicon'))
await browser.close()
console.log(`icons written — 잉크 ${(info.artW * 100).toFixed(0)}×${(info.artH * 100).toFixed(0)} %, 대각선 ${(info.diag * 100).toFixed(0)} %`)
