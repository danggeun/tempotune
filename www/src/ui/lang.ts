/** 화면 언어 적용: 설정 lang → core/i18n, <html lang>, 정적 문구(data-t · data-t-aria), 이미 그려진 동적 문구 */
import { settingsStore } from '../state/index.ts'
import { setLang, t, type TKey } from '../core/i18n/index.ts'
import { q, qsa } from './dom.ts'

const refreshers: Array<() => void> = []
/** 언어가 바뀌면 다시 그릴 것. 등록할 때는 부르지 않는다 — 각 모듈은 마운트할 때 이미 지금 언어로 그린다 */
export function onLangChange(fn: () => void): void { refreshers.push(fn) }

function applyStatic(): void {
  qsa<HTMLElement>('[data-t]').forEach(el => { el.textContent = t(el.dataset.t as TKey) })
  qsa<HTMLElement>('[data-t-aria]').forEach(el => el.setAttribute('aria-label', t(el.dataset.tAria as TKey)))
}

/** 다른 모듈보다 먼저 — 그 모듈들이 마운트하며 t() 로 그린다 */
export function mountLang(): void {
  settingsStore.select(s => s.lang, lang => {
    setLang(lang)
    const root = document.documentElement
    root.lang = lang
    applyStatic()
    q('notenames-row').hidden = lang === 'en' // 영어에서는 음이름이 C D E 하나뿐이다
    for (const f of refreshers) f()
    root.classList.remove('i18n-pending') // index.html 이 영어일 때 붙인다 — 한국어 문구가 한 프레임 보이지 않게
  }, { immediate: true })
}
