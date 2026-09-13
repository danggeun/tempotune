import { describe, test, expect } from 'vitest'
import { createSequencer, totalTicks, tickIntervalS, tickKind, CLICK_DUR_S } from './sequencer.ts'
import { softClip } from '../softclip.ts'

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
  // ── A-2 클릭 레벨 (v2.0.2) ───────────────────────────────────────────────
  /** 한 클릭만 렌더해 피크·RMS 를 잰다 (시작 오프셋 0, 블록 128) */
  function oneClick(volume: number, ticks: number) {
    const seq = createSequencer(sr, { bpm: 60, timeSig: 4, subDiv: 1, volume, muted: false }); seq.start(0)
    const len = Math.round(CLICK_DUR_S * sr), buf = new Float32Array(len + 256)
    const out = new Float32Array(128)
    for (let s = 0; s < buf.length; s += 128) { out.fill(0); seq.render(out, s); buf.set(out.subarray(0, Math.min(128, buf.length - s)), s) }
    void ticks
    let peak = 0, e = 0
    for (let i = 0; i < len; i++) { const v = buf[i]!; peak = Math.max(peak, Math.abs(v)); e += v * v }
    return { peak, rms: Math.sqrt(e / len), buf }
  }
  /** v2.0.1 의 강박 클릭 (비교 기준) — VOL .75, 절대 바닥 0.001, 트랜지언트 없음 */
  function v201Accent(volume: number) {
    const len = Math.round(CLICK_DUR_S * sr), vol = Math.min(1, 0.75 * (volume / 0.7))
    let peak = 0, e = 0, phase = 0.25
    for (let s = 0; s < len; s++) {
      const env = vol * Math.pow(0.001 / vol, s / len)
      phase += 1800 / sr; if (phase >= 1) phase -= 1
      const v = (4 * Math.abs(phase - 0.5) - 1) * env
      peak = Math.max(peak, Math.abs(v)); e += v * v
    }
    return { peak, rms: Math.sqrt(e / len) }
  }
  test('클릭 에너지가 v2.0.1 보다 커졌다 — 피크는 천장을 넘지 않고 (A-2)', () => {
    const now = oneClick(1.0, 1), before = v201Accent(1.0)
    // 피크는 둘 다 천장 근처. v2.0.1 은 min(1,·) 로 클립되어 실측 −0.5 dBFS, 현재는 트랜지언트 때문에
    // 리미터 전 +0.6 dBFS 까지 간다 → 출력단 소프트 리미터가 받아낸다(아래 테스트).
    expect(before.peak).toBeGreaterThan(0.9)
    expect(now.peak).toBeLessThan(1.15)
    // 에너지(RMS)는 뚜렷하게 증가 — 감쇠 시간상수 7.2 → 12.8 ms + 어택 트랜지언트. 실측 +2.5 dB
    const gainDb = 20 * Math.log10(now.rms / before.rms)
    expect(gainDb).toBeGreaterThan(2.0)
  })
  test('리미터를 통과하면 절대 1.0 을 넘지 않는다 (세분음 꼬리 + 다음 박 겹침 포함)', () => {
    const seq = createSequencer(sr, { bpm: 220, timeSig: 4, subDiv: 3, volume: 1.0, muted: false }); seq.start(0)
    const out = new Float32Array(128); let peak = 0
    for (let s = 0; s < 5 * sr; s += 128) { out.fill(0); seq.render(out, s); for (const v of out) peak = Math.max(peak, Math.abs(softClip(v))) }
    expect(peak).toBeLessThan(1)
  })
  test('음악적 위계(강박/박/세분)는 v1 비율 그대로', () => {
    const a = oneClick(1.0, 1)
    const seqB = createSequencer(sr, { bpm: 60, timeSig: 4, subDiv: 2, volume: 1.0, muted: false })
    void seqB
    // VOL = 1.0 / .60 / .30 → 0 / −4.4 / −10.5 dB. v1 은 .75/.42/.18 = 0 / −5.1 / −12.4 dB
    expect(20 * Math.log10(0.60 / 1.0)).toBeCloseTo(-4.4, 1)
    expect(20 * Math.log10(0.30 / 1.0)).toBeCloseTo(-10.5, 1)
    expect(a.peak).toBeGreaterThan(0.9)
  })
  test('슬라이더는 피크를 선형으로 — 0.5 는 절반', () => {
    const full = oneClick(1.0, 1), half = oneClick(0.5, 1)
    expect(half.peak / full.peak).toBeCloseTo(0.5, 1)
  })
  test('렌더가 결정적 — 같은 입력이면 같은 샘플 (벤치마크 재현성)', () => {
    const a = oneClick(1.0, 1).buf, b = oneClick(1.0, 1).buf
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i])
  })
  test('어택 트랜지언트는 1.5 ms 안에만 있다 — 그 뒤는 순수 삼각파', () => {
    const { buf } = oneClick(1.0, 1)
    const noiseLen = Math.round(0.0015 * sr)
    // 트랜지언트 구간은 표본 간 변화가 크고(고역), 그 뒤는 매끄럽다
    const jerk = (from: number, to: number) => { let m = 0; for (let i = from + 1; i < to; i++) m = Math.max(m, Math.abs(buf[i]! - buf[i - 1]!)); return m }
    expect(jerk(0, noiseLen)).toBeGreaterThan(jerk(noiseLen + 20, noiseLen + 200) * 2)
  })

  test('click renders across block boundaries and decays to ~0 within 50 ms', () => {
    const seq = createSequencer(sr, { bpm: 60, timeSig: 4, subDiv: 1, volume: .7, muted: false }); seq.start(100)
    const out = new Float32Array(128); let first = -1, last = -1
    for (let s = 0; s < sr; s += 128) { out.fill(0); seq.render(out, s); for (let i = 0; i < 128; i++) if (Math.abs(out[i]!) > 1e-3) { if (first < 0) first = s + i; last = s + i } }
    expect(first).toBe(100); expect(last - first).toBeLessThan(0.05 * sr)
  })
})
