/**
 * 메트로놈 시퀀서 — 샘플 단위로 클릭 위치를 정하고 클릭 파형을 버퍼에 렌더한다. 순수 (워클릿·테스트 공용).
 *
 * 왜 워클릿 안에서 생성하나(설계서 §B6): 메인 스레드 setTimeout 스케줄러는 화면이 꺼지거나 백그라운드로 가면
 * 스로틀되지만, 오디오 스레드는 그렇지 않다. 그리고 클릭이 정확히 언제 나는지 샘플 단위로 알 수 있어
 * 튜너 뮤트 구간을 정확히 정할 수 있다.
 *
 * 패턴(v1 유지): 6/8 은 8분음표 6개(강·약·약·중·약·약이 아니라 v1 처럼 첫 박만 강), 세분 1/2/3, 붓점('d')은 3:1.
 * 클릭음: 강박 1800 Hz / 박 1100 Hz / 세분 750 Hz 삼각파, 50 ms 지수 감쇠 (v1 과 같은 음색).
 */
export type SubDiv = 1 | 2 | 3 | 'd'
export type TimeSig = 2 | 3 | 4 | 6

export interface Pattern { bpm: number; timeSig: TimeSig; subDiv: SubDiv; volume: number; muted: boolean }

export interface ClickEvent { tick: number; sample: number; kind: 'accent' | 'beat' | 'sub' }

export const CLICK_DUR_S = 0.05

export function totalTicks(p: Pick<Pattern, 'timeSig' | 'subDiv'>): number { return p.subDiv === 'd' ? p.timeSig * 2 : p.timeSig * p.subDiv }
export function tickKind(p: Pick<Pattern, 'subDiv'>, tick: number): ClickEvent['kind'] {
  if (tick === 0) return 'accent'
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
const VOL = { accent: .75, beat: .42, sub: .18 } as const

export interface Sequencer {
  /** 패턴 교체 — 다음 틱부터 반영 (재시작 없음) */
  setPattern(p: Partial<Pattern>): void
  getPattern(): Pattern
  /** 재생 시작: 첫 틱을 startOffsetSamples 뒤에 */
  start(startOffsetSamples?: number): void
  stop(): void
  readonly running: boolean
  /**
   * out 에 클릭을 (덧셈으로) 렌더. 이 블록에서 시작하는 클릭 이벤트를 반환한다.
   * @param blockStartSample 이 블록의 첫 샘플의 절대 샘플 번호
   */
  render(out: Float32Array, blockStartSample: number): ClickEvent[]
}

export function createSequencer(sampleRate: number, initial: Pattern): Sequencer {
  const p: Pattern = { ...initial }
  let running = false
  let nextClickSample = 0 // 다음 클릭의 절대 샘플 위치 (소수 허용 — 누적 오차 없음)
  let tick = 0
  const active: Array<{ startSample: number; phase: number; freq: number; vol: number }> = []
  const clickLen = Math.round(CLICK_DUR_S * sampleRate)

  return {
    get running() { return running },
    getPattern: () => ({ ...p }),
    setPattern(patch) { Object.assign(p, patch) },
    start(startOffsetSamples = 0) { running = true; tick = 0; nextClickSample = -1 - startOffsetSamples; active.length = 0 }, // -1: 첫 render 에서 blockStart 기준으로 잡음
    stop() { running = false; active.length = 0 },
    render(out, blockStart) {
      const n = out.length, events: ClickEvent[] = []
      if (running) {
        if (nextClickSample < 0) nextClickSample = blockStart + (-1 - nextClickSample) // start(offset) 보정
        // 이 블록 안에서 시작하는 클릭들을 등록
        while (nextClickSample < blockStart + n) {
          const kind = tickKind(p, tick)
          const startSample = Math.round(nextClickSample)
          events.push({ tick, sample: startSample, kind })
          if (!p.muted) active.push({ startSample, phase: 0, freq: FREQ[kind], vol: Math.min(1, VOL[kind] * (p.volume / .7)) })
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
          // v1: setValueAtTime(vol) → exponentialRamp(.001) 를 그대로: vol · (0.001/vol)^(s/len)
          const env = c.vol * Math.pow(0.001 / c.vol, s / clickLen)
          c.phase += c.freq / sampleRate; if (c.phase >= 1) c.phase -= 1
          const tri = 4 * Math.abs(c.phase - 0.5) - 1 // 삼각파 −1..1
          out[i] = out[i]! + tri * env
        }
      }
      return events
    },
  }
}
