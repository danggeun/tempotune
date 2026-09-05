import { describe, test, expect } from 'vitest'
import { hzToMidi, midiToHz, centsFrom, noteName, octaveOf, splitAccidental, ENHARMONIC } from './note.ts'

describe('note math', () => {
  test('A4 440 → midi 69, 라, 옥타브 4', () => {
    expect(hzToMidi(440)).toBe(69); expect(noteName(69)).toBe('라'); expect(octaveOf(69)).toBe(4)
  })
  test('C2 65.41 → midi 36, 도, 옥타브 2', () => { expect(hzToMidi(65.41)).toBe(36); expect(noteName(36)).toBe('도'); expect(octaveOf(36)).toBe(2) })
  test('440 Hz at A=442 → −8 cents (v1 동작)', () => expect(centsFrom(440, 69, 442)).toBe(-8))
  test('midiToHz round-trips', () => expect(midiToHz(69, 442)).toBeCloseTo(442, 6))
  test('splitAccidental', () => { expect(splitAccidental('도♯')).toEqual({ base: '도', acc: '♯' }); expect(splitAccidental('라')).toEqual({ base: '라', acc: '' }) })
  test('enharmonic table', () => { expect(ENHARMONIC['도♯']).toBe('레♭'); expect(ENHARMONIC['라']).toBeUndefined() })
})
