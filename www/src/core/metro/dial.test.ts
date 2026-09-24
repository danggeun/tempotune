import { describe, test, expect } from 'vitest'
import { bpmToAngle, degPerBpm, angleDelta, pointToAngle, polar, tempoName, ARC_LABELS, TEMPO_BANDS, dialTypography } from './dial.ts'

describe('다이얼 — 각도', () => {
  test('범위 양 끝이 −135° / +135°, 가운데가 0°', () => {
    expect(bpmToAngle(20, 20, 220)).toBe(-135)
    expect(bpmToAngle(220, 20, 220)).toBe(135)
    expect(bpmToAngle(120, 20, 220)).toBe(0)
    expect(bpmToAngle(0, 20, 220)).toBe(-135)   // 밖은 끝에 고정
    expect(bpmToAngle(999, 20, 220)).toBe(135)
  })
  test('1 BPM = 1.35° (20~220 을 270° 에)', () => {
    expect(degPerBpm(20, 220)).toBeCloseTo(1.35)
  })
  test('각도 차이는 12시를 넘어도 작은 쪽으로', () => {
    expect(angleDelta(170, -170)).toBe(20)
    expect(angleDelta(-170, 170)).toBe(-20)
    expect(angleDelta(10, 40)).toBe(30)
    expect(angleDelta(0, 180)).toBe(180)
  })
  test('화면 좌표 → 각도: 12시 0°, 3시 90°, 6시 180°, 9시 −90°', () => {
    expect(pointToAngle(0, -1)).toBeCloseTo(0)
    expect(pointToAngle(1, 0)).toBeCloseTo(90)
    expect(Math.abs(pointToAngle(0, 1))).toBeCloseTo(180)
    expect(pointToAngle(-1, 0)).toBeCloseTo(-90)
  })
  test('polar 는 12시가 위(y 작음), 3시가 오른쪽', () => {
    const top = polar(100, 100, 50, 0), right = polar(100, 100, 50, 90)
    expect(top.x).toBeCloseTo(100); expect(top.y).toBeCloseTo(50)
    expect(right.x).toBeCloseTo(150); expect(right.y).toBeCloseTo(100)
  })
})

describe('다이얼 — 템포 용어', () => {
  test('경계값', () => {
    expect(tempoName(20)).toBe('Grave'); expect(tempoName(39)).toBe('Grave')
    expect(tempoName(40)).toBe('Largo'); expect(tempoName(60)).toBe('Larghetto')
    expect(tempoName(66)).toBe('Adagio'); expect(tempoName(76)).toBe('Andante')
    expect(tempoName(107)).toBe('Andante'); expect(tempoName(108)).toBe('Moderato')
    expect(tempoName(120)).toBe('Allegro'); expect(tempoName(168)).toBe('Presto')
    expect(tempoName(200)).toBe('Prestissimo'); expect(tempoName(220)).toBe('Prestissimo')
  })
  test('용어 띠는 오름차순이고 빈틈·겹침이 없다', () => {
    for (let i = 1; i < TEMPO_BANDS.length; i++) expect(TEMPO_BANDS[i]![1]).toBeGreaterThan(TEMPO_BANDS[i - 1]![1])
  })
  test('호에 새기는 이름은 전부 실제 용어 띠와 같은 구간을 가리킨다', () => {
    for (const [name, from, to] of ARC_LABELS) {
      expect(tempoName(from)).toBe(name)
      expect(tempoName(to - 1)).toBe(name)
    }
  })
  test('호의 이름은 전부 20 BPM 이상 구간 — 좁으면 글자가 잘린다', () => {
    for (const [, from, to] of ARC_LABELS) expect(to - from).toBeGreaterThanOrEqual(20)
  })
  test('호에 Grave 는 없다 — 실물 다이얼처럼 Largo 부터', () => {
    expect(ARC_LABELS[0]![0]).toBe('Largo')
  })
  test('호의 이름들은 겹치지 않고 순서대로', () => {
    for (let i = 1; i < ARC_LABELS.length; i++) expect(ARC_LABELS[i]![1]).toBeGreaterThanOrEqual(ARC_LABELS[i - 1]![2])
  })
})

describe('다이얼 — 글자 크기', () => {
  test('렌더 크기 고정: user unit 은 다이얼 px 에 반비례', () => {
    const a = dialTypography(320), b = dialTypography(160)
    expect(a.numUnits).toBeCloseTo(11); expect(b.numUnits).toBeCloseTo(22)
    expect(a.nameUnits).toBeCloseTo(10.5)
  })
  test('숫자가 늘 용어보다 크다 — 값이 주인공, 용어는 이정표', () => {
    for (const px of [320, 308, 244, 217]) { const t = dialTypography(px); expect(t.numUnits).toBeGreaterThan(t.nameUnits) }
  })
  test('용어는 상한(15 unit)까지만 커지고, 넘으면 감춘다 — 경계 224 px', () => {
    expect(dialTypography(244).showNames).toBe(true)
    expect(dialTypography(217).showNames).toBe(false)
    expect(dialTypography(217).nameUnits).toBe(15) // 감춰도 값은 상한에 고정 (다시 커지면 바로 쓸 수 있게)
    const edge = (10.5 * 320) / 15 // = 224
    expect(dialTypography(edge + 0.5).showNames).toBe(true)
    expect(dialTypography(edge - 0.5).showNames).toBe(false)
  })
  test('작아질수록 단조 증가, 0 이하 입력에도 안 터진다', () => {
    let prev = 0
    for (const px of [320, 300, 256, 244, 217, 150]) { const t = dialTypography(px); expect(t.numUnits).toBeGreaterThan(prev); prev = t.numUnits }
    expect(Number.isFinite(dialTypography(0).numUnits)).toBe(true)
  })
})
