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

describe('생성된 전경 실측 — 정식 크기 + 보이는 마크 폭 (C2 목표)', () => {
  const dir = join(import.meta.dirname, '..', 'resources', 'android')
  const files = Object.entries(ADAPTIVE_PX)
  test.skipIf(!existsSync(dir))('밀도별 크기가 108dp 정식값이다', () => {
    for (const [d, px] of files) {
      const p = PNG.sync.read(readFileSync(join(dir, `ic_launcher_foreground-${d}.png`)))
      expect([p.width, p.height]).toEqual([px, px])
    }
  })
  // v2.1.0: 워드마크(보이는 폭 52 %)를 다이얼로 교체하면서 목표가 82 % 로 올라갔다 —
  // 이전 아이콘이 홈 화면에서 "있는 줄도 몰랐다" 는 지적을 받았기 때문이다(베타 피드백 #1).
  // gen-icons 의 inkW 0.82 × (content 0.48 / 0.72) = 캔버스의 54.7 % → 보이는 타일 기준 82 %.
  test.skipIf(!existsSync(dir))('잉크 폭 54.7 ± 1.5 % → 마스크 안에서 82 ± 2.5 %', () => {
    for (const [d] of files) {
      const p = PNG.sync.read(readFileSync(join(dir, `ic_launcher_foreground-${d}.png`)))
      let x0 = p.width, x1 = -1
      for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) { if (p.data[(y * p.width + x) * 4 + 3] < 24) continue; if (x < x0) x0 = x; if (x > x1) x1 = x }
      const ink = (x1 - x0 + 1) / p.width * 100
      expect(ink).toBeGreaterThan(53.2); expect(ink).toBeLessThan(56.2)
      const visible = ink / (72 / 108) // adaptive 108dp 중 보이는 것은 중앙 72dp
      expect(Math.abs(visible - 82)).toBeLessThan(2.5)
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

// 실제로 어긋난 적이 있다: 타일색을 #2ecc66 그라디언트 → #189E46 단색으로 바꿨는데
// package.json 의 cap:assets 에는 옛 #22b355 가 남아 있었다. 그러면 런처의 adaptive 배경만
// 다른 초록이 되어, PWA 아이콘과 앱 아이콘의 색이 갈린다. 두 곳은 손으로 맞추는 값이라 테스트로 묶는다.
describe('아이콘 배경색은 한 곳에서만 정해진다', () => {
  test('gen-icons 의 타일색 = package.json 의 adaptive 배경색', () => {
    const spec = readFileSync(new URL('./gen-icons.mjs', import.meta.url), 'utf8')
    const tile = /bg0:\s*'(#[0-9a-fA-F]{6})'/.exec(spec)?.[1]
    const pkg = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    const bg = /--iconBackgroundColor\s+(#[0-9a-fA-F]{6})/.exec(pkg)?.[1]
    const bgDark = /--iconBackgroundColorDark\s+(#[0-9a-fA-F]{6})/.exec(pkg)?.[1]
    expect(tile).toBeTruthy()
    expect(bg?.toLowerCase()).toBe(tile?.toLowerCase())
    expect(bgDark?.toLowerCase()).toBe(tile?.toLowerCase())
  })
})