#!/usr/bin/env node
// Android adaptive 아이콘 보정 (C2) — `capacitor-assets generate` 가 만든 결과를 두 군데 고친다.
// 왜: 실기기에서 앱 아이콘이 **흐릿하고 여백이 과했다**. `@capacitor/assets` 3.0.5 를 직접 돌려 원인 두 개를 확인했다.
//   ① 해상도 0.44배 — 전경을 xxxhdpi 에 192 px 로 내보낸다. 108dp adaptive 전경의 정식 크기는 432 px 라
//      안드로이드가 2.25배로 확대해 그린다. (`generateAdaptiveIconForeground()` 가 `kind === 'icon'`(레거시 36~192)으로
//      필터하는데, 우리가 `resources/icon-foreground.png` 를 제공해서 그 경로를 탄다)
//   ② 축소가 두 번 — 생성된 `ic_launcher.xml` 이 `<inset android:inset="16.7%">` 를 덧씌우는데,
//      `gen-icons.mjs` 는 이미 안전영역을 고려해 그려 둔다. 보이는 글자 폭이 38 %(PWA 는 52 %)로 쪼그라든다.
// 고치는 법: ① mipmap-*/ic_launcher_foreground.png 를 `resources/android/` 의 **정식 크기 렌더**로 덮는다
//            ② XML 의 inset 래퍼를 벗겨 드로어블을 그대로 쓰게 한다.
// 웹/PWA 아이콘은 건드리지 않는다. android/ 가 없으면 조용히 끝낸다 (생성물이라 리포에 없다).
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 밀도별 adaptive 전경 정식 크기(px) — 108dp 를 각 배율로 */
export const ADAPTIVE_PX = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }

/**
 * adaptive-icon XML 에서 inset 래퍼를 벗긴다. `<foreground>`·`<monochrome>` 안의
 * `<inset android:drawable="@mipmap/X" android:inset="16.7%"/>` → `<foreground android:drawable="@mipmap/X"/>`
 * 이미 속성 형태면 그대로 둔다(멱등).
 */
export function stripInset(xml) {
  return xml.replace(
    /<(foreground|monochrome)>\s*<inset\s+([^>]*?)\/>\s*<\/\1>/g,
    (_m, tag, attrs) => {
      const drawable = /android:drawable="([^"]+)"/.exec(attrs)?.[1]
      return drawable ? `<${tag} android:drawable="${drawable}"/>` : _m
    },
  )
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res')
const SRC = join(ROOT, 'resources', 'android')

export function applyIcons(res = RES, src = SRC, log = console.log) {
  if (!existsSync(res)) { log('android/ 없음 — `npx cap add android` 후 다시 실행'); return { copied: 0, xml: 0, skipped: true } }
  let copied = 0, xml = 0
  for (const density of Object.keys(ADAPTIVE_PX)) {
    const from = join(src, `ic_launcher_foreground-${density}.png`)
    const to = join(res, `mipmap-${density}`, 'ic_launcher_foreground.png')
    if (!existsSync(from)) { log(`없음(건너뜀): ${from} — \`npm run icons\` 먼저`); continue }
    if (!existsSync(dirname(to))) { log(`없음(건너뜀): mipmap-${density}`); continue }
    copyFileSync(from, to); copied++
  }
  const anydpi = join(res, 'mipmap-anydpi-v26')
  if (existsSync(anydpi)) {
    for (const f of readdirSync(anydpi).filter(f => f.endsWith('.xml'))) {
      const p = join(anydpi, f), before = readFileSync(p, 'utf8'), after = stripInset(before)
      if (after !== before) { writeFileSync(p, after); xml++ }
    }
  }
  log(`아이콘 보정: 전경 ${copied}개 교체, XML ${xml}개에서 inset 제거`)
  return { copied, xml, skipped: false }
}

// 직접 실행일 때만. pathToFileURL: Windows 는 argv[1] 이 `C:\...` 라 `file://` 접두만으로는 절대 같지 않다 (정적 리뷰에서 발견)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) applyIcons()
