#!/usr/bin/env node
// 앱 아이콘 생성 — 초록 타일 위 흰 튜너 다이얼(호 + 눈금 + 바늘).
//
// 왜 이 형태인가 (베타 피드백 #1 · 공모 2라운드)
//   · 이전 아이콘(검정 바탕 + 얇은 세리프 'Go')은 실사용자가 "깔아 놓고도 있는 줄 몰랐다" 고 했다.
//     원인은 얇은 획 + 어두운 바탕. 홈 화면에서 사라진다.
//   · 다이얼은 "재서 맞추는 도구" 를 설명 없이 말한다. 튜너 바늘이자 메트로놈 진자의 형태다.
//   · 채도 높은 단색 바탕 + 흰 마크 하나 — 눈에 띄는 아이콘의 공통 구조.
//
// 기하는 전부 **한 중심(축)** 에서 나온다. 호·눈금·바늘·축이 같은 점을 공유하지 않으면
// 다이얼로 안 읽힌다(중심이 어긋난 시안을 만들어 보고 확인했다).
//   스윕 -152°~-28°(124°) — 반원(180°)으로 늘리면 곡률이 커져 계기판이 아니라 아치가 된다.
//   눈금은 호 **안쪽**(r 0.62~0.76 R) — 호를 가로지르면 선이 원을 뚫고 지나간 것처럼 보인다.
//   바늘 길이 0.71 R — 호보다 짧아야 '가리키는 것' 이 된다.
// 획은 전부 불투명. 이전 시안은 호 90 %·눈금 55 % 였는데, 반투명 획이 작은 크기에서 먼저 사라진다.
//
// 비례는 R(호 반지름) 하나로 묶는다. 잉크 폭 = 2(R·cos28° + 호획/2) = 1.9522 R.
//
// 사용: node scripts/gen-icons.mjs [--out DIR]
// 산출:
//   resources/icon.png             1024²  전면 배경(알파 없음) → @capacitor/assets 입력
//   resources/icon-foreground.png  1024²  투명 배경 + 마크 (adaptive 전경, 중앙 66 % 안전영역 안)
//   resources/icon-background.png  1024²  배경 그라디언트 (adaptive 배경)
//   resources/icon-monochrome.png  1024²  Android 13 테마 아이콘용 (마크를 흰 실루엣으로)
//   resources/android/ic_launcher_foreground-{density}.png  108·162·216·324·432
//   www/public/icons/icon-192.png / icon-512.png / icon-maskable-512.png   PWA
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUTDIR = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null

/** 비례 — 전부 캔버스 한 변(S) 대비. content = 0.72(전면 아이콘) 기준, 다른 content 는 비례 축소된다. */
const SPEC = {
  // 단색 — 그라디언트를 쓰면 위쪽이 밝아져 흰 마크와의 대비가 2.11:1 까지 떨어진다.
  // WCAG 1.4.11 이 비텍스트 그래픽에 요구하는 3:1 미달이었다. 단색 #189E46 은 전면에서 3.49:1.
  // ⚠ 이 색을 바꾸면 package.json 의 cap:assets(--iconBackgroundColor) 도 같이 바꿔야 한다.
  //   안드로이드 adaptive 아이콘의 배경 레이어는 그쪽에서 나온다. cap-icons.test.mjs 가 둘의 일치를 검사한다.
  bg0: '#189E46', bg1: '#189E46',
  ink: '#ffffff',
  inkW: 0.82,        // 잉크 폭 = 타일의 82 %. 이전 아이콘은 52 % 였고 "한눈에 안 띈다" 는 지적을 받았다
  lift: 0.012,       // 광학 리프트 — 정사각 타일에서 기하 중심에 두면 가라앉아 보인다
  sweep: [-152, -28],
  ticks: [-152, -121, -59, -28],
  // R 대비 비율
  rArc: 0.1864, rTickIn: 0.6171, rTickOut: 0.7640, rTick: 0.1320, rNeedle: 0.7053, rNeedleW: 0.1974, rPivot: 0.2204,
  inkPerR: 1.9522,
}
const PAGE = '<!doctype html><html><head><style>html,body{margin:0}</style></head><body><canvas id=c></canvas></body></html>'

