/**
 * 메트로놈 시퀀서 — 샘플 단위로 클릭 위치를 정하고 파형을 버퍼에 렌더한다. 순수 (워클릿·테스트 공용).
 * 오디오 스레드는 백그라운드에서 스로틀되지 않고, 샘플 단위 위치로 튜너 뮤트 구간을 정확히 잡는다.
 * 클릭음: 강박 1800 / 박 1100 / 세분 750 Hz 삼각파, 50 ms 지수 감쇠. 붓점('d')은 3:1.
 */
export type SubDiv = 1 | 2 | 3 | 4 | 'd' // 4 = 16분음표
export type TimeSig = 1 | 2 | 3 | 4 | 6 // 1 = 박자표 없음(정박만)

export interface Pattern { bpm: number; timeSig: TimeSig; subDiv: SubDiv; volume: number; muted: boolean }

export interface ClickEvent { tick: number; sample: number; kind: 'accent' | 'beat' | 'sub' }

export const CLICK_DUR_S = 0.05

export function totalTicks(p: Pick<Pattern, 'timeSig' | 'subDiv'>): number { return p.subDiv === 'd' ? p.timeSig * 2 : p.timeSig * p.subDiv }
export function tickKind(p: Pick<Pattern, 'subDiv' | 'timeSig'>, tick: number): ClickEvent['kind'] {
  // 정박만: 마디가 없으므로 첫 박 강세도 없다. 분할은 약하게 둔다
  if (p.timeSig === 1) return p.subDiv === 'd' ? (tick % 2 === 0 ? 'beat' : 'sub') : (tick % p.subDiv === 0 ? 'beat' : 'sub')
  if (tick === 0) return 'accent'
  if (p.timeSig === 6) return tick === 3 ? 'beat' : 'sub' // 6/8: 둘째 큰 박(4번째 8분음표)에 중간 액센트
  const isBeat = p.subDiv === 'd' ? tick % 2 === 0 : tick % p.subDiv === 0
  return isBeat ? 'beat' : 'sub'
}
/** 틱 tick 에서 다음 틱까지의 길이 (초) */
export function tickIntervalS(p: Pick<Pattern, 'bpm' | 'timeSig' | 'subDiv'>, tick: number): number {
  const b = 60 / p.bpm
  if (p.timeSig === 6) return b / 2
  if (p.subDiv === 'd') return tick % 2 === 0 ? b * 3 / 4 : b / 4
  return b / p.subDiv
}

const FREQ = { accent: 1800, beat: 1100, sub: 750 } as const
/** 클릭 피크 (슬라이더 최대). 위계 0 / −4.4 / −10.5 dB */
const VOL = { accent: 1.0, beat: .60, sub: .30 } as const
/** 감쇠 바닥(피크 대비 2 %) → τ = 50 / ln(50) ≈ 12.8 ms, 세기와 무관 */
const CLICK_FLOOR = 0.02
/** 꼬리를 0 으로 매끄럽게 — 2 % 에서 뚝 끊으면 작은 '툭' 소리가 된다 */
const CLICK_FADE_S = 0.003
/** 어택 고역 트랜지언트(1.5 ms 1차 차분 잡음, 결정적 LCG). 첫 샘플은 고정 임펄스 — 온셋이 항상 예약 샘플이 되게 */
const NOISE_S = 0.0015, NOISE_AMP = 0.5, ATTACK_IMPULSE = 0.6

export interface Sequencer {
  /** 패턴 교체. BPM 이 바뀌면 예약된 다음 클릭도 마지막 클릭 기준 새 간격으로 다시 잡는다 */
  setPattern(p: Partial<Pattern>): void
  /** 다음 예약된 클릭을 유지한 채 그 클릭을 1박으로 (박자/세분 변경용) */
  resetBar(): void
  getPattern(): Pattern
  /** 재생 시작: 첫 틱을 startOffsetSamples 뒤에 */
  start(startOffsetSamples?: number): void
  stop(): void
  readonly running: boolean
  /** out 에 클릭을 덧셈으로 렌더, 이 블록에서 시작하는 클릭 이벤트 반환. blockStartSample = 블록 첫 샘플의 절대 번호 */
  render(out: Float32Array, blockStartSample: number): ClickEvent[]
}

