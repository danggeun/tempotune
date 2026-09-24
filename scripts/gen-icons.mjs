#!/usr/bin/env node
// 앱 아이콘 생성 — 원본 그림(resources/icon-src.png, 1024² 풀블리드)에서 플랫폼별 파일을 뽑는다. 그림은 손대지 않고 규격만 맞춘다.
//   · iOS / PWA 'any':  풀블리드 그대로 (OS 가 스퀘어클로 깎는다 — 미리 둥글면 안 된다)
//   · PWA maskable:     그림을 중앙 지름 80 % 원 안으로
//   · Android adaptive: 전경은 그림을 중앙 66 % 안으로, 배경은 크림 단색. 밀도별로 직접 렌더
//   · Android 13 테마:  그림 실루엣을 흰색으로
// '그림' 은 크림과 충분히 다른 픽셀(ΔRGB 합 > 120). 크림은 원본 모서리 색. 사용: node scripts/gen-icons.mjs [--out DIR]
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUTDIR = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null
export const SRC = 'resources/icon-src.png'
export const MASKABLE_CIRCLE = 0.74   // 규격 80 % 에 6 %p 여유
export const ADAPTIVE_SAFE = 0.66     // 108dp 중 보이는 72dp
export const ADAPTIVE_PX = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }
const INK_THRESHOLD = 120

const PAGE = '<!doctype html><html><head><style>html,body{margin:0}</style></head><body><canvas id=c></canvas><img id=i></body></html>'

