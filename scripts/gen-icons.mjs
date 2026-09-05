#!/usr/bin/env node
// 앱 아이콘 생성 — 앱 안의 워드마크(Cormorant Garamond 600 italic)와 튜너 무대(검정)·초록 띠(맞음)를 그대로 쓴다.
// 사용: node scripts/gen-icons.mjs   (Playwright Chromium 으로 렌더 → PNG)
// 산출:
//   resources/icon.png            1024²  전면 검정(알파 없음, 모서리 각짐 — 런처/스토어가 알아서 깎는다) → @capacitor/assets 입력
//   resources/icon-foreground.png 1024²  투명 바탕 + 중앙 66% 안의 'Go' + 띠  → adaptive icon 전경
//   resources/icon-background.png 1024²  검정 단색                              → adaptive icon 배경
//   www/public/icons/icon-192.png / icon-512.png            PWA 'any'
//   www/public/icons/icon-maskable-512.png                  PWA maskable: 배경이 전체를 채우고 콘텐츠는 중앙 80% 안
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const font = readFileSync(join(ROOT, 'www/src/fonts/cormorant-garamond-latin-600-italic.woff2')).toString('base64')
const BG = '#000000', OK = '#22c55e'

/** size: 캔버스 px, content: 콘텐츠가 차지하는 비율(지름), transparent: 배경 투명 */
const html = (size, content, transparent) => `<!doctype html><html><head><style>
@font-face{font-family:'CG';font-style:italic;font-weight:600;src:url(data:font/woff2;base64,${font}) format('woff2')}
html,body{margin:0;width:${size}px;height:${size}px;background:${transparent ? 'transparent' : BG};overflow:hidden}
#wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${size * content * 0.10}px}
#go{font-family:'CG';font-style:italic;font-weight:600;color:#fff;font-size:${size * content * 0.62}px;line-height:.8;letter-spacing:-.02em;transform:translateX(-${size * content * 0.02}px)}
#bar{width:${size * content * 0.66}px;height:${size * content * 0.075}px;border-radius:${size}px;background:${OK};box-shadow:0 0 ${size * content * 0.12}px rgba(34,197,94,.55)}
</style></head><body><div id="wrap"><div id="go">Go</div><div id="bar"></div></div></body></html>`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
async function render(size, content, transparent) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(html(size, content, transparent)); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(100)
  const buf = await page.screenshot({ omitBackground: transparent, type: 'png' }); await page.close(); return buf
}
function resize(pngBuf, size) { // 정수 배 다운샘플 (1024 → 512/192 는 박스 평균)
  const src = PNG.sync.read(pngBuf); const out = new PNG({ width: size, height: size }); const k = src.width / size
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0
    for (let yy = Math.floor(y * k); yy < Math.floor((y + 1) * k); yy++) for (let xx = Math.floor(x * k); xx < Math.floor((x + 1) * k); xx++) { const i = (yy * src.width + xx) * 4; r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; a += src.data[i + 3]; n++ }
    const o = (y * size + x) * 4; out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = a / n
  }
  return PNG.sync.write(out)
}
mkdirSync(join(ROOT, 'resources'), { recursive: true }); mkdirSync(join(ROOT, 'www/public/icons'), { recursive: true })
const full = await render(1024, 0.72, false)          // 정사각 아이콘: 콘텐츠 72%
writeFileSync(join(ROOT, 'resources/icon.png'), full)
writeFileSync(join(ROOT, 'www/public/icons/icon-512.png'), resize(full, 512))
writeFileSync(join(ROOT, 'www/public/icons/icon-192.png'), resize(full, 192))
const mask = await render(1024, 0.58, false)          // maskable: 안전 영역(중앙 80%) 안에 콘텐츠 — 원형 마스크에도 잘리지 않게
writeFileSync(join(ROOT, 'www/public/icons/icon-maskable-512.png'), resize(mask, 512))
writeFileSync(join(ROOT, 'resources/icon-foreground.png'), await render(1024, 0.52, true)) // adaptive 전경: 중앙 66% 안
const bg = new PNG({ width: 1024, height: 1024 }); bg.data.fill(0); for (let i = 3; i < bg.data.length; i += 4) bg.data[i] = 255
writeFileSync(join(ROOT, 'resources/icon-background.png'), PNG.sync.write(bg))
await browser.close()
console.log('icons written: resources/icon*.png, www/public/icons/*.png')
