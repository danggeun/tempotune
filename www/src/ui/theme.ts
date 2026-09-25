/** 다크/라이트 적용. 첫 그리기 전 적용은 index.html 의 인라인 스크립트가 맡고, 여기서는 설정이 바뀔 때 따라간다 */
import { settingsStore } from '../state/index.ts'
import { setStatusBarTheme } from '../platform/index.ts'

let onChange: (() => void) | null = null
/** 캔버스처럼 CSS 토큰을 직접 읽어 그리는 쪽이 다시 그리도록 */
export function onThemeChange(fn: () => void): void { onChange = fn }

export function mountTheme(): void {
  settingsStore.select(s => s.theme, theme => {
    const root = document.documentElement
    if (theme === 'light') root.dataset.theme = 'light'; else delete root.dataset.theme
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
    setStatusBarTheme(theme, bg)
    // 아이폰 홈 화면 앱은 이 값을 바로 반영한다(상태바 글자색)
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', theme === 'light' ? 'default' : 'black-translucent')
    onChange?.()
  }, { immediate: true })
}
