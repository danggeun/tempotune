/**
 * 전용 모드 다이얼의 수학 (v2.3.0). 화면은 모른다 — ui/dial.ts 가 그린다.
 *
 * 실물(SEIKO SQ100-77 같은 다이얼식)을 따른다: BPM 범위가 **270° 호**에 절대 위치로 놓이고,
 * 손가락으로 링을 **돌린 만큼** BPM 이 변한다(상대 회전). 잡은 자리로 값이 튀지 않는다 —
 * 실물 다이얼도 잡는 순간 값이 바뀌지 않고 돌려야 바뀐다.
 *
 * 각도 규약: 12시가 0°, 시계 방향이 +. 호는 −135°(7시 반)에서 +135°(4시 반)까지.
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

/**
 * 템포 용어. 경계는 통용되는 값(메트로놈 실물·교과서가 대체로 이 근처).
 * 정확한 표준은 없다 — "안단테 76~108" 처럼 겹치는 자료도 있어, 여기서는 빈틈·겹침 없이 자른다.
 */
export const TEMPO_BANDS: ReadonlyArray<readonly [name: string, from: number]> = [
  ['Grave', 0], ['Largo', 40], ['Larghetto', 60], ['Adagio', 66], ['Andante', 76],
  ['Moderato', 108], ['Allegro', 120], ['Presto', 168], ['Prestissimo', 200],
]
export function tempoName(bpm: number): string {
  let n = TEMPO_BANDS[0]![0]
  for (const [name, from] of TEMPO_BANDS) if (bpm >= from) n = name
  return n
}

/**
 * 호에 새길 이름 — 전부 새기면 좁은 구간(Larghetto 6, Adagio 10, Moderato 12 BPM)이 글자보다 짧아 겹치거나 잘린다
 * (링 안쪽 반지름 94 에서 1 BPM ≈ 2.2 px — Adagio 는 22 px, 글자는 32 px). 이정표 역할이면 충분하다:
 * 20 BPM 이상인 넷만 새기고, **정확한 현재 용어는 가운데 숫자 밑이 말한다.** 각 항목: [이름, 시작 BPM, 끝 BPM)
 * Grave(20~40)는 구간은 넓지만 뺐다 — 실물 다이얼도 인쇄는 Largo 부터고, 연습 중에 볼 일이 없는 용어다(사용자 지적).
 */
export const ARC_LABELS: ReadonlyArray<readonly [string, number, number]> = [
  ['Largo', 40, 60], ['Andante', 76, 108], ['Allegro', 120, 168], ['Presto', 168, 200],
]

/**
 * 글자 크기 (v2.3.1, L7 2단계). SVG 의 font-size 는 viewBox(320) user unit 이라 다이얼이 작아지면 글자도 같이 준다 —
 * 360×640 폰에서 다이얼 217 px 이면 숫자가 7 px 로 안 읽힌다. 그래서 **렌더 픽셀을 고정**하고 user unit 을 반비례로 준다.
 *
 *   · 숫자 목표 10 px. 솎지 않는다 — 인접 숫자(20 BPM = 27°)는 반지름 133 에서 호 약 63 unit, 세 자리 글자는 ~30 unit 이라 여유가 두 배.
 *   · 용어 목표 9.5 px. 그러나 용어는 **호 길이에 갇힌다** — 제일 좁은 Largo(27°)가 반지름 94 에서 호 약 44 unit.
 *     user unit 이 NAME_MAX_UNITS 를 넘으면 글자가 호를 넘쳐 잘리므로(v2.3.0 의 "Adagio → DAGI"), 그때는 용어를 통째로 뺀다.
 *     정확한 용어는 어차피 가운데 숫자 밑에 있다. 실측: 244 px(iPhone SE) 에서 4개 다 온전, 217 px 에서 빠진다.
 */
export const DIAL_VIEWBOX = 320
export const NUM_TARGET_PX = 10, NAME_TARGET_PX = 9.5, NAME_MAX_UNITS = 13.5
export function dialTypography(dialPx: number): { numUnits: number; nameUnits: number; showNames: boolean } {
  const k = DIAL_VIEWBOX / Math.max(1, dialPx)
  const nameUnits = NAME_TARGET_PX * k
  return { numUnits: NUM_TARGET_PX * k, nameUnits: Math.min(nameUnits, NAME_MAX_UNITS), showNames: nameUnits <= NAME_MAX_UNITS }
}
