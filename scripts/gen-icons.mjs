#!/usr/bin/env node
// 앱 아이콘 생성 — 검정 타일 위 워드마크 'Go'(Cormorant Garamond 600 italic) + 초록 게이지(허용 띠 + 흰 바늘).
//
// 로고 공모 기록 (docs/UX-AUDIT.md §9): 후보 14안 → 3인 독립 심사(브랜드 디자이너·앱스토어 마케터·현악 연주자)
// → 하이브리드 6안 재심사 → 사용자가 W1(이 안) 확정 → 두 심사가 각각 정밀 스펙 제시 → 아래 값으로 수렴.
//
// 왜 이 형태인가
//   · 검정 타일 + 세리프 이탤릭: 흰/파랑 + 바늘 일색인 튜너 앱 그리드에서 유일하게 튀고, 인앱 워드마크·검정 무대와 한 가족
//   · 초록은 '면적' 이 아니라 '선' 으로만 (면적이면 돈·에코·성공으로 새고, 앱의 '초록 = 맞음' 규칙이 아이콘에서 먼저 깨진다)
//   · 흰 바늘 = 인앱 게이지의 지침. 가로 막대의 '로딩바' 오독을 형태로 끊는다 (연주자 요구)
//   · 띠는 글자보다 좁다 — 밑줄은 정의상 단어를 덮으므로, 단어보다 짧으면 밑줄로 읽히지 않는다 (브랜드 디자이너 요구)
//
// 비례는 잉크 바운딩박스 실측 기준(캔버스 2D). CSS font-size 로는 이탤릭 사이드베어링 때문에 비례가 맞지 않는다.
// 36 px 다운샘플 실측: 띠 160 / 바늘 244 (대비 +84) — 바늘 폭 2.0 % 에서는 +68 로 흐려져 2.6 % 를 하한으로 잡았다.
//
// 사용: node scripts/gen-icons.mjs [--concept bar|o|ra]
//   bar  W1 — 최종 채택
//   o    C2 — 합산 1위였던 차점안 (o 만 초록). 기록·비교용
//   ra   1차 후보였던 한글 '라' (한국 특정으로 기각). 기록용
//
// 산출:
//   resources/icon.png             1024²  전면 배경(알파 없음) → @capacitor/assets 입력
//   resources/icon-foreground.png  1024²  투명 배경 + 마크 (adaptive 전경, 중앙 66 % 안전영역 안)
//   resources/icon-background.png  1024²  단색 배경 (adaptive 배경)
//   resources/icon-monochrome.png  1024²  Android 13 테마 아이콘용 — 바늘을 '구멍' 으로 (단색 틴트에서 흰 바늘은 사라지므로)
//   www/public/icons/icon-192.png / icon-512.png / icon-maskable-512.png   PWA
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const font = readFileSync(join(ROOT, 'www/src/fonts/cormorant-garamond-latin-600-italic.woff2')).toString('base64')
const CONCEPT = process.argv.includes('--concept') ? process.argv[process.argv.indexOf('--concept') + 1] : 'bar'

/** 락업 비례 — 전부 캔버스 한 변(S) 대비, content = 0.72(전면 아이콘) 기준. 다른 content 는 비례 축소된다. */
const SPEC = {
  bg: '#0d0d0e',      // 순검정(#000)은 OLED 다크 홈에서 타일 경계가 사라지고, 살짝 든 값이 초록을 계측기 색으로 보이게 한다
  ink: '#ffffff',
  green: '#22c55e',
  inkW: 0.465,        // 'Go' 잉크 폭
  inkTop: 0.250,      // 잉크 상단
  bandW: 0.75,        // 띠 폭 = 잉크 폭의 75 % (글자보다 좁아야 밑줄로 안 읽힌다)
  bandH: 0.046,       // 띠 두께 ≈ Cormorant 'o' 의 굵은 획(4.3 %)
  gap: 0.038,         // 잉크 하단 ↔ 띠 상단 (활자 밑줄 거리에서 확실히 이탈)
  needleW: 0.026,     // 바늘 폭 — 36 px 생존 하한
  over: 0.014,        // 띠 위·아래 돌출 (닫힌 알약 실루엣을 깨서 진행바 오독 제거)
  shiftX: 0.008, shiftY: 0.005, // 이탤릭 무게가 오른쪽·아래로 쏠려 광학 보정
}
const PAGE = `<!doctype html><html><head><style>
@font-face{font-family:'CG';font-style:italic;font-weight:600;src:url(data:font/woff2;base64,${font}) format('woff2')}
html,body{margin:0}</style></head><body><canvas id=c></canvas></body></html>`

