#!/usr/bin/env node
// 모듈 경계 검사. 의존성 없이 import 문을 정규식으로 본다.
// 규칙: core → (core만) / state → (state,core) / persist → (state,core) / platform → (core — 화면 문구 core/i18n 만)
//       audio → (core,state,persist,platform,audio) / ui → (core,state,audio,platform,ui)  ui 는 audio 의 "명령"만 — 상태는 store 로
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'www', 'src')
const ALLOW = { core: ['core'], state: ['state', 'core'], persist: ['persist', 'state', 'core'], platform: ['platform', 'core'], audio: ['audio', 'core', 'state', 'persist', 'platform'], ui: ['ui', 'core', 'state', 'audio', 'platform'] }
const BROWSER_API = /\b(document|window|navigator|AudioContext|localStorage|indexedDB|requestAnimationFrame)\b/
const posix = p => p.split(sep).join('/') // Windows 는 역슬래시로 돌려준다 — 없으면 모든 파일을 건너뛰고 'ok' 가 된다
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [] })
let bad = 0
for (const f of walk(SRC)) {
  const rel = posix(relative(SRC, f)), layer = rel.split('/')[0]
  const src = readFileSync(f, 'utf8')
  if (!(layer in ALLOW)) continue
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = posix(relative(SRC, join(dirname(f), m[1]))).split('/')[0]
    if (!ALLOW[layer].includes(target)) { console.log(`✗ ${rel} → ${m[1]} (${layer} may not import ${target})`); bad++ }
  }
  if (layer === 'core' && BROWSER_API.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) { console.log(`✗ ${rel}: core must not touch browser APIs`); bad++ }
}
console.log(bad ? `${bad} boundary violation(s)` : 'module boundaries ok'); process.exit(bad ? 1 : 0)
