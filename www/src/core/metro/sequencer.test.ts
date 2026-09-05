import { describe, test, expect } from 'vitest'
import { createSequencer, totalTicks, tickIntervalS, tickKind } from './sequencer.ts'

const sr = 48000
function run(seq: ReturnType<typeof createSequencer>, seconds: number, block = 128, fromSample = 0) {
  const events: { tick: number; sample: number; kind: string }[] = []; const out = new Float32Array(block); let peak = 0
  for (let s = fromSample; s < fromSample + seconds * sr; s += block) { out.fill(0); events.push(...seq.render(out, s)); for (const v of out) peak = Math.max(peak, Math.abs(v)) }
  return { events, peak }
}
describe('sequencer', () => {
  test('pattern math matches v1', () => {
    expect(totalTicks({ timeSig: 4, subDiv: 1 })).toBe(4); expect(totalTicks({ timeSig: 3, subDiv: 'd' })).toBe(6); expect(totalTicks({ timeSig: 6, subDiv: 1 })).toBe(6)
    expect(tickIntervalS({ bpm: 120, timeSig: 4, subDiv: 2 }, 0)).toBeCloseTo(0.25)
    expect(tickIntervalS({ bpm: 120, timeSig: 4, subDiv: 'd' }, 0)).toBeCloseTo(0.375); expect(tickIntervalS({ bpm: 120, timeSig: 4, subDiv: 'd' }, 1)).toBeCloseTo(0.125)
    expect(tickIntervalS({ bpm: 120, timeSig: 6, subDiv: 1 }, 0)).toBeCloseTo(0.25)
    expect(tickKind({ subDiv: 3, timeSig: 4 }, 0)).toBe('accent'); expect(tickKind({ subDiv: 3, timeSig: 4 }, 3)).toBe('beat'); expect(tickKind({ subDiv: 3, timeSig: 4 }, 4)).toBe('sub')
  })
  test('120 bpm 4/4: clicks exactly 0.5 s apart to the sample, zero drift over 60 s', () => {
    const seq = createSequencer(sr, { bpm: 120, timeSig: 4, subDiv: 1, volume: .7, muted: false }); seq.start()
    const { events } = run(seq, 60)
    expect(events.length).toBe(120)
    const d = events.slice(1).map((e, i) => e.sample - events[i]!.sample)
    expect(Math.max(...d) - Math.min(...d)).toBeLessThanOrEqual(1) // 반올림 ±1 샘플
    expect(events[119]!.sample).toBeCloseTo(119 * 0.5 * sr, -1) // 누적 드리프트 없음
    expect(events[0]!.kind).toBe('accent'); expect(events[1]!.kind).toBe('beat')
  })
  test('bpm change applies from the next tick without restart', () => {
    const seq = createSequencer(sr, { bpm: 60, timeSig: 4, subDiv: 1, volume: .7, muted: false }); seq.start()
    const a = run(seq, 2.1).events // 0, 1, 2 s
    seq.setPattern({ bpm: 120 })
    const b = run(seq, 2, 128, Math.ceil(2.1 * sr / 128) * 128).events
    expect(a.length).toBe(3)
    // 마지막 클릭(2 s) 기준으로 새 간격 0.5 s 를 다시 잡는다 → 2.5, 3.0, 3.5 …
    const all = [...a, ...b].map(e => e.sample / sr)
    expect(all[3]).toBeCloseTo(2.5, 2); expect(all[4]).toBeCloseTo(3, 2); expect(all[5]).toBeCloseTo(3.5, 2)
  })
  test('bpm change when the new interval is already past: next click comes immediately, not in the past', () => {
    const seq = createSequencer(sr, { bpm: 40, timeSig: 4, subDiv: 1, volume: .7, muted: false }); seq.start()
    run(seq, 1.2) // 클릭 0 s, 다음 1.5 s 예약
    seq.setPattern({ bpm: 240 }) // 새 간격 0.25 s → 0.25 s 는 이미 지남
    const b = run(seq, 0.3, 128, Math.ceil(1.2 * sr / 128) * 128).events
    expect(b[0]!.sample).toBeGreaterThanOrEqual(Math.ceil(1.2 * sr / 128) * 128); expect(b[0]!.sample).toBeLessThan(1.25 * sr)
  })
  test('volume 0: no NaN, silence', () => {
    const seq = createSequencer(sr, { bpm: 120, timeSig: 4, subDiv: 1, volume: 0, muted: false }); seq.start()
    const out = new Float32Array(128); let bad = 0; for (let s = 0; s < sr; s += 128) { out.fill(0); seq.render(out, s); for (const v of out) if (v !== 0 || Number.isNaN(v)) bad++ }
    expect(bad).toBe(0)
  })
  test('6/8: accent on 1, secondary on 4, rest sub', () => {
    expect([0, 1, 2, 3, 4, 5].map(t => tickKind({ subDiv: 1, timeSig: 6 }, t))).toEqual(['accent', 'sub', 'sub', 'beat', 'sub', 'sub'])
  })
  test('muted: events still fire, no audio', () => {
    const seq = createSequencer(sr, { bpm: 120, timeSig: 4, subDiv: 1, volume: .7, muted: true }); seq.start()
    const { events, peak } = run(seq, 2); expect(events.length).toBe(4); expect(peak).toBe(0)
  })
  test('click renders across block boundaries and decays to ~0 within 50 ms', () => {
    const seq = createSequencer(sr, { bpm: 60, timeSig: 4, subDiv: 1, volume: .7, muted: false }); seq.start(100)
    const out = new Float32Array(128); let first = -1, last = -1
    for (let s = 0; s < sr; s += 128) { out.fill(0); seq.render(out, s); for (let i = 0; i < 128; i++) if (Math.abs(out[i]!) > 1e-3) { if (first < 0) first = s + i; last = s + i } }
    expect(first).toBe(100); expect(last - first).toBeLessThan(0.05 * sr)
  })
})