export function createSequencer(sampleRate: number, initial: Pattern): Sequencer {
  const p: Pattern = { ...initial }
  let running = false
  let nextClickSample = 0 // 다음 클릭의 절대 샘플 위치 (소수 허용 — 누적 오차 없음)
  let tick = 0
  let lastClickSample = NaN, lastTick = 0, renderPos = 0
  const active: Array<{ startSample: number; phase: number; freq: number; vol: number; seed: number; prev: number }> = []
  const clickLen = Math.round(CLICK_DUR_S * sampleRate)
  const fadeLen = Math.max(1, Math.round(CLICK_FADE_S * sampleRate))
  const noiseLen = Math.max(1, Math.round(NOISE_S * sampleRate))

  return {
    get running() { return running },
    getPattern: () => ({ ...p }),
    setPattern(patch) {
      const bpmChanged = patch.bpm !== undefined && patch.bpm !== p.bpm
      Object.assign(p, patch)
      if (bpmChanged && running && !Number.isNaN(lastClickSample) && nextClickSample >= 0) {
        nextClickSample = Math.max(renderPos, lastClickSample + tickIntervalS(p, lastTick) * sampleRate)
      }
    },
    resetBar() { tick = 0 },
    start(startOffsetSamples = 0) { running = true; tick = 0; nextClickSample = -1 - startOffsetSamples; lastClickSample = NaN; active.length = 0 }, // -1: 첫 render 에서 blockStart 기준으로 잡음
    stop() { running = false; active.length = 0 },
    render(out, blockStart) {
      const n = out.length, events: ClickEvent[] = []
      renderPos = blockStart + n // 다음 블록의 시작 (과거로 예약하지 않게)
      if (running) {
        if (nextClickSample < 0) nextClickSample = blockStart + (-1 - nextClickSample) // start(offset) 보정
        // 이 블록 안에서 시작하는 클릭들을 등록
        while (nextClickSample < blockStart + n) {
          const kind = tickKind(p, tick)
          const startSample = Math.round(nextClickSample)
          events.push({ tick, sample: startSample, kind })
          const vol = VOL[kind] * p.volume
          // phase 0.25 = 삼각파 영점에서 시작 (0 이면 +1 스텝 트랜지언트). vol≈0 은 렌더 생략 (0·∞ = NaN 방지)
          if (!p.muted && vol > 0.001) active.push({ startSample, phase: 0.25, freq: FREQ[kind], vol, seed: (startSample * 2654435761) >>> 0, prev: 0 })
          lastClickSample = nextClickSample; lastTick = tick
          nextClickSample += tickIntervalS(p, tick) * sampleRate
          tick = (tick + 1) % totalTicks(p)
        }
      }
      // 활성 클릭 렌더 (삼각파 × 지수 감쇠, 50 ms)
      for (let k = active.length - 1; k >= 0; k--) {
        const c = active[k]!
        const from = Math.max(0, c.startSample - blockStart)
        for (let i = from; i < n; i++) {
          const s = blockStart + i - c.startSample
          if (s >= clickLen) { active.splice(k, 1); break }
          // 지수 감쇠(피크 → 피크×CLICK_FLOOR) × 꼬리 페이드
          const fade = s > clickLen - fadeLen ? (clickLen - s) / fadeLen : 1
          const env = c.vol * Math.pow(CLICK_FLOOR, s / clickLen) * fade
          c.phase += c.freq / sampleRate; if (c.phase >= 1) c.phase -= 1
          const tri = 4 * Math.abs(c.phase - 0.5) - 1 // 삼각파 −1..1
          let v = tri * env
          if (s === 0) v += ATTACK_IMPULSE * c.vol // 결정적 어택 (온셋 시각 고정)
          else if (s < noiseLen) { // 어택 트랜지언트 (결정적 LCG + 1차 차분 = 고역 강조)
            c.seed = (c.seed * 1664525 + 1013904223) >>> 0
            const wn = (c.seed / 0x100000000) * 2 - 1
            const hp = wn - c.prev; c.prev = wn
            v += hp * 0.5 * c.vol * NOISE_AMP * (1 - s / noiseLen)
          }
          out[i] = out[i]! + v
        }
      }
      return events
    },
  }
}