/** 브라우저 안에서 실행 — 원본을 읽어 그림 bbox 와 크림 색을 재고, 요청한 방식으로 그린다 */
const drawFn = async (P) => {
  const img = document.getElementById('i'); img.src = P.src; await img.decode()
  const S = P.S, c = document.getElementById('c'); c.width = S; c.height = S; const x = c.getContext('2d')
  // 원본을 임시 캔버스에 그려 그림 bbox 와 크림 색을 잰다
  const t = document.createElement('canvas'); t.width = img.width; t.height = img.height
  const tx = t.getContext('2d'); tx.drawImage(img, 0, 0); const d = tx.getImageData(0, 0, t.width, t.height).data
  const cr = [d[(3 * t.width + 3) * 4], d[(3 * t.width + 3) * 4 + 1], d[(3 * t.width + 3) * 4 + 2]]
  let x0 = t.width, x1 = -1, y0 = t.height, y1 = -1
  for (let yy = 0; yy < t.height; yy++) for (let xx = 0; xx < t.width; xx++) {
    const i = (yy * t.width + xx) * 4
    if (Math.abs(d[i] - cr[0]) + Math.abs(d[i + 1] - cr[1]) + Math.abs(d[i + 2] - cr[2]) <= P.th) continue
    if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy
  }
  const aw = x1 - x0 + 1, ah = y1 - y0 + 1, acx = (x0 + x1) / 2, acy = (y0 + y1) / 2
  const cream = `rgb(${cr[0]},${cr[1]},${cr[2]})`
  // 그림을 지름 D(캔버스 비율)의 원 안에 넣는 축척: 그림 대각선이 D 가 되게
  const fitCircle = (D) => (D * S) / Math.hypot(aw, ah)
  const paintArt = (scale) => {
    const w = aw * scale, h = ah * scale
    x.imageSmoothingQuality = 'high'
    x.drawImage(img, x0, y0, aw, ah, S / 2 - w / 2, S / 2 - h / 2, w, h)
  }
  if (P.mode === 'full') { x.drawImage(img, 0, 0, S, S) }
  else if (P.mode === 'background') { x.fillStyle = cream; x.fillRect(0, 0, S, S) }
  else if (P.mode === 'maskable') { x.fillStyle = cream; x.fillRect(0, 0, S, S); paintArt(fitCircle(P.circle)) }
  else if (P.mode === 'foreground') {
    // 전경은 투명 배경 위 그림만 — 배경 레이어와 런처가 합성한다. 크림 픽셀은 잘라낸다
    paintArt(fitCircle(P.circle))
    const fd = x.getImageData(0, 0, S, S)
    for (let i = 0; i < fd.data.length; i += 4) {
      if (fd.data[i + 3] === 0) continue
      if (Math.abs(fd.data[i] - cr[0]) + Math.abs(fd.data[i + 1] - cr[1]) + Math.abs(fd.data[i + 2] - cr[2]) <= P.th) fd.data[i + 3] = 0
    }
    x.putImageData(fd, 0, 0)
  }
  else if (P.mode === 'mono') {
    // 실루엣: 그림 픽셀을 흰색으로, 나머지 투명
    const s = fitCircle(P.circle), w = aw * s, h = ah * s
    const m = document.createElement('canvas'); m.width = S; m.height = S; const mx = m.getContext('2d')
    mx.drawImage(img, x0, y0, aw, ah, S / 2 - w / 2, S / 2 - h / 2, w, h)
    const md = mx.getImageData(0, 0, S, S)
    for (let i = 0; i < md.data.length; i += 4) {
      const on = md.data[i + 3] > 0 && Math.abs(md.data[i] - cr[0]) + Math.abs(md.data[i + 1] - cr[1]) + Math.abs(md.data[i + 2] - cr[2]) > P.th
      md.data[i] = md.data[i + 1] = md.data[i + 2] = 255; md.data[i + 3] = on ? 255 : 0
    }
    x.putImageData(md, 0, 0)
  }
  return { cream: `#${cr.map(v => v.toString(16).padStart(2, '0')).join('')}`, artW: aw / t.width, artH: ah / t.height, circle: Math.hypot(aw, ah) / t.width, acx: acx / t.width, acy: acy / t.height }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const srcData = 'data:image/png;base64,' + readFileSync(join(ROOT, SRC)).toString('base64')
let info = null
async function render(size, mode, opts = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(PAGE)
  info = await page.evaluate(drawFn, { src: srcData, S: size, mode, th: INK_THRESHOLD, circle: opts.circle ?? 1 })
  const buf = await page.screenshot({ type: 'png', omitBackground: mode === 'mono' || mode === 'foreground' }); await page.close(); return buf
}
mkdirSync(join(ROOT, 'resources', 'android'), { recursive: true }); mkdirSync(join(ROOT, 'www/public/icons'), { recursive: true })
const full = await render(1024, 'full')
if (OUTDIR) { mkdirSync(OUTDIR, { recursive: true }); writeFileSync(join(OUTDIR, 'preview.png'), full); await browser.close(); console.log('preview written', info); process.exit(0) }
writeFileSync(join(ROOT, 'resources/icon.png'), full)
writeFileSync(join(ROOT, 'www/public/icons/icon-512.png'), await render(512, 'full'))
writeFileSync(join(ROOT, 'www/public/icons/icon-192.png'), await render(192, 'full'))
writeFileSync(join(ROOT, 'www/public/icons/icon-maskable-512.png'), await render(512, 'maskable', { circle: MASKABLE_CIRCLE }))
writeFileSync(join(ROOT, 'resources/icon-background.png'), await render(1024, 'background'))
writeFileSync(join(ROOT, 'resources/icon-foreground.png'), await render(1024, 'foreground', { circle: ADAPTIVE_SAFE * 0.94 }))
for (const [density, px] of Object.entries(ADAPTIVE_PX)) // 밀도별 정식 크기로 직접 렌더
  writeFileSync(join(ROOT, `resources/android/ic_launcher_foreground-${density}.png`), await render(px, 'foreground', { circle: ADAPTIVE_SAFE * 0.94 }))
writeFileSync(join(ROOT, 'resources/icon-monochrome.png'), await render(1024, 'mono', { circle: ADAPTIVE_SAFE * 0.94 }))
await browser.close()
console.log(`icons written — 원본 그림 ${(info.artW * 100).toFixed(0)}×${(info.artH * 100).toFixed(0)} %, 대각선 ${(info.circle * 100).toFixed(0)} %, 크림 ${info.cream}`)
