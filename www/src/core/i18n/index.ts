/** 화면 언어. 기본은 한국어. 문구는 ko.ts(원본)·en.ts, 고르는 건 설정 lang */
import { KO, type TKey } from './ko.ts'
import { EN } from './en.ts'

export type Lang = 'ko' | 'en'
export type { TKey }

const DICT: Record<Lang, Record<TKey, string>> = { ko: KO, en: EN }
let cur: Lang = 'ko'

export function setLang(l: Lang): void { cur = l }
export function getLang(): Lang { return cur }

/** 키 → 지금 언어의 문구. {name} 은 p 로 채우고, {n|하나|여럿} 은 n 이 1 인지로 고른다 */
export function t(key: TKey, p?: Record<string, string | number>): string {
  let s: string = DICT[cur][key]
  if (!p) return s
  s = s.replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_, k: string, one: string, other: string) => (Number(p[k]) === 1 ? one : other))
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m))
}