const drawFn = (P) => {
  const S = P.S, k = P.content / 0.72
  const c = document.getElementById('c'); c.width = S; c.height = S
  const x = c.getContext('2d')
  if (!P.transparent) { x.fillStyle = P.mono ? '#000000' : P.bg; x.fillRect(0, 0, S, S) }
  const ink = P.mono ? '#ffffff' : P.ink
  if (P.concept === 'ra') {
    const fs = 0.86 * S * k
    x.font = '500 ' + fs + 'px "Noto Sans KR","Noto Sans CJK KR",sans-serif'
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = P.mono ? ink : P.green
    if (!P.mono) { x.shadowColor = 'rgba(34,197,94,.9)'; x.shadowBlur = 0.10 * S * k }
    x.fillText('라', S / 2, S / 2); x.shadowBlur = 0
    return
  }
  // 잉크 폭 목표에 맞춰 폰트 크기 역산
  const target = P.inkW * S * k
  x.font = 'italic 600 100px CG'
  let m = x.measureText('Go')
  const fs = 100 * target / (m.actualBoundingBoxRight + m.actualBoundingBoxLeft)
  x.font = 'italic 600 ' + fs + 'px CG'
  m = x.measureText('Go')
  const iw = m.actualBoundingBoxRight + m.actualBoundingBoxLeft, ih = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
  const cx = S / 2 - P.shiftX * S * k, top = (P.inkTop - P.shiftY) * S * k
  x.textAlign = 'left'; x.textBaseline = 'alphabetic'
  if (P.concept === 'o') {
    // C2 — 세리프 헤어라인이 작은 크기에서 끊기지 않게 아이콘 전용 광학 보정(본문 워드마크는 손대지 않는다)
    const oy = top + ih / 2 + m.actualBoundingBoxAscent - ih / 2
    const st = 0.008 * S * k
    x.lineJoin = 'round'
    x.fillStyle = ink; x.strokeStyle = ink; x.lineWidth = st
    x.strokeText('Go', cx - iw / 2 + m.actualBoundingBoxLeft, oy); x.fillText('Go', cx - iw / 2 + m.actualBoundingBoxLeft, oy)
    const gw = x.measureText('G').width
    x.fillStyle = P.mono ? '#8f8f8f' : P.green; x.strokeStyle = x.fillStyle; x.lineWidth = st * 1.8
    x.strokeText('o', cx - iw / 2 + m.actualBoundingBoxLeft + gw, oy); x.fillText('o', cx - iw / 2 + m.actualBoundingBoxLeft + gw, oy)
    return
  }
  // bar — 최종안
  x.fillStyle = ink
  x.fillText('Go', cx - iw / 2 + m.actualBoundingBoxLeft, top + m.actualBoundingBoxAscent)
  const bw = P.bandW * iw, bh = P.bandH * S * k, by = top + ih + P.gap * S * k
  x.fillStyle = P.mono ? ink : P.green
  x.beginPath(); x.roundRect(cx - bw / 2, by, bw, bh, bh / 2); x.fill()
  const nw = P.needleW * S * k, ov = P.over * S * k
  if (P.mono) { // 단색 틴트에서는 흰 바늘이 사라지므로 구멍으로 (구멍은 좀 더 넓게)
    x.globalCompositeOperation = 'destination-out'
    x.beginPath(); x.roundRect(cx - nw * 0.7, by - ov, nw * 1.4, bh + ov * 2, nw * 0.7); x.fill()
    x.globalCompositeOperation = 'source-over'
  } else {
    x.fillStyle = ink
    x.beginPath(); x.roundRect(cx - nw / 2, by - ov, nw, bh + ov * 2, nw / 2); x.fill()
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
async function render(size, content, opts = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(PAGE); await page.evaluate(() => document.fonts.ready)
  await page.evaluate(drawFn, { ...SPEC, S: size, content, concept: CONCEPT, transparent: false, mono: false, ...opts })
  const buf = await page.screenshot({ type: 'png', omitBackground: !!opts.transparent }); await page.close(); return buf
}
function resize(pngBuf, size) { // 정수 배 다운샘플 (박스 평균)
  const src = PNG.sync.read(pngBuf); const out = new PNG({ width: size, height: size }); const k = src.width / size
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0
    for (let yy = Math.floor(y * k); yy < Math.floor((y + 1) * k); yy++) for (let xx = Math.floor(x * k); xx < Math.floor((x + 1) * k); xx++) { const i = (yy * src.width + xx) * 4; r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; a += src.data[i + 3]; n++ }
    const o = (y * size + x) * 4; out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = a / n
  }
  return PNG.sync.write(out)
}
mkdirSync(join(ROOT, 'resources'), { recursive: true }); mkdirSync(join(ROOT, 'www/public/icons'), { recursive: true })
const full = await render(1024, 0.72)
writeFileSync(join(ROOT, 'resources/icon.png'), full)
writeFileSync(join(ROOT, 'www/public/icons/icon-512.png'), resize(full, 512))
writeFileSync(join(ROOT, 'www/public/icons/icon-192.png'), resize(full, 192))
// maskable: 원형 마스크에도 잘리지 않게 콘텐츠를 중앙 안전영역 안으로
writeFileSync(join(ROOT, 'www/public/icons/icon-maskable-512.png'), resize(await render(1024, 0.58), 512))
writeFileSync(join(ROOT, 'resources/icon-foreground.png'), await render(1024, 0.52, { transparent: true }))
writeFileSync(join(ROOT, 'resources/icon-monochrome.png'), await render(1024, 0.52, { transparent: true, mono: true }))
const bg = new PNG({ width: 1024, height: 1024 })
const [r, g, b] = [SPEC.bg.slice(1, 3), SPEC.bg.slice(3, 5), SPEC.bg.slice(5, 7)].map(h => parseInt(h, 16))
for (let i = 0; i < bg.data.length; i += 4) { bg.data[i] = r; bg.data[i + 1] = g; bg.data[i + 2] = b; bg.data[i + 3] = 255 }
writeFileSync(join(ROOT, 'resources/icon-background.png'), PNG.sync.write(bg))
await browser.close()
console.log(`icons written (concept: ${CONCEPT}) — resources/icon*.png, www/public/icons/*.png`)
