import { describe, test, expect } from 'vitest'
import { beatCount, beatDurS, ticksPerBeat, isBeatStart, sweepX } from './sweep.ts'

/** 세이코식: 끝에서 박, 사이에서 분할, 박마다 방향 반전. 소리(sequencer)와 같은 틱 격자를 써야 한다. */
describe('Seiko-style beat display', () => {
  test('main beats — two in 6/8, one in beats-only mode', () => {
    expect(beatCount({ timeSig: 4 })).toBe(4)
    expect(beatCount({ timeSig: 6 })).toBe(2)
    expect(beatCount({ timeSig: 1 })).toBe(1)
  })
  test('beat length — a 6/8 main beat is a dotted quarter (1.5×)', () => {
    expect(beatDurS({ bpm: 60, timeSig: 4, subDiv: 1 })).toBeCloseTo(1)
    expect(beatDurS({ bpm: 120, timeSig: 3, subDiv: 2 })).toBeCloseTo(0.5)
    expect(beatDurS({ bpm: 60, timeSig: 6, subDiv: 1 })).toBeCloseTo(1.5)
  })
  test('ticks per beat and beat numbers match the sequencer grid', () => {
    expect(ticksPerBeat({ timeSig: 4, subDiv: 3 })).toBe(3)
    expect(ticksPerBeat({ timeSig: 4, subDiv: 'd' })).toBe(2)
    expect(ticksPerBeat({ timeSig: 6, subDiv: 1 })).toBe(3)
  })
  test('the bar reaches an end only on the first tick of a main beat', () => {
    expect([0, 1, 2, 3, 4, 5].map(t => isBeatStart({ timeSig: 6, subDiv: 1 }, t))).toEqual([true, false, false, true, false, false])
    expect([0, 1, 2, 3].map(t => isBeatStart({ timeSig: 4, subDiv: 1 }, t))).toEqual([true, true, true, true])
  })
  test('bar position — left→right / right→left, waits at the end if the next beat is late', () => {
    expect(sweepX(0, 1)).toBe(0); expect(sweepX(0.5, 1)).toBe(0.5); expect(sweepX(1, 1)).toBe(1)
    expect(sweepX(0, -1)).toBe(1); expect(sweepX(0.25, -1)).toBe(0.75); expect(sweepX(1, -1)).toBe(0)
    expect(sweepX(1.4, 1)).toBe(1); expect(sweepX(-0.1, -1)).toBe(1)
  })
})
