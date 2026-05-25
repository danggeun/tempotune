import { describe, test, expect } from 'vitest'
import { bufToWav } from './wav.js'

function mockAudioBuffer(channels, length, sampleRate = 44100) {
  const data = Array.from({ length: channels }, () => new Float32Array(length))
  return { numberOfChannels: channels, sampleRate, length, getChannelData: (c) => data[c] }
}

describe('bufToWav', () => {
  test('produces valid RIFF/WAVE header', () => {
    const wav = bufToWav(mockAudioBuffer(1, 100))
    const dv = new DataView(wav)
    const str = (o, n) => Array.from({ length: n }, (_, i) => String.fromCharCode(dv.getUint8(o + i))).join('')
    expect(str(0, 4)).toBe('RIFF')
    expect(str(8, 4)).toBe('WAVE')
    expect(str(12, 4)).toBe('fmt ')
    expect(str(36, 4)).toBe('data')
  })

  test('correct byte length: mono 100 samples', () => {
    const wav = bufToWav(mockAudioBuffer(1, 100))
    expect(wav.byteLength).toBe(44 + 100 * 1 * 2)
  })

  test('correct byte length: stereo 256 samples', () => {
    const wav = bufToWav(mockAudioBuffer(2, 256))
    expect(wav.byteLength).toBe(44 + 256 * 2 * 2)
  })

  test('clips samples beyond [-1, 1]', () => {
    const ab = mockAudioBuffer(1, 2)
    ab.getChannelData(0)[0] = 2.0
    ab.getChannelData(0)[1] = -2.0
    const wav = bufToWav(ab)
    const dv = new DataView(wav)
    expect(dv.getInt16(44, true)).toBe(0x7FFF)
    expect(dv.getInt16(46, true)).toBe(-0x8000)
  })
})
