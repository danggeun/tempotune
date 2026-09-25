import { describe, test, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringLiterals } from './lib/strings.mjs'
import { KO } from '../www/src/core/i18n/ko.ts'
import { EN } from '../www/src/core/i18n/en.ts'
import { t, setLang } from '../www/src/core/i18n/index.ts'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'www', 'src')
const HANGUL = /[가-힣]/
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(p) && !/\.test\.ts$/.test(p) ? [p] : [] })
// 한국어가 코드에 있어도 되는 곳: 문구 원본, 음이름 데이터, 기준음 버튼의 내부 키('도2')와 한국어 표기
const ALLOWED_FILES = ['core/i18n/ko.ts', 'core/note.ts']
const ALLOWED_TEXT = new Set(['도2', '도↑'])

describe('i18n dictionaries', () => {
  test('English has every key and nothing else', () => expect(Object.keys(EN).sort()).toEqual(Object.keys(KO).sort()))
  test('no Korean left in English strings', () => {
    const bad = Object.entries(EN).filter(([, v]) => HANGUL.test(v)).map(([k]) => k)
    expect(bad).toEqual([])
  })
  test('placeholders match between languages', () => {
    const names = s => [...s.matchAll(/\{(\w+)(?:\|[^}]*)?\}/g)].map(m => m[1]).sort().filter((v, i, a) => a.indexOf(v) === i)
    const bad = Object.keys(KO).filter(k => names(KO[k]).join() !== names(EN[k]).join())
    expect(bad).toEqual([])
  })
  test('<br> only where the other language has it too', () => {
    const bad = Object.keys(KO).filter(k => KO[k].includes('<br>') !== EN[k].includes('<br>'))
    expect(bad).toEqual([])
  })
  test('t() fills values and picks singular/plural', () => {
    setLang('en')
    expect(t('rec.deletesIn', { n: 1 })).toBe('Deletes in 1 day')
    expect(t('rec.deletesIn', { n: 3 })).toBe('Deletes in 3 days')
    expect(t('common.saveFailed', { e: 'x' })).toBe('Couldn’t save: x')
    setLang('ko')
    expect(t('rec.deletesIn', { n: 3 })).toBe('3일 후 삭제')
  })
})

describe('no hard-coded Korean on screen', () => {
  test('every Korean string in code goes through the dictionary', () => {
    const bad = []
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f)
      if (ALLOWED_FILES.includes(rel)) continue
      for (const s of stringLiterals(readFileSync(f, 'utf8'))) if (HANGUL.test(s.text) && !ALLOWED_TEXT.has(s.text)) bad.push(`${rel}:${s.line} ${s.text.slice(0, 40)}`)
    }
    expect(bad).toEqual([])
  })
  test('the tokenizer sees strings but not comments or regexes', () => {
    const src = "// 주석 '가'\nconst a = '나' /* '다' */; const r = /['\"]/g; const b = `라${x}마`"
    expect(stringLiterals(src).map(s => s.text)).toEqual(['나', '라', '마'])
  })
})
