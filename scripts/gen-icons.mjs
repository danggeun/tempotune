#!/usr/bin/env node
// 앱 아이콘 생성 — 검정 무대(#0a0a0a) 위 앱 워드마크 'Go'(Cormorant Garamond 600 italic).
// 로고 공모(후보 14안: 워드마크 5 · 심볼 5 · 조합 4, 검정/흰/초록 바탕)를 브랜드 디자이너 · 앱스토어 마케터 · 현악 연주자 3인이
// 6기준 × 10점으로 독립 채점: C2(o 초록) 145 · W1(게이지 띠) 136 · S3(현) 119. 채점표와 합의는 docs/UX-AUDIT.md §9.
// 세 심사 공통: 흰 바탕은 밝은 홈에서 사라지고, 초록은 '면적' 이 아니라 '선/획' 으로만 써야 앱의 규칙(초록 = 맞음)이 산다.
// 콘셉트:
//   --concept bar  W1 — Go + 초록 게이지 띠(중앙 실선·양 끝 옅게). 연주자 1위. 앱 화면과 직결
//   --concept o    C2 — Go, o 만 초록. 합산 1위. 48 px 에서 헤어라인이 사라지지 않게 아이콘 전용으로 획을 두껍게
//   --concept ra   1차 후보였던 한글 '라' (한국 특정으로 기각, 기록용)
// 사용: node scripts/gen-icons.mjs [--concept bar|o|ra]   (Playwright Chromium 으로 렌더 → PNG)
// 산출:
//   resources/icon.png            1024²  전면 검정(알파 없음, 모서리 각짐 — 런처/스토어가 알아서 깎는다) → @capacitor/assets 입력
//   resources/icon-foreground.png 1024²  투명 바탕 + 중앙 66% 안의 마크  → adaptive icon 전경
//   resources/icon-background.png 1024²  #0a0a0a 단색                    → adaptive icon 배경
//   www/public/icons/icon-192.png / icon-512.png            PWA 'any'
//   www/public/icons/icon-maskable-512.png                  PWA maskable: 배경이 전체를 채우고 콘텐츠는 중앙 80% 안
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const font = readFileSync(join(ROOT, 'www/src/fonts/cormorant-garamond-latin-600-italic.woff2')).toString('base64')
const BG = '#0a0a0a', OK = '#22c55e' // 순검정 대신 #0a0a0a: OLED 다크 홈에서 타일 경계가 남고 인앱 튜너 무대와 같은 계열

/** size: 캔버스 px, content: 콘텐츠가 차지하는 비율(지름), transparent: 배경 투명 */
const CONCEPT = process.argv.includes('--concept') ? process.argv[process.argv.indexOf('--concept') + 1] : 'bar'
const html = (size, content, transparent) => `<!doctype html><html><head><style>
@font-face{font-family:'CG';font-style:italic;font-weight:600;src:url(data:font/woff2;base64,${font}) format('woff2')}
html,body{margin:0;width:${size}px;height:${size}px;background:${transparent ? 'transparent' : BG};overflow:hidden}
#wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${size * content * 0.085}px;transform:translate(-${size * content * 0.012}px,-${size * content * 0.03}px)}
#go{font-family:'CG';font-style:italic;font-weight:600;color:#fff;font-size:${size * content * 0.70}px;line-height:.8;letter-spacing:-.03em}
/* C2 전용: 세리프 헤어라인이 48 px 에서 끊기지 않게 글자 전체를 광학 보정 (본문 워드마크는 손대지 않는다, 마케터 요구) */
#go.thick{-webkit-text-stroke:${size * content * 0.008}px #fff;paint-order:stroke fill}
/* 게이지 띠: 폭 = 'Go' 잉크 폭, 중앙 60 % 실선 + 양 끝 .38 — 밑줄이 아니라 튜너의 허용 띠 */
#bar{position:relative;width:${size * content * 0.70}px;height:${size * content * 0.085}px}
#bar i{position:absolute;inset:0;border-radius:${size}px;background:${OK};opacity:.38}
#bar b{position:absolute;top:0;bottom:0;left:20%;right:20%;border-radius:${size}px;background:${OK}}
/* 흰 바늘(중앙) — 트랙+허용 띠+바늘 = 인앱 게이지의 '맞음' 순간. 로딩바로 읽히던 것을 끊는다 (연주자 요구) */
#bar u{position:absolute;left:50%;top:${-size * content * 0.030}px;bottom:${-size * content * 0.030}px;width:${size * content * 0.020}px;transform:translateX(-50%);border-radius:${size}px;background:#fff}
/* C2: o 만 초록. Cormorant 이탤릭 o 의 얇은 획이 48 px 에서 1 px 밑으로 떨어져 '초록 얼룩' 이 되므로 아이콘 전용으로 획을 광학 보정 (본문 워드마크는 손대지 않는다) */
#go .o{color:${OK};-webkit-text-stroke:${size * content * 0.014}px ${OK};paint-order:stroke fill}
/* '라': 앱 #tuner-note 와 같은 계열(시스템 한글 Medium), 글로우는 인앱 비율(글자 크기의 .2 / .4)로 */
#ra{font-family:'Noto Sans KR','Noto Sans CJK KR','Apple SD Gothic Neo',sans-serif;font-weight:500;color:${OK};font-size:${size * content * 0.86}px;line-height:1;text-shadow:0 0 ${size * content * 0.10}px rgba(34,197,94,1),0 0 ${size * content * 0.22}px rgba(34,197,94,.55);transform:translateY(-${size * content * 0.02}px)}
</style></head><body><div id="wrap">${CONCEPT === 'o' ? '<div id="go" class="thick">G<span class="o">o</span></div>' : CONCEPT === 'ra' ? '<div id="ra">라</div>' : '<div id="go">Go</div><div id="bar"><i></i><b></b><u></u></div>'}</div></body></html>`

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
const bg = new PNG({ width: 1024, height: 1024 }); for (let i = 0; i < bg.data.length; i += 4) { bg.data[i] = 10; bg.data[i + 1] = 10; bg.data[i + 2] = 10; bg.data[i + 3] = 255 }
writeFileSync(join(ROOT, 'resources/icon-background.png'), PNG.sync.write(bg))
await browser.close()
console.log('icons written: resources/icon*.png, www/public/icons/*.png')
