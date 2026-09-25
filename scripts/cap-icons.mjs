#!/usr/bin/env node
// Android adaptive 아이콘 보정 — `capacitor-assets generate` 결과를 고친다: 전경 PNG 를 정식 크기(108dp×배율) 렌더로 덮고(생성기는 192 px 로 내보낸다),
// ic_launcher.xml 의 inset 래퍼를 벗긴다(gen-icons.mjs 가 이미 안전영역을 고려해 그린다). Android 13 테마 아이콘용 단색 PNG 를 넣고
// XML 에 <monochrome> 이 없으면 더한다. 웹/PWA 아이콘은 건드리지 않는다. android/ 없으면 조용히 끝낸다
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 밀도별 adaptive 전경 정식 크기(px) — 108dp 를 각 배율로 */
export const ADAPTIVE_PX = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }

/** adaptive-icon XML 의 <foreground>·<monochrome> 안 <inset .../> 래퍼를 벗겨 android:drawable 속성으로 바꾼다. 멱등 */
export function stripInset(xml) {
  return xml.replace(
    /<(foreground|monochrome)>\s*<inset\s+([^>]*?)\/>\s*<\/\1>/g,
    (_m, tag, attrs) => {
      const drawable = /android:drawable="([^"]+)"/.exec(attrs)?.[1]
      return drawable ? `<${tag} android:drawable="${drawable}"/>` : _m
    },
  )
}

/** <monochrome> 이 없는 adaptive-icon 에 단색 레이어를 더한다(없으면 테마 아이콘에서 런처가 전경을 뭉개 칠한다). 멱등 */
export function ensureMonochrome(xml) {
  if (/<monochrome[\s>]/.test(xml) || !xml.includes('</adaptive-icon>')) return xml
  return xml.replace('</adaptive-icon>', '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>')
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res')
const SRC = join(ROOT, 'resources', 'android')

export function applyIcons(res = RES, src = SRC, log = console.log) {
  if (!existsSync(res)) { log('android/ 없음 — `npx cap add android` 후 다시 실행'); return { copied: 0, mono: 0, xml: 0, skipped: true } }
  let copied = 0, mono = 0, xml = 0
  for (const density of Object.keys(ADAPTIVE_PX)) {
    for (const layer of ['foreground', 'monochrome']) {
      const from = join(src, `ic_launcher_${layer}-${density}.png`)
      const to = join(res, `mipmap-${density}`, `ic_launcher_${layer}.png`)
      if (!existsSync(from)) { log(`없음(건너뜀): ${from} — \`npm run icons\` 먼저`); continue }
      if (!existsSync(dirname(to))) { log(`없음(건너뜀): mipmap-${density}`); continue }
      copyFileSync(from, to); if (layer === 'foreground') copied++; else mono++
    }
  }
  const anydpi = join(res, 'mipmap-anydpi-v26')
  if (existsSync(anydpi)) {
    for (const f of readdirSync(anydpi).filter(f => f.endsWith('.xml'))) {
      const p = join(anydpi, f), before = readFileSync(p, 'utf8'), after = ensureMonochrome(stripInset(before))
      if (after !== before) { writeFileSync(p, after); xml++ }
    }
  }
  log(`아이콘 보정: 전경 ${copied}개·단색 ${mono}개 교체, XML ${xml}개 수정(inset 제거·단색 추가)`)
  return { copied, mono, xml, skipped: false }
}

// 직접 실행일 때만. pathToFileURL: Windows 는 argv[1] 이 `C:\...` 라 `file://` 접두만으로는 같지 않다
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) applyIcons()
