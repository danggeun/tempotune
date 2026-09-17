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
export type TimeSig = 1 | 2 | 3 | 4 | 6 // 1 = 박자표 없음(정박만) — K3

export interface Pattern { bpm: number; timeSig: TimeSig; subDiv: SubDiv; volume: number; muted: boolean }

export interface ClickEvent { tick: number; sample: number; kind: 'accent' | 'beat' | 'sub' }

export const CLICK_DUR_S = 0.05

export function totalTicks(p: Pick<Pattern, 'timeSig' | 'subDiv'>): number { return p.subDiv === 'd' ? p.timeSig * 2 : p.timeSig * p.subDiv }
export function tickKind(p: Pick<Pattern, 'subDiv' | 'timeSig'>, tick: number): ClickEvent['kind'] {
  // 정박만 (K3): 마디가 없으므로 첫 박 강세도 없다 — 완전히 균일한 딱딱딱딱.
  // 분할은 그대로 약하게 둔다(분할까지 같은 세기면 무엇이 박인지 사라진다).
  if (p.timeSig === 1) return p.subDiv === 'd' ? (tick % 2 === 0 ? 'beat' : 'sub') : (tick % p.subDiv === 0 ? 'beat' : 'sub')
  if (tick === 0) return 'accent'
  if (p.timeSig === 6) return tick === 3 ? 'beat' : 'sub' // 6/8: 둘째 큰 박(4번째 8분음표)에 중간 액센트 (리뷰: 음악적 정확성)
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
/**
 * 클릭 피크 (슬라이더 최대에서의 값). 음악적 위계는 v1 그대로 유지한다 — 0 / −4.4 / −10.5 dB.
 * (v1 은 슬라이더 최대에서 `min(1, VOL×1.43)` 이라 강박이 1.0 에 **클립**되고 0.60 / 0.257 이었다.
 *  즉 피크 천장은 이미 다 쓰고 있었다 → 코드로 얻을 수 있는 것은 피크가 아니라 **에너지와 스펙트럼**이다.)
 */
const VOL = { accent: 1.0, beat: .60, sub: .30 } as const
/**
 * 감쇠 바닥(피크 대비). v1 은 절대 0.001 이라 시간상수가 τ = 50 ms / ln(vol/0.001) ≈ **8.3 ms** —
 * 피크만 스치고 사라져서 폰 스피커에서 유난히 작게 들렸다. 상대 2 % 로 바꾸면 τ = 50 / ln(50) = **12.8 ms**,
 * 피크를 한 톨도 올리지 않고 클릭 에너지가 **+1.9 dB**. 세기별로 τ 가 달라지던 것도 같이 없어진다.
 */
const CLICK_FLOOR = 0.02
/** 꼬리를 0 으로 매끄럽게 — 2 % 에서 뚝 끊으면 그 자체가 작은 '툭' 소리가 된다 */
const CLICK_FADE_S = 0.003
/**
 * 어택에 얹는 짧은 고역 트랜지언트.
 * 왜: 폰 스피커는 저역을 거의 못 내고 1~3 kHz 이상에서 효율이 가장 높다. 750 Hz 세분음이 특히 불리했다.
 * 1.5 ms 동안 1차 차분(= 6 dB/oct 고역 강조) 잡음을 더하면 피크를 크게 올리지 않고도 '딱' 하는 존재감이 생긴다.
 * 난수는 **결정적 LCG** 로 만든다 — 벤치마크·단위테스트가 재현 가능해야 한다.
 *
 * 첫 샘플은 난수가 아니라 **고정 임펄스**다. 삼각파는 위상 0.25(영점)에서 시작하므로 클릭의 첫 샘플이 0 인데,
 * 거기에 난수를 얹으면 온셋 시각이 클릭마다 ±2 샘플 흔들려 보인다(오프라인 렌더 온셋 검출 기준). 소리로는
 * 무시할 차이지만 "박자 정확도" 검사가 그걸 지터로 읽는다 — 어택의 첫 샘플을 고정하면 온셋이 항상 예약 샘플이다.
 */
const NOISE_S = 0.0015, NOISE_AMP = 0.5, ATTACK_IMPULSE = 0.6

export interface Sequencer {
  /** 패턴 교체. BPM 이 바뀌면 이미 예약된 다음 클릭도 새 간격으로 다시 잡는다(마지막 클릭 기준) — 느린 템포에서 한 박을 통째로 기다리지 않게 */
  setPattern(p: Partial<Pattern>): void
  /** 마디를 처음부터 — 다음 예약된 클릭을 유지한 채 그 클릭을 1박으로 (박자/세분 변경용, 더블클릭 없음) */
  resetBar(): void
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
          // 슬라이더는 0..1 을 피크 0..VOL 로 선형 매핑한다. v1 의 `min(1, VOL×(v/0.7))` 은 최대에서 강박을
          // 클립시키면서도 세분음은 −12 dB 에 두는 어정쩡한 지점이었다 — 위계는 VOL 이 이미 갖고 있으므로 그대로 곱한다.
          const vol = VOL[kind] * p.volume
          // phase 0.25 = 삼각파 영점에서 시작 (0 이면 +1 스텝 트랜지언트 — 거칠고 마이크 누설도 큼). vol≈0 은 렌더 생략 (0·∞ = NaN 방지)
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
