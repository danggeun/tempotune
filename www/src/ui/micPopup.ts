/** 첫 진입 마이크 권한 팝업 */
import { q, on } from './dom.ts'
import { isNative } from '../platform/index.ts'
import { t } from '../core/i18n/index.ts'

/** denied=true 면 "차단됨" 안내 문구 */
export function showMicPopup(denied = false): void {
  q('mic-popup-title').textContent = t(denied ? 'mic.titleBlocked' : 'mic.titleOff')
  // 앱에는 주소창이 없다 — 시스템 설정 경로로 안내. 두 번 거부하면 OS 다이얼로그가 다시 뜨지 않는다
  q('mic-popup-desc').innerHTML = t(denied ? (isNative() ? 'mic.descBlockedNative' : 'mic.descBlockedWeb') : 'mic.descOff') // 사전 문구의 <br> 만 — 사용자 입력은 없다
  q('mic-popup-btn').textContent = t(denied ? 'common.retry' : 'mic.turnOn')
  q('mic-popup-bg').classList.add('show')
}
export const closeMicPopup = (): void => q('mic-popup-bg').classList.remove('show')

export function mountMicPopup(openMic: () => Promise<boolean>): void {
  const btn = q<HTMLButtonElement>('mic-popup-btn')
  on(btn, 'click', async () => {
    btn.textContent = t('mic.connecting'); btn.disabled = true
    if (await openMic()) closeMicPopup()
    else { btn.textContent = t('common.retry'); btn.disabled = false }
  })
  on(q('mic-popup-cancel'), 'click', closeMicPopup)
}
