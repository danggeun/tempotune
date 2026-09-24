/** 앱 상태의 유일한 원천 — 타입과 스토어 인스턴스 */
import { createStore } from './store.ts'

// 고정 상수 (사용자 설정 아님)
export const CFG = {
  /** 트레이스 창은 초 단위 — 프레임 수로 두면 기기 샘플레이트(sr/1024 프레임률)마다 길이가 달라진다 */
  tuner: { histSec: 4.0, hop: 1024 },
  metro: { bpmMin: 40, bpmMax: 200, swipePxPerBpm: 2 },
  /** 무활동 자동 종료 (마이크 켜진 채 소리 없음) */
  inactiveMs: 15 * 60 * 1000,
  ref: { min: 410, max: 466, default: 442 },
} as const

/** 마이크 감도 3단계 (낮음 / 보통 / 높음) RMS 문턱 — 잡음 거름은 뒤의 주기성·배음 검사가 하므로 낮아도 오검출은 없다 */
export const RMS_LEVELS = [.010, .005, .002] as const
/** v1 이 저장했던 값. 같은 단계끼리 인덱스로 대응시킨다 */
export const V1_RMS_LEVELS = [.015, .010, .005] as const
/** v2.0.0~2.0.1 이 저장했던 값. 사용자가 고른 단계를 유지하도록 인덱스로 옮긴다 */
export const V201_RMS_LEVELS = [.024, .014, .008] as const
/** 표시 평활 계수 — 분석 프레임(≈43 Hz) 기준 */
export const SMOOTH_LEVELS = [.06, .12, .20] as const

export type SubDiv = 1 | 2 | 3 | 4 | 'd' // 4 = 16분음표
export type TimeSig = 1 | 2 | 3 | 4 | 6 // 1 = 박자표 없음(정박만)

// 사용자 설정 (영속)
export interface Settings {
  tolCents: number
  rmsMin: number
  smoothing: number
  wakeLock: boolean
  bpm: number
  timeSig: TimeSig
  subDiv: SubDiv
  refHz: number
  metroVol: number
  /** 음이름 표기: 도레미(기본) / CDE */
  noteNames: 'ko' | 'en'
  /** 녹음 자동 삭제(30일) 켜짐 — 끄면 계속 보관 */
  autoDelete: boolean
  theme: 'dark' | 'light'
}
export const settingsStore = createStore<Settings>({
  tolCents: 15, rmsMin: RMS_LEVELS[1], smoothing: SMOOTH_LEVELS[1], wakeLock: true,
  // metroVol 기본 1.0 — 슬라이더는 줄이는 용도. 이미 저장된 값이 있으면 그 값 유지
  bpm: 80, timeSig: 4, subDiv: 1, refHz: CFG.ref.default, metroVol: 1.0, noteNames: 'ko', autoDelete: true, theme: 'dark',
})

// 튜너 (고빈도)
export interface TunerState {
  micReady: boolean
  /** 앱이 스스로 마이크를 놓았다가 다시 여는 중 (숨김·편집기·전용 모드 복귀) — 이 동안은 "켜면 시작" 을 띄우지 않는다 */
  micReopening: boolean
  /** 마이크 분석 루프 동작 중 */
  running: boolean
  /** 매 분석 프레임 증가 — 값이 같아도 구독자가 매 프레임 알림을 받게 함 (히스토리 스크롤) */
  frame: number
  /** 표시 주파수(스무딩 후). -1이면 음 없음 */
  hz: number
  midi: number
  cents: number
  inTune: boolean
  /** 추정 신뢰도 0..1 (YIN 주기성) */
  conf: number
  /** 트래커가 직전 값을 유지한 횟수 (0 = 새 측정). 트레이스는 유지 프레임을 쌓지 않는다 */
  held: number
  /** 중음(더블스톱)일 때 아래 성부의 음이름·cents. 중음이 아니면 -1 / 0 */
  dualMidi: number
  dualCents: number
  /** 열린 오디오 컨텍스트의 샘플레이트 — 트레이스 창을 초 단위로 유지하려면 UI 가 프레임률을 알아야 한다 */
  sampleRate: number
  /** 연주 감지 */
  playing: boolean
  lastActivityMs: number
}
export const tunerStore = createStore<TunerState>({
  micReady: false, micReopening: false, running: false, frame: 0, hz: -1, midi: -1, cents: 0, inTune: false, conf: 0, held: 0, dualMidi: -1, dualCents: 0, sampleRate: 44100, playing: false, lastActivityMs: Date.now(),
})

// 메트로놈
export interface MetroState {
  playing: boolean
  /** 폰 레이아웃에서 본체 접힘 */
  collapsed: boolean
  full: boolean // 메트로놈 전용 모드 — 튜너를 숨기고 화면을 다 쓴다
  /** 마지막으로 울린 틱 (시각 피드백용). {n} 카운터로 같은 틱도 재알림 */
  lastTick: { tick: number; n: number }
}
export const metroStore = createStore<MetroState>({ playing: false, collapsed: true, full: false, lastTick: { tick: -1, n: 0 } })

// 기준음
export interface RefToneState { octave: number; active: string | null }
export const refToneStore = createStore<RefToneState>({ octave: 4, active: null })

// 세션 (타이머 / 녹음)
export interface SessionState {
  timerRunning: boolean
  elapsedSec: number
  detectedSec: number
  recording: boolean
  recElapsedSec: number
}
export const sessionStore = createStore<SessionState>({ timerRunning: false, elapsedSec: 0, detectedSec: 0, recording: false, recElapsedSec: 0 })

// 녹음 목록
export interface RecItem {
  id: number | null
  name: string
  /** 초 */
  dur: number
  blob: Blob
  mime: string
  /** 실제 컨테이너 (파일 내용으로 판정). 옛 행에는 없으므로 mime 폴백 */
  ext?: 'm4a' | 'webm'
  /** 녹음 중 잰 원시 절대 피크 0..1 — 재생 보정 게인의 근거. 옛 행에는 없다 */
  peak?: number
  ts: number
  url: string
  bookmarks: number[]
  ab: { a: number; b: number } | null
  peaks?: Float32Array
  /** 마지막 재생 속도 (편집기, 녹음별 기억) */
  speed?: number
  /** 개별 보관 — 자동 삭제에서 면제. 옛 행에는 없다 = 보관 아님 */
  keep?: boolean
}
export interface RecListState { items: RecItem[]; rev: number }
export const recListStore = createStore<RecListState>({ items: [], rev: 0 })
