/**
 * 세이코식 박 표시의 수학. 화면은 ui/metro.ts 가 그린다.
 * 막대는 한 박에 한쪽 끝에서 반대쪽 끝까지 직선으로 가고(박마다 방향 반전), 박은 끝에서, 분할은 사이에서 울린다.
 */
import type { Pattern } from './sequencer.ts'
import { totalTicks } from './sequencer.ts'

type P = Pick<Pattern, 'bpm' | 'timeSig' | 'subDiv'>

/** 큰 박의 개수. 6/8 은 8분음표 6개지만 큰 박은 둘(점4분음표 × 2) */
export const beatCount = (p: Pick<Pattern, 'timeSig'>): number => p.timeSig === 6 ? 2 : p.timeSig

/** 한 박(막대가 한쪽 끝에서 반대 끝까지 가는 시간) — 초 */
export const beatDurS = (p: P): number => (60 / p.bpm) * (p.timeSig === 6 ? 1.5 : 1)

/** 큰 박 하나 안의 틱 수 */
export const ticksPerBeat = (p: Pick<Pattern, 'timeSig' | 'subDiv'>): number => totalTicks(p) / beatCount(p)


/** 이 틱이 큰 박의 시작인가 — 막대가 끝에 닿는 순간 */
export const isBeatStart = (p: Pick<Pattern, 'timeSig' | 'subDiv'>, tick: number): boolean => tick % ticksPerBeat(p) === 0


/** 막대의 가로 위치 (0 = 왼쪽 끝, 1 = 오른쪽 끝). phase = 박 이후 지난 비율, dir +1 왼→오. phase ≥ 1 이면 끝에 머문다 */
export function sweepX(phase: number, dir: 1 | -1): number {
  const t = Math.min(1, Math.max(0, phase))
  return dir === 1 ? t : 1 - t
}

/** LED 줄(N개)에서 위치 x(0~1)에 해당하는 인덱스 — 양 끝이 정확히 0 과 N−1 */
export const ledIndex = (x: number, n: number): number => Math.round(Math.min(1, Math.max(0, x)) * (n - 1))

/** 이 틱이 LED 줄에서 어느 칸을 때리나: 박 시작이면 방향에 따라 끝 칸, 분할이면 사이 칸 */
export function hitIndex(p: Pick<Pattern, 'timeSig' | 'subDiv'>, tick: number, dir: 1 | -1, n: number): number {
  const per = ticksPerBeat(p), k = tick % per
  const x = k === 0 ? 0 : (p.subDiv === 'd' && p.timeSig !== 6 ? 0.75 : k / per)
  return ledIndex(dir === 1 ? x : 1 - x, n)
}
