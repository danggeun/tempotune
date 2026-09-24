/**
 * 전용 모드 다이얼의 수학. 화면은 ui/dial.ts 가 그린다. BPM 은 270° 호에 절대 위치, 링을 돌린 만큼 상대 회전.
 * 각도 규약: 12시가 0°, 시계 방향이 +. 호는 −135°에서 +135°까지.
 */
export const ARC_DEG = 270

/** BPM → 호 위의 각도(°). 범위 밖은 끝에 고정 */
export function bpmToAngle(bpm: number, min: number, max: number): number {
  const t = Math.min(1, Math.max(0, (bpm - min) / (max - min)))
  return -ARC_DEG / 2 + t * ARC_DEG
}

/** 1 BPM 당 각도 */
export const degPerBpm = (min: number, max: number): number => ARC_DEG / (max - min)

/** 두 각도의 차이를 (−180, 180] 로 — 12시를 지나 넘어가도 작은 쪽으로 잰다 */
export function angleDelta(from: number, to: number): number {
  let d = to - from
  while (d > 180) d -= 360
  while (d <= -180) d += 360
  return d
}

/** 화면 좌표(중심 기준)를 각도로 — 12시 0°, 시계 방향 + */
export function pointToAngle(dx: number, dy: number): number {
  return (Math.atan2(dx, -dy) * 180) / Math.PI
}

/** 각도 → 원 위의 점 (SVG 좌표: y 는 아래로) */
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const a = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

/** SVG 호 경로 (시계 방향, a0 → a1, 둘 다 12시 기준 °) */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`
}

/** 템포 용어. 표준이 없어 통용 값으로 빈틈·겹침 없이 자른다 */
export const TEMPO_BANDS: ReadonlyArray<readonly [name: string, from: number]> = [
  ['Grave', 0], ['Largo', 40], ['Larghetto', 60], ['Adagio', 66], ['Andante', 76],
  ['Moderato', 108], ['Allegro', 120], ['Presto', 168], ['Prestissimo', 200],
]
export function tempoName(bpm: number): string {
  let n = TEMPO_BANDS[0]![0]
  for (const [name, from] of TEMPO_BANDS) if (bpm >= from) n = name
  return n
}

/** 호에 새길 이름 [이름, 시작 BPM, 끝 BPM). 20 BPM 이상 구간 넷만 (좁은 구간은 글자보다 짧다). 정확한 용어는 가운데 숫자 밑 */
export const ARC_LABELS: ReadonlyArray<readonly [string, number, number]> = [
  ['Largo', 40, 60], ['Andante', 76, 108], ['Allegro', 120, 168], ['Presto', 168, 200],
]

/** 글자 크기: SVG font-size 는 viewBox user unit 이라 렌더 픽셀을 고정하고 user unit 을 다이얼 크기에 반비례로 준다 */
export const DIAL_VIEWBOX = 320
/** 목표 px. NAME_MAX_UNITS = 제일 좁은 Largo 구간(반지름 94 에서 호 약 55 unit) ÷ "LARGO" 폭(약 3.55 × font); 넘으면 용어를 뺀다 */
export const NUM_TARGET_PX = 11, NAME_TARGET_PX = 10.5, NAME_MAX_UNITS = 15
export function dialTypography(dialPx: number): { numUnits: number; nameUnits: number; showNames: boolean } {
  const k = DIAL_VIEWBOX / Math.max(1, dialPx)
  const nameUnits = NAME_TARGET_PX * k
  return { numUnits: NUM_TARGET_PX * k, nameUnits: Math.min(nameUnits, NAME_MAX_UNITS), showNames: nameUnits <= NAME_MAX_UNITS }
}
