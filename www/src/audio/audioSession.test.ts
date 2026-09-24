import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * iOS 오디오 세션 선언 순서. `navigator.audioSession` 은 iOS 에만 있어 헤드리스로 재현이 안 되므로 소스의 호출 순서를 검사한다.
 * iOS 는 'playback' 상태에서 마이크 캡처를 거부한다 — 선언이 getUserMedia 뒤에 있으면 두 번째 열기부터 실패.
 */
describe('마이크 세션은 getUserMedia 전에 선언한다', () => {
  const raw = readFileSync(new URL('./engine.ts', import.meta.url), 'utf8')
  // 주석 안의 'getUserMedia' 가 잡히지 않게 주석을 걷어낸다
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

  test('열기에 실패하면 재생 전용으로 되돌린다', () => {
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
