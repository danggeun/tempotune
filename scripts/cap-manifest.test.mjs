import { describe, test, expect } from 'vitest'
import { setAllowBackup, isWebBuildHtml } from './cap-manifest.mjs'

// Capacitor 8 템플릿이 실제로 내보내는 형태
const TEMPLATE = `<application android:allowBackup="true" android:icon="@mipmap/ic_launcher" android:label="@string/app_name">`

describe('setAllowBackup', () => {
  test('true → false', () => expect(setAllowBackup(TEMPLATE)).toContain('android:allowBackup="false"'))
  test('idempotent — stays as is when already false', () => {
    const once = setAllowBackup(TEMPLATE)
    expect(setAllowBackup(once)).toBe(once)
  })
  test('adds the attribute when missing', () => {
    const out = setAllowBackup('<application android:label="x">')
    expect(out).toBe('<application android:allowBackup="false" android:label="x">')
  })
  test('no true is left', () => expect(setAllowBackup(TEMPLATE)).not.toContain('allowBackup="true"'))
})

describe('isWebBuildHtml', () => {
  test('detects a Pages build (any repo name)', () => { expect(isWebBuildHtml('<script src="/intonome/assets/a.js">')).toBe(true); expect(isWebBuildHtml('<link href="/anything/assets/a.css">')).toBe(true) })
  test('app builds pass', () => expect(isWebBuildHtml('<script src="/assets/a.js">')).toBe(false))
})
