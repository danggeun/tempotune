import { describe, test, expect } from 'vitest'
import { bpmToAngle, degPerBpm, angleDelta, pointToAngle, polar, tempoName, ARC_LABELS, TEMPO_BANDS, dialTypography } from './dial.ts'

describe('dial — angles', () => {
  test('range ends at −135° / +135°, middle at 0°', () => {
    expect(bpmToAngle(20, 20, 220)).toBe(-135)
    expect(bpmToAngle(220, 20, 220)).toBe(135)
    expect(bpmToAngle(120, 20, 220)).toBe(0)
    expect(bpmToAngle(0, 20, 220)).toBe(-135)   // 밖은 끝에 고정
    expect(bpmToAngle(999, 20, 220)).toBe(135)
  })
  test('1 BPM = 1.35° (20–220 over 270°)', () => {
    expect(degPerBpm(20, 220)).toBeCloseTo(1.35)
  })
  test('angle differences take the short way across 12 o’clock', () => {
    expect(angleDelta(170, -170)).toBe(20)
    expect(angleDelta(-170, 170)).toBe(-20)
    expect(angleDelta(10, 40)).toBe(30)
    expect(angleDelta(0, 180)).toBe(180)
  })
  test('screen point → angle: 12 o’clock 0°, 3 o’clock 90°, 6 o’clock 180°, 9 o’clock −90°', () => {
    expect(pointToAngle(0, -1)).toBeCloseTo(0)
    expect(pointToAngle(1, 0)).toBeCloseTo(90)
    expect(Math.abs(pointToAngle(0, 1))).toBeCloseTo(180)
    expect(pointToAngle(-1, 0)).toBeCloseTo(-90)
  })
  test('polar: 12 o’clock is up (smaller y), 3 o’clock is right', () => {
    const top = polar(100, 100, 50, 0), right = polar(100, 100, 50, 90)
    expect(top.x).toBeCloseTo(100); expect(top.y).toBeCloseTo(50)
    expect(right.x).toBeCloseTo(150); expect(right.y).toBeCloseTo(100)
  })
})

describe('dial — tempo terms', () => {
  test('boundaries', () => {
    expect(tempoName(20)).toBe('Grave'); expect(tempoName(39)).toBe('Grave')
    expect(tempoName(40)).toBe('Largo'); expect(tempoName(60)).toBe('Larghetto')
    expect(tempoName(66)).toBe('Adagio'); expect(tempoName(76)).toBe('Andante')
    expect(tempoName(107)).toBe('Andante'); expect(tempoName(108)).toBe('Moderato')
    expect(tempoName(120)).toBe('Allegro'); expect(tempoName(168)).toBe('Presto')
    expect(tempoName(200)).toBe('Prestissimo'); expect(tempoName(220)).toBe('Prestissimo')
  })
  test('tempo bands ascend with no gaps or overlaps', () => {
    for (let i = 1; i < TEMPO_BANDS.length; i++) expect(TEMPO_BANDS[i]![1]).toBeGreaterThan(TEMPO_BANDS[i - 1]![1])
  })
  test('every name on the arc covers the same range as its tempo band', () => {
    for (const [name, from, to] of ARC_LABELS) {
      expect(tempoName(from)).toBe(name)
      expect(tempoName(to - 1)).toBe(name)
    }
  })
  test('arc names only on ranges of 20 BPM or more — narrower ones would clip', () => {
    for (const [, from, to] of ARC_LABELS) expect(to - from).toBeGreaterThanOrEqual(20)
  })
  test('no Grave on the arc — starts at Largo like a real dial', () => {
    expect(ARC_LABELS[0]![0]).toBe('Largo')
  })
  test('arc names are in order without overlap', () => {
    for (let i = 1; i < ARC_LABELS.length; i++) expect(ARC_LABELS[i]![1]).toBeGreaterThanOrEqual(ARC_LABELS[i - 1]![2])
  })
})

describe('dial — text size', () => {
  test('fixed rendered size: user units are inversely proportional to dial px', () => {
    const a = dialTypography(320), b = dialTypography(160)
    expect(a.numUnits).toBeCloseTo(11); expect(b.numUnits).toBeCloseTo(22)
    expect(a.nameUnits).toBeCloseTo(10.5)
  })
  test('numbers are always larger than terms — the value leads, terms are signposts', () => {
    for (const px of [320, 308, 244, 217]) { const t = dialTypography(px); expect(t.numUnits).toBeGreaterThan(t.nameUnits) }
  })
  test('terms grow only up to 15 units, shrink with smaller dials and hide below 9 px — boundary 192 px', () => {
    expect(dialTypography(244).showNames).toBe(true)
    expect(dialTypography(214).showNames).toBe(true)  // 아이폰 실측 크기
    expect(dialTypography(214).nameUnits).toBe(15)    // 렌더 10 px
    expect(dialTypography(168).showNames).toBe(false) // iPhone SE
    const edge = (9 * 320) / 15 // = 192
    expect(dialTypography(edge + 0.5).showNames).toBe(true)
    expect(dialTypography(edge - 0.5).showNames).toBe(false)
  })
  test('monotonic as the dial shrinks, survives zero or negative input', () => {
    let prev = 0
    for (const px of [320, 300, 256, 244, 217, 150]) { const t = dialTypography(px); expect(t.numUnits).toBeGreaterThan(prev); prev = t.numUnits }
    expect(Number.isFinite(dialTypography(0).numUnits)).toBe(true)
  })
})
