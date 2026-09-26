import { describe, test, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'
import { stripInset, ensureMonochrome, applyIcons, ADAPTIVE_PX } from './cap-icons.mjs'

// @capacitor/assets 3.0.5 가 실제로 내보내는 형태 — <monochrome> 이 없다(테마 아이콘이 빠진다)
const GENERATED = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background>
        <inset android:drawable="@mipmap/ic_launcher_background" android:inset="16.7%" />
    </background>
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%" />
    </foreground>
</adaptive-icon>`
// 단색까지 inset 으로 감싼 형태(다른 생성기)
const WITH_MONO = GENERATED.replace('</adaptive-icon>', `    <monochrome>
        <inset android:drawable="@mipmap/ic_launcher_monochrome" android:inset="16.7%"/>
    </monochrome>
</adaptive-icon>`)

describe('stripInset — removes the inset wrapper that shrank the icon twice', () => {
  test('strips the inset from foreground and monochrome and uses the drawable directly', () => {
    const out = stripInset(WITH_MONO)
    expect(out).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground"/>')
    expect(out).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>')
    expect(out).toContain('<inset android:drawable="@mipmap/ic_launcher_background"') // 배경은 손대지 않는다
  })
  test('idempotent — already stripped XML stays the same', () => {
    const once = stripInset(WITH_MONO)
    expect(stripInset(once)).toBe(once)
  })
  test('leaves XML without an inset (made by other tools) alone', () => {
    const plain = '<adaptive-icon><foreground android:drawable="@mipmap/x"/></adaptive-icon>'
    expect(stripInset(plain)).toBe(plain)
  })
})

describe('ensureMonochrome — Android 13 themed icon layer', () => {
  test('adds a monochrome layer the generator leaves out', () => {
    const out = ensureMonochrome(stripInset(GENERATED))
    expect(out).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>')
    expect(out.trimEnd().endsWith('</adaptive-icon>')).toBe(true)
  })
  test('idempotent and keeps an existing monochrome layer', () => {
    const once = ensureMonochrome(GENERATED)
    expect(ensureMonochrome(once)).toBe(once)
    expect(ensureMonochrome(WITH_MONO)).toBe(WITH_MONO)
    expect(ensureMonochrome('<vector/>')).toBe('<vector/>')
  })
})

describe('applyIcons — replaces mipmaps', () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'gp-icons-'))
    const res = join(root, 'res'), src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (const [d, px] of Object.entries(ADAPTIVE_PX)) {
      mkdirSync(join(res, `mipmap-${d}`), { recursive: true })
      // 생성기가 내놓는 작은 전경 (192 px 고정) 을 흉내
      writeFileSync(join(res, `mipmap-${d}`, 'ic_launcher_foreground.png'), PNG.sync.write(new PNG({ width: 192, height: 192 })))
      writeFileSync(join(src, `ic_launcher_foreground-${d}.png`), PNG.sync.write(new PNG({ width: px, height: px })))
      writeFileSync(join(src, `ic_launcher_monochrome-${d}.png`), PNG.sync.write(new PNG({ width: px, height: px })))
    }
    mkdirSync(join(res, 'mipmap-anydpi-v26'), { recursive: true })
    writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), GENERATED)
    writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), GENERATED)
    return { res, src }
  }
  test('writes a full-size foreground and monochrome per density and fixes both XML files', () => {
    const { res, src } = fixture()
    const r = applyIcons(res, src, () => {})
    expect(r).toEqual({ copied: 5, mono: 5, xml: 2, skipped: false })
    for (const [d, px] of Object.entries(ADAPTIVE_PX)) for (const layer of ['foreground', 'monochrome']) {
      const p = PNG.sync.read(readFileSync(join(res, `mipmap-${d}`, `ic_launcher_${layer}.png`)))
      expect(p.width).toBe(px)
    }
    for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const xml = readFileSync(join(res, 'mipmap-anydpi-v26', f), 'utf8')
      expect(xml).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground"/>')
      expect(xml).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>')
    }
  })
  test('quietly does nothing without android/ (generated, not in the repo)', () => {
    expect(applyIcons('/nonexistent-res', '/nonexistent-src', () => {}).skipped).toBe(true)
  })
  test('same result when run twice (cap:assets runs every time)', () => {
    const { res, src } = fixture()
    applyIcons(res, src, () => {})
    const r2 = applyIcons(res, src, () => {})
    expect(r2.copied).toBe(5); expect(r2.mono).toBe(5); expect(r2.xml).toBe(0) // XML 은 이미 고쳐져 변경 없음
  })
})

describe('generated foreground — full size and visible mark width', () => {
  const dir = join(import.meta.dirname, '..', 'resources', 'android')
  const files = Object.entries(ADAPTIVE_PX)
  test.skipIf(!existsSync(dir))('밀도별 크기가 108dp 정식값이다 (전경·단색)', () => {
    for (const [d, px] of files) for (const layer of ['foreground', 'monochrome']) {
      const p = PNG.sync.read(readFileSync(join(dir, `ic_launcher_${layer}-${d}.png`)))
      expect([p.width, p.height], `${layer}-${d}`).toEqual([px, px])
    }
  })
  // 눈에 띄려면 보이는 72dp 의 절반 이상은 차야 한다
  test.skipIf(!existsSync(dir))('보이는 72dp 기준 그림 폭 ≥ 55 %', () => {
    for (const [d] of files) {
      const p = PNG.sync.read(readFileSync(join(dir, `ic_launcher_foreground-${d}.png`)))
      let x0 = p.width, x1 = -1
      for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) { if (p.data[(y * p.width + x) * 4 + 3] < 24) continue; if (x < x0) x0 = x; if (x > x1) x1 = x }
      const visible = (x1 - x0 + 1) / p.width / (72 / 108) * 100
      expect(visible, `${d}: 보이는 폭 ${visible.toFixed(1)} %`).toBeGreaterThan(55)
    }
  })
  // 원형 마스크(적응형은 원으로 잘린다)에서 마크가 잘리지 않는다: 보이는 72dp 원 안에 들어와야 한다
  test.skipIf(!existsSync(dir))('원형 안전영역(중앙 72dp) 밖으로 잉크가 나가지 않는다 (전경·단색)', () => {
    for (const [d, px] of files) for (const layer of ['foreground', 'monochrome']) {
      const p = PNG.sync.read(readFileSync(join(dir, `ic_launcher_${layer}-${d}.png`)))
      const c = px / 2, r = px * (72 / 108) / 2
      let out = 0
      for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
        if (p.data[(y * p.width + x) * 4 + 3] < 24) continue
        if (Math.hypot(x + 0.5 - c, y + 0.5 - c) > r) out++
      }
      expect(out).toBe(0)
    }
  })
  test.skipIf(!existsSync(dir))('투명 배경이다 (adaptive 전경은 배경 레이어와 합성된다)', () => {
    const p = PNG.sync.read(readFileSync(join(dir, 'ic_launcher_foreground-xxxhdpi.png')))
    expect(p.data[3]).toBe(0) // 좌상단 모서리
  })
})

// 웹앱 아이콘: 매니페스트·apple-touch-icon 이 가리키는 파일이 적힌 크기 그대로 있어야 한다 — 다른 크기를 받으면 홈 화면이 다시 줄여 흐려진다
describe('web app icons are drawn at the size they declare', () => {
  const pub = new URL('../www/public/', import.meta.url)
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8')
  const declared = [...vite.matchAll(/src: '(icons\/[^']+\.png)', sizes: '(\d+)x(\d+)'/g)].map(m => [m[1], +m[2]])
  const apple = /rel="apple-touch-icon" sizes="(\d+)x\d+" href="([^"]+)"/.exec(html)
  test('the manifest lists each size once, for both purposes', () => {
    expect(declared.length).toBeGreaterThanOrEqual(6)
    expect(apple, 'apple-touch-icon 에 sizes 가 있다').not.toBeNull()
  })
  test.skipIf(!existsSync(new URL('icons/icon-192.png', pub)))('each file exists at its declared size', () => {
    for (const [src, n] of [...declared, [apple[2], +apple[1]]]) {
      const p = PNG.sync.read(readFileSync(new URL(src, pub)))
      expect([p.width, p.height], src).toEqual([n, n])
    }
  })
})

// 브라우저 탭 아이콘: 글자가 안 읽히는 크기라 따로 그린 32 px — 모서리는 투명(둥근 타일), 가운데는 채워져 있다
describe('favicon', () => {
  const fav = new URL('../www/public/icons/favicon-32.png', import.meta.url)
  test.skipIf(!existsSync(fav))('32 px, rounded tile with a transparent corner', () => {
    const p = PNG.sync.read(readFileSync(fav))
    expect([p.width, p.height]).toEqual([32, 32])
    expect(p.data[3]).toBe(0)
    expect(p.data[(16 * 32 + 16) * 4 + 3]).toBe(255)
  })
})

// 타일색의 원천은 resources/icon-background.svg(→ .png). package.json 의 cap:assets 색은 손으로 맞추는 값
describe('the icon background color is defined in one place', () => {
  const bgPng = new URL('../resources/icon-background.png', import.meta.url)
  test.skipIf(!existsSync(bgPng))('icon background matches the adaptive background color in package.json', () => {
    const p = PNG.sync.read(readFileSync(bgPng)); const i = (3 * p.width + 3) * 4
    const tile = '#' + [p.data[i], p.data[i + 1], p.data[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('')
    const pkg = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    const bg = /--iconBackgroundColor\s+(#[0-9a-fA-F]{6})/.exec(pkg)?.[1]
    const bgDark = /--iconBackgroundColorDark\s+(#[0-9a-fA-F]{6})/.exec(pkg)?.[1]
    expect(bg?.toLowerCase()).toBe(tile.toLowerCase())
    expect(bgDark?.toLowerCase()).toBe(tile.toLowerCase())
  })
})

// iOS 는 정사각 원본을 스스로 깎는다. 원본에 둥근 타일·그림자를 그려 넣으면 테두리가 두 겹이 된다
describe('the iOS / PWA icon is full-bleed', () => {
  const full = new URL('../resources/icon.png', import.meta.url)
  test.skipIf(!existsSync(full))('edges match the background layer — no baked rounded frame', () => {
    const p = PNG.sync.read(readFileSync(full)), bg = PNG.sync.read(readFileSync(new URL('../resources/icon-background.png', import.meta.url)))
    const W = p.width, H = p.height, m = Math.round(W * 0.04)
    const pts = []
    // 위·아래 가장자리는 ¼·¾ 지점을 본다 — 가운데엔 현이 가장자리까지 이어진다(그림의 일부지 테두리가 아니다)
    for (const d of [0, m]) pts.push([d, d], [W - 1 - d, d], [d, H - 1 - d], [W - 1 - d, H - 1 - d], [W >> 2, d], [(3 * W) >> 2, d], [W >> 2, H - 1 - d], [(3 * W) >> 2, H - 1 - d], [d, H >> 1], [W - 1 - d, H >> 1])
    for (const [x, y] of pts) {
      const i = (y * W + x) * 4
      expect(p.data[i + 3]).toBe(255)
      const diff = Math.abs(p.data[i] - bg.data[i]) + Math.abs(p.data[i + 1] - bg.data[i + 1]) + Math.abs(p.data[i + 2] - bg.data[i + 2])
      expect(diff, `pixel ${x},${y}`).toBeLessThan(12)
    }
  })
})

// maskable 규격: 중앙 지름 80 % 원 안에 내용이 있어야 한다. 잉크가 가로로 넓어 폭이 아니라 대각선(= 필요한 원 지름)이 걸리는 값
describe('maskable icons keep a margin inside the safe zone', () => {
  const file = new URL('../www/public/icons/icon-maskable-512.png', import.meta.url)
  test.skipIf(!existsSync(file))('필요한 원 지름 ≤ 76 % (규격 80 % 에 최소 4 %p 여유)', () => {
    const p = PNG.sync.read(readFileSync(file))
    // 바탕이 나무결·그라디언트라 한 색이 아니다 — 바탕 층(1024)의 같은 자리와 비교해 다른 곳만 잉크로 본다
    const bgL = PNG.sync.read(readFileSync(new URL('../resources/icon-background.png', import.meta.url))), sc = bgL.width / p.width
    let x0 = p.width, x1 = -1, y0 = p.height, y1 = -1
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4, j = (Math.floor(y * sc) * bgL.width + Math.floor(x * sc)) * 4
      if (Math.abs(p.data[i] - bgL.data[j]) + Math.abs(p.data[i + 1] - bgL.data[j + 1]) + Math.abs(p.data[i + 2] - bgL.data[j + 2]) <= 60) continue
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    }
    const c = p.width / 2
    const r = Math.max(...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => Math.hypot(x - c, y - c)))
    const pct = r * 2 / p.width * 100
    expect(pct, `잉크가 중앙 ${pct.toFixed(1)} % 원을 차지한다 — 런처 마스크에 양끝이 닿는다`).toBeLessThan(76)
  })
})
