/** 첫 진입 마이크 권한 팝업 */
import { q, on } from './dom.ts'

export const showMicPopup = (): void => q('mic-popup-bg').classList.add('show')
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
