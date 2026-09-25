import { describe, test, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'
import { stripInset, applyIcons, ADAPTIVE_PX } from './cap-icons.mjs'

// @capacitor/assets 3.0.5 가 실제로 내보내는 형태
const GENERATED = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%"/>
    </foreground>
    <monochrome>
        <inset android:drawable="@mipmap/ic_launcher_monochrome" android:inset="16.7%"/>
    </monochrome>
</adaptive-icon>`

describe('stripInset — removes the inset wrapper that shrank the icon twice', () => {
  test('strips the inset from foreground and monochrome and uses the drawable directly', () => {
    const out = stripInset(GENERATED)
    expect(out).not.toMatch(/inset/)
    expect(out).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground"/>')
    expect(out).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>')
    expect(out).toContain('<background android:drawable="@color/ic_launcher_background"/>') // 배경은 손대지 않는다
  })
  test('idempotent — already stripped XML stays the same', () => {
    const once = stripInset(GENERATED)
    expect(stripInset(once)).toBe(once)
  })
  test('leaves XML without an inset (made by other tools) alone', () => {
    const plain = '<adaptive-icon><foreground android:drawable="@mipmap/x"/></adaptive-icon>'
    expect(stripInset(plain)).toBe(plain)
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
    }
    mkdirSync(join(res, 'mipmap-anydpi-v26'), { recursive: true })
    writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), GENERATED)
    writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), GENERATED)
    return { res, src }
  }
  test('writes a full-size foreground per density and fixes both XML files', () => {
    const { res, src } = fixture()
    const r = applyIcons(res, src, () => {})
    expect(r).toEqual({ copied: 5, xml: 2, skipped: false })
    for (const [d, px] of Object.entries(ADAPTIVE_PX)) {
      const p = PNG.sync.read(readFileSync(join(res, `mipmap-${d}`, 'ic_launcher_foreground.png')))
      expect(p.width).toBe(px)
    }
    expect(readFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'utf8')).not.toMatch(/inset/)
  })
  test('quietly does nothing without android/ (generated, not in the repo)', () => {
    expect(applyIcons('/nonexistent-res', '/nonexistent-src', () => {}).skipped).toBe(true)
  })
  test('same result when run twice (cap:assets runs every time)', () => {
    const { res, src } = fixture()
    applyIcons(res, src, () => {})
    const r2 = applyIcons(res, src, () => {})
    expect(r2.copied).toBe(5); expect(r2.xml).toBe(0) // XML 은 이미 벗겨져 변경 없음
  })
})

describe('generated foreground — full size and visible mark width', () => {
  const dir = join(import.meta.dirname, '..', 'resources', 'android')
  const files = Object.entries(ADAPTIVE_PX)
  test.skipIf(!existsSync(dir))('밀도별 크기가 108dp 정식값이다', () => {
    for (const [d, px] of files) {
      const p = PNG.sync.read(readFileSync(join(dir, `ic_launcher_foreground-${d}.png`)))
      expect([p.width, p.height]).toEqual([px, px])
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
  test.skipIf(!existsSync(dir))('원형 안전영역(중앙 72dp) 밖으로 잉크가 나가지 않는다', () => {
    for (const [d, px] of files) {
      const p = PNG.sync.read(readFileSync(join(dir, `ic_launcher_foreground-${d}.png`)))
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
    for (const d of [0, m]) pts.push([d, d], [W - 1 - d, d], [d, H - 1 - d], [W - 1 - d, H - 1 - d], [W >> 1, d], [W >> 1, H - 1 - d], [d, H >> 1], [W - 1 - d, H >> 1])
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
    const bg = [p.data[0], p.data[1], p.data[2]]
    let x0 = p.width, x1 = -1, y0 = p.height, y1 = -1
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4
      if (Math.abs(p.data[i] - bg[0]) + Math.abs(p.data[i + 1] - bg[1]) + Math.abs(p.data[i + 2] - bg[2]) <= 60) continue
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    }
    const c = p.width / 2
    const r = Math.max(...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => Math.hypot(x - c, y - c)))
    const pct = r * 2 / p.width * 100
    expect(pct, `잉크가 중앙 ${pct.toFixed(1)} % 원을 차지한다 — 런처 마스크에 양끝이 닿는다`).toBeLessThan(76)
  })
})
