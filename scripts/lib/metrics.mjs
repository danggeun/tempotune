// 벤치마크 판정 로직 — bench.mjs 는 import 시 즉시 실행되므로 테스트 가능한 순수 함수는 여기 둔다.

/** 관측 주파수가 기대 주파수의 배음/하위배음 관계인가 — 비율이 k·1/k (k=2..8) 또는 3/2·2/3 의 ±TOL_CENTS 안이면 '×2' '÷3' '×3/2' 같은 라벨, 아니면 null. 3/2 는 겹친 음의 가상 기본음이 완전5도로 나타나는 경우 */
export const TOL_CENTS = 50 // 반음의 절반
const RATIOS = []
for (let k = 2; k <= 8; k++) { RATIOS.push([k, `×${k}`], [1 / k, `÷${k}`]) }
RATIOS.push([3 / 2, '×3/2'], [2 / 3, '÷3/2'])

export function harmonicRel(hz, expectedHz) {
  if (!(hz > 0) || !(expectedHz > 0)) return null
  const cents = 1200 * Math.log2(hz / expectedHz)
  for (const [r, label] of RATIOS) {
    if (Math.abs(cents - 1200 * Math.log2(r)) <= TOL_CENTS) return label
  }
  return null
}
