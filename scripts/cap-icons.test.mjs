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

describe('stripInset — 두 번 축소되던 inset 래퍼 제거 (C2 원인 ②)', () => {
  test('foreground·monochrome 의 inset 을 벗기고 드로어블을 그대로 쓴다', () => {
    const out = stripInset(GENERATED)
    expect(out).not.toMatch(/inset/)
    expect(out).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground"/>')
    expect(out).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>')
    expect(out).toContain('<background android:drawable="@color/ic_launcher_background"/>') // 배경은 손대지 않는다
  })
  test('멱등 — 이미 벗겨진 XML 은 그대로', () => {
    const once = stripInset(GENERATED)
    expect(stripInset(once)).toBe(once)
  })
  test('inset 이 없던 XML(다른 도구가 만든 것)도 그대로 둔다', () => {
    const plain = '<adaptive-icon><foreground android:drawable="@mipmap/x"/></adaptive-icon>'
    expect(stripInset(plain)).toBe(plain)
  })
})

describe('applyIcons — mipmap 교체 (C2 원인 ①)', () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'gp-icons-'))
    const res = join(root, 'res'), src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (const [d, px] of Object.entries(ADAPTIVE_PX)) {
      mkdirSync(join(res, `mipmap-${d}`), { recursive: true })
      // 생성기가 내놓던 작은 전경 (xxxhdpi 192 px 고정) 을 흉내
      writeFileSync(join(res, `mipmap-${d}`, 'ic_launcher_foreground.png'), PNG.sync.write(new PNG({ width: 192, height: 192 })))
      writeFileSync(join(src, `ic_launcher_foreground-${d}.png`), PNG.sync.write(new PNG({ width: px, height: px })))
    }
    mkdirSync(join(res, 'mipmap-anydpi-v26'), { recursive: true })
    writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), GENERATED)
    writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), GENERATED)
    return { res, src }
  }
  test('밀도마다 정식 크기 전경으로 덮고 XML 2개를 고친다', () => {
    const { res, src } = fixture()
    const r = applyIcons(res, src, () => {})
    expect(r).toEqual({ copied: 5, xml: 2, skipped: false })
    for (const [d, px] of Object.entries(ADAPTIVE_PX)) {
      const p = PNG.sync.read(readFileSync(join(res, `mipmap-${d}`, 'ic_launcher_foreground.png')))
      expect(p.width).toBe(px) // 192 고정이었던 것이 108/162/216/324/432 로
    }
    expect(readFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'utf8')).not.toMatch(/inset/)
  })
  test('android/ 가 없으면 조용히 끝낸다 (생성물이라 리포에 없다)', () => {
    expect(applyIcons('/nonexistent-res', '/nonexistent-src', () => {}).skipped).toBe(true)
  })
  test('두 번 돌려도 같은 결과 (cap:assets 는 매번 실행된다)', () => {
    const { res, src } = fixture()
    applyIcons(res, src, () => {})
    const r2 = applyIcons(res, src, () => {})
    expect(r2.copied).toBe(5); expect(r2.xml).toBe(0) // XML 은 이미 벗겨져 변경 없음
  })
})

describe('생성된 전경 실측 — 정식 크기 + 보이는 글자 폭 (C2 목표)', () => {
  const dir = join(import.meta.dirname, '..', 'resources', 'android')
  const files = Object.entries(ADAPTIVE_PX)
  test.skipIf(!existsSync(dir))('밀도별 크기가 108dp 정식값이다', () => {
    for (const [d, px] of files) {
      const p = PNG.sync.read(readFileSync(join(dir, `ic_launcher_foreground-${d}.png`)))
      expect([p.width, p.height]).toEqual([px, px])
    }
  })
  test.skipIf(!existsSync(dir))('잉크 폭 34.7 ± 1 % → 마스크 안에서 52 ± 2 %', () => {
    for (const [d] of files) {
      const p = PNG.sync.read(readFileSync(join(dir, `ic_launcher_foreground-${d}.png`)))
      let x0 = p.width, x1 = -1
      for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) { if (p.data[(y * p.width + x) * 4 + 3] < 24) continue; if (x < x0) x0 = x; if (x > x1) x1 = x }
      const ink = (x1 - x0 + 1) / p.width * 100
      expect(ink).toBeGreaterThan(33.7); expect(ink).toBeLessThan(35.7)
      const visible = ink / (72 / 108) // adaptive 108dp 중 보이는 것은 중앙 72dp
      expect(Math.abs(visible - 52)).toBeLessThan(2)
    }
  })
  test.skipIf(!existsSync(dir))('투명 배경이다 (adaptive 전경은 배경 레이어와 합성된다)', () => {
    const p = PNG.sync.read(readFileSync(join(dir, 'ic_launcher_foreground-xxxhdpi.png')))
    expect(p.data[3]).toBe(0) // 좌상단 모서리
  })
})
