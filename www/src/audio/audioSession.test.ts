import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * K7 — iOS 오디오 세션 선언 순서.
 *
 * 왜 소스를 문자열로 검사하나: 이 버그는 `navigator.audioSession` 이 있는 iOS 에서만 난다.
 * 헤드리스 크로미움에는 그 API 자체가 없어 `setAudioSession` 이 조용히 no-op 하므로
 * **e2e 로도 단위 테스트로도 재현되지 않는다.** 실기기 없이 지킬 수 있는 건 "순서" 뿐이라,
 * 순서를 소스에서 직접 못 박는다. 못생겼지만 이게 이 결함을 막는 유일한 자동 검사다.
 *
 * 원인: iOS 는 AVAudioSession 카테고리가 'playback' 이면 마이크 캡처를 거부한다
 * (`The audio session category is not compatible with audio capture`).
 * closeMic() 이 'playback' 으로 돌려놓으므로, 다음 openMic() 은 그 상태에서 시작한다.
 * 선언이 getUserMedia **뒤**에 있으면 영영 도달하지 못하고 두 번째부터 항상 실패한다.
 */
describe('K7 — 마이크 세션은 getUserMedia 전에 선언한다', () => {
  const raw = readFileSync(new URL('./engine.ts', import.meta.url), 'utf8')
  /** 주석을 걷어낸다 — 주석 안의 'getUserMedia' 글자가 실제 호출보다 먼저 잡히면 검사가 거짓말을 한다 */
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
  const openMic = src.slice(src.indexOf('export async function openMic'))
  const body = openMic.slice(0, openMic.indexOf('\n}\n') + 1)

  test('openMic 안에서 audioSessionHint(true) 가 getUserMedia 보다 먼저 온다', () => {
    const hint = body.indexOf('audioSessionHint(true)')
    const gum = body.indexOf('getUserMedia')
    expect(hint, 'openMic 에 audioSessionHint(true) 가 없다').toBeGreaterThan(-1)
    expect(gum, 'openMic 에 getUserMedia 가 없다').toBeGreaterThan(-1)
    expect(hint, 'audioSessionHint(true) 가 getUserMedia 뒤에 있으면 iOS 에서 재개가 영구 실패한다').toBeLessThan(gum)
  })

  test('열기에 실패하면 재생 전용으로 되돌린다 (B12 음량 감쇠 재발 방지)', () => {
    const cat = body.indexOf('} catch')
    expect(cat).toBeGreaterThan(-1)
    expect(body.slice(cat), '실패 경로에 audioSessionHint(false) 가 없다').toContain('audioSessionHint(false)')
  })

  test('closeMic 은 재생 전용으로 되돌린다', () => {
    const close = src.slice(src.indexOf('export function closeMic'))
    expect(close.slice(0, close.indexOf('\n}\n'))).toContain('audioSessionHint(false)')
  })

  test('세션 종류는 마이크 유무로만 갈린다', () => {
    expect(raw).toContain("mic ? 'play-and-record' : 'playback'")
  })
})
