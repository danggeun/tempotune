// 벤치마크 판정 로직 — bench.mjs 는 import 시 즉시 실행되므로 테스트 가능한 순수 함수는 여기 둔다.

/**
 * 관측 주파수가 기대 주파수의 배음/하위배음 관계인가.
 *
 * 왜 필요한가: 이전 하네스는 `|midi차| === 12` 만 옥타브 오류로 셌다. 실제 녹음(바이올린 더블스톱)에서
 * 관측된 오류는 2옥타브(×¼) 29 % · 옥타브+5도(×⅓) 8 % 였고, 이것들이 옥타브 오류로 집계되지 않은 채
 * −2400 ¢ 같은 값으로 centsErr 에 섞여 센트 통계를 오염시켰다 (docs 실측 발견 B3).
 * 합성 신호는 전부 단음이라 이 구멍이 드러날 기회가 없었다.
 *
 * 판정: 비율이 k 또는 1/k (k=2..8) 혹은 3/2·2/3 의 ±TOL_CENTS 안이면 배음 관계로 본다.
 * 3/2 를 넣는 이유: 두 음이 겹칠 때 가상 기본음이 한쪽 음의 완전5도 관계로 나타나는 경우가 실제로 있다.
 * @returns {string|null} '×2' '÷3' '×3/2' 같은 라벨, 아니면 null
 */
export const TOL_CENTS = 50 // 반음의 절반 — "가장 가까운 음이 그 배음"이면 배음 오류로 본다
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