const drawFn = (P) => {
  const S = P.S
  const c = document.getElementById('c'); c.width = S; c.height = S
  const x = c.getContext('2d')
  // ── 2패스 자동 정렬 ──
  // 1패스: 배경 없이 마크만 그려 알파로 bbox 와 무게중심을 실측.
  // 광학 중심 = (bbox 중심 + 무게중심)/2 — 축의 원반이 아래쪽에 무게를 싣는데 bbox 만으로는 못 잡는다.
  // 2패스: 그 광학 중심이 타일 중심(세로는 lift 만큼 위)에 오도록 평행이동해 다시 그린다.
  if (!P.__pass2) {
    draw(x, { ...P, __pass2: true, transparent: true, dx: 0, dy: 0 })
    const d = x.getImageData(0, 0, S, S).data
    let x0 = S, x1 = -1, y0 = S, y1 = -1, sw = 0, sx = 0, sy = 0
    for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
      const a = d[(yy * S + xx) * 4 + 3]; if (a < 24) continue
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy
      sw += a; sx += a * xx; sy += a * yy
    }
    const opx = ((x0 + x1) / 2 + sx / sw) / 2, opy = ((y0 + y1) / 2 + sy / sw) / 2
    P = { ...P, dx: S / 2 - opx, dy: S / 2 - P.lift * S - opy }
    x.clearRect(0, 0, S, S)
  }
  if (!P.transparent) {
    const g = x.createLinearGradient(0, 0, 0, S); g.addColorStop(0, P.bg0); g.addColorStop(1, P.bg1)
    x.fillStyle = g; x.fillRect(0, 0, S, S)
  }
  x.save(); x.translate(P.dx || 0, P.dy || 0)
  draw(x, P)
  x.restore()

  function draw(x, P) {
    const k = P.content / 0.72
    const R = (P.inkW * S * k) / P.inkPerR
    const cx = S / 2, cy = S / 2 + R * 0.24 // 축 기준값 — 최종 위치는 2패스가 잡는다
    const rad = (deg) => deg * Math.PI / 180
    x.strokeStyle = P.ink; x.fillStyle = P.ink; x.lineCap = 'round'
    x.lineWidth = R * P.rArc
    x.beginPath(); x.arc(cx, cy, R, rad(P.sweep[0]), rad(P.sweep[1])); x.stroke()
    x.lineWidth = R * P.rTick
    for (const deg of P.ticks) {
      const a = rad(deg), ca = Math.cos(a), sa = Math.sin(a)
      x.beginPath()
      x.moveTo(cx + ca * R * P.rTickIn, cy + sa * R * P.rTickIn)
      x.lineTo(cx + ca * R * P.rTickOut, cy + sa * R * P.rTickOut)
      x.stroke()
    }
    x.lineWidth = R * P.rNeedleW
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx, cy - R * P.rNeedle); x.stroke()
    x.beginPath(); x.arc(cx, cy, R * P.rPivot, 0, Math.PI * 2); x.fill()
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
async function render(size, content, opts = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(PAGE)
  await page.evaluate(drawFn, { ...SPEC, S: size, content, transparent: false, ...opts })
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
if (OUTDIR) { mkdirSync(OUTDIR, { recursive: true }); writeFileSync(join(OUTDIR, 'preview.png'), full); await browser.close(); console.log('preview written'); process.exit(0) }
writeFileSync(join(ROOT, 'resources/icon.png'), full)
writeFileSync(join(ROOT, 'www/public/icons/icon-512.png'), resize(full, 512))
writeFileSync(join(ROOT, 'www/public/icons/icon-192.png'), resize(full, 192))
// maskable: 원형 마스크에도 잘리지 않게 콘텐츠를 중앙 안전영역 안으로.
// 0.58 은 규격(중앙 지름 80 % 원)을 **겨우** 채워 여백이 0 이었다 — 실측 80.3 %, 0.3 %p 초과.
// 안드로이드 런처가 자기 마스크를 씌우면 다이얼 양끝이 경계에 닿아 "거의 끝에 붙는다" 로 보였다(K8).
// 0.52 로 낮춰 필요한 원을 ~72 % 로 만든다 — 8 %p 여유. cap-icons.test.mjs 가 이 여유를 지킨다.
writeFileSync(join(ROOT, 'www/public/icons/icon-maskable-512.png'), resize(await render(1024, 0.52), 512))
writeFileSync(join(ROOT, 'resources/icon-foreground.png'), await render(1024, 0.52, { transparent: true }))
// adaptive 전경 — 밀도별 정식 크기로 **직접** 렌더 (다운샘플이 아니라 그 크기로 그려야 획 굵기가 그 해상도에 맞는다)
mkdirSync(join(ROOT, 'resources/android'), { recursive: true })
export const ADAPTIVE_PX = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }
for (const [density, px] of Object.entries(ADAPTIVE_PX)) {
  writeFileSync(join(ROOT, `resources/android/ic_launcher_foreground-${density}.png`), await render(px, 0.48, { transparent: true }))
}
writeFileSync(join(ROOT, 'resources/icon-monochrome.png'), await render(1024, 0.52, { transparent: true }))
// adaptive 배경 — 전면 아이콘과 같은 그라디언트
const bgBuf = await render(1024, 0.72, { inkW: 0 })
writeFileSync(join(ROOT, 'resources/icon-background.png'), bgBuf)
await browser.close()
console.log('icons written — resources/icon*.png, resources/android/*, www/public/icons/*.png')
