import { describe, test, expect } from 'vitest'
import { setAllowBackup, isWebBuildHtml } from './cap-manifest.mjs'

// Capacitor 8 템플릿이 실제로 내보내는 형태
const TEMPLATE = `<application android:allowBackup="true" android:icon="@mipmap/ic_launcher" android:label="@string/app_name">`

describe('setAllowBackup (R1)', () => {
  test('true → false', () => expect(setAllowBackup(TEMPLATE)).toContain('android:allowBackup="false"'))
  test('멱등 — 이미 false 면 그대로', () => {
    const once = setAllowBackup(TEMPLATE)
    expect(setAllowBackup(once)).toBe(once)
  })
  test('속성이 없으면 추가', () => {
    const out = setAllowBackup('<application android:label="x">')
    expect(out).toBe('<application android:allowBackup="false" android:label="x">')
  })
  test('true 가 하나도 남지 않는다', () => expect(setAllowBackup(TEMPLATE)).not.toContain('allowBackup="true"'))
})

describe('isWebBuildHtml (R3)', () => {
  test('Pages 빌드 감지 (레포명 무관)', () => { expect(isWebBuildHtml('<script src="/tempotune/assets/a.js">')).toBe(true); expect(isWebBuildHtml('<link href="/anything/assets/a.css">')).toBe(true) })
  test('앱 빌드는 통과', () => expect(isWebBuildHtml('<script src="/assets/a.js">')).toBe(false))
})
