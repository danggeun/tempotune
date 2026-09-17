import { describe, test, expect } from 'vitest'
import { beatCount, beatDurS, ticksPerBeat, beatIndex, isBeatStart, subMarkers, sweepX } from './sweep.ts'

/** 세이코식: 끝에서 박, 사이에서 분할, 박마다 방향 반전. 소리(sequencer)와 같은 틱 격자를 써야 한다. */
describe('세이코식 박 표시 (K5)', () => {
  test('큰 박 개수 — 6/8 은 둘, 정박 모드는 하나', () => {
    expect(beatCount({ timeSig: 4 })).toBe(4)
    expect(beatCount({ timeSig: 6 })).toBe(2)
    expect(beatCount({ timeSig: 1 })).toBe(1)
  })
  test('한 박의 길이 — 6/8 의 큰 박은 점4분음표(1.5배)', () => {
    expect(beatDurS({ bpm: 60, timeSig: 4, subDiv: 1 })).toBeCloseTo(1)
    expect(beatDurS({ bpm: 120, timeSig: 3, subDiv: 2 })).toBeCloseTo(0.5)
    expect(beatDurS({ bpm: 60, timeSig: 6, subDiv: 1 })).toBeCloseTo(1.5)
  })
  test('박 안의 틱 수와 박 번호가 시퀀서의 틱 격자와 맞는다', () => {
    expect(ticksPerBeat({ timeSig: 4, subDiv: 3 })).toBe(3)
    expect(ticksPerBeat({ timeSig: 4, subDiv: 'd' })).toBe(2)
    expect(ticksPerBeat({ timeSig: 6, subDiv: 1 })).toBe(3)
    expect([0, 1, 2, 3, 4, 5].map(t => beatIndex({ timeSig: 6, subDiv: 1 }, t))).toEqual([0, 0, 0, 1, 1, 1])
    expect([0, 1, 2, 3, 4, 5].map(t => beatIndex({ timeSig: 3, subDiv: 2 }, t))).toEqual([0, 0, 1, 1, 2, 2])
  })
  test('막대가 끝에 닿는 틱 = 큰 박의 시작 틱뿐', () => {
    expect([0, 1, 2, 3, 4, 5].map(t => isBeatStart({ timeSig: 6, subDiv: 1 }, t))).toEqual([true, false, false, true, false, false])
    expect([0, 1, 2, 3].map(t => isBeatStart({ timeSig: 4, subDiv: 1 }, t))).toEqual([true, true, true, true])
  })
  test('분할 눈금 위치 — 리듬대로 사이에', () => {
    expect(subMarkers({ timeSig: 4, subDiv: 1 })).toEqual([])
    expect(subMarkers({ timeSig: 4, subDiv: 2 })).toEqual([0.5])
    expect(subMarkers({ timeSig: 4, subDiv: 3 }).map(v => +v.toFixed(3))).toEqual([0.333, 0.667])
    expect(subMarkers({ timeSig: 4, subDiv: 'd' })).toEqual([0.75])
    expect(subMarkers({ timeSig: 6, subDiv: 1 }).map(v => +v.toFixed(3))).toEqual([0.333, 0.667])
  })
  test('막대 위치 — 왼→오 / 오→왼, 다음 박이 늦으면 끝에 머문다', () => {
    expect(sweepX(0, 1)).toBe(0); expect(sweepX(0.5, 1)).toBe(0.5); expect(sweepX(1, 1)).toBe(1)
    expect(sweepX(0, -1)).toBe(1); expect(sweepX(0.25, -1)).toBe(0.75); expect(sweepX(1, -1)).toBe(0)
    expect(sweepX(1.4, 1)).toBe(1); expect(sweepX(-0.1, -1)).toBe(1)
  })
})
