import { describe, test, expect } from 'vitest'
import { sniffContainer, extFromMime, containerOf } from './container.ts'

const ftyp = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])
const ebml = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8])

describe('container', () => {
  test('파일 내용으로 판정한다', () => {
    expect(sniffContainer(ftyp)).toBe('m4a')
    expect(sniffContainer(ebml)).toBe('webm')
    expect(sniffContainer(new Uint8Array(12))).toBe(null)
    expect(sniffContainer(new Uint8Array(0))).toBe(null)
  })
  test('mime 추정 — 알 수 없으면 m4a (모든 플랫폼이 여는 쪽)', () => {
    expect(extFromMime('audio/mp4;codecs=mp4a.40.2')).toBe('m4a')
    expect(extFromMime('audio/webm;codecs=opus')).toBe('webm')
    expect(extFromMime('video/x-matroska')).toBe('webm')
    expect(extFromMime('')).toBe('m4a')
    expect(extFromMime(undefined)).toBe('m4a')
  })
  test('내용이 mime 보다 우선 — mimeType 이 비거나 틀려도 이름이 맞는다 (B13)', () => {
    expect(containerOf(ftyp, '')).toBe('m4a')
    expect(containerOf(ftyp, 'audio/webm')).toBe('m4a') // 내용이 이긴다
    expect(containerOf(ebml, 'audio/mp4')).toBe('webm')
    expect(containerOf(new Uint8Array(12), 'audio/webm;codecs=opus')).toBe('webm') // 시그니처 없으면 mime
  })
})
