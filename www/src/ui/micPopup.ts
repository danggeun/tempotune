/** 첫 진입 마이크 권한 팝업 */
import { q, on } from './dom.ts'

/** denied=true 면 "차단됨" 안내로 문구를 바꾼다 (권한 흐름: 요청 전 / 거부됨 구분) */
export function showMicPopup(denied = false): void {
  q('mic-popup-title').textContent = denied ? '마이크가 차단돼 있어요' : '마이크 접근 필요'
  q('mic-popup-desc').innerHTML = denied ? '주소창의 자물쇠(사이트 설정)에서<br>마이크를 허용한 뒤 다시 시도해주세요' : '소리 감지를 위해<br>마이크를 켜주세요'
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
