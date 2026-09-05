/** 첫 진입 마이크 권한 팝업 */
import { q, on } from './dom.ts'
import { isNative } from '../platform/index.ts'

/** denied=true 면 "차단됨" 안내로 문구를 바꾼다 (권한 흐름: 요청 전 / 거부됨 구분) */
export function showMicPopup(denied = false): void {
  q('mic-popup-title').textContent = denied ? '마이크가 차단돼 있어요' : '마이크를 켜 주세요'
  // 앱에는 주소창이 없다 — 시스템 설정 경로로 안내 (두 번 거부하면 OS 다이얼로그가 다시 뜨지 않는다)
  q('mic-popup-desc').innerHTML = denied ? (isNative() ? '설정 › 앱 › Go practice › 권한에서<br>마이크를 허용해주세요' : '주소창 자물쇠 › 사이트 설정에서<br>마이크를 허용해주세요') : '음을 들으려면<br>마이크가 필요해요'
  q('mic-popup-btn').textContent = denied ? '다시 시도' : '마이크 켜기'
  q('mic-popup-bg').classList.add('show')
}
export const closeMicPopup = (): void => q('mic-popup-bg').classList.remove('show')

export function mountMicPopup(openMic: () => Promise<boolean>): void {
  const btn = q<HTMLButtonElement>('mic-popup-btn')
  on(btn, 'click', async () => {
    btn.textContent = '연결 중...'; btn.disabled = true
    if (await openMic()) closeMicPopup()
    else { btn.textContent = '다시 시도'; btn.disabled = false }
  })
  on(q('mic-popup-cancel'), 'click', closeMicPopup)
}
