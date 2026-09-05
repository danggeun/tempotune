/**
 * 앱 상태의 유일한 원천. 타입과 스토어 인스턴스를 여기서 정의한다.
 * v1의 전역 객체 S / A / CFG 를 도메인별 스토어로 나눈 것. 값과 기본값은 v1과 동일.
 */
import { createStore } from './store.ts'

// ── 고정 상수 (사용자 설정 아님) ──
export const CFG = {
  tuner: { histLen: 360 },
  metro: { bpmMin: 20, bpmMax: 220, swipePxPerBpm: 2 },
  /** 무활동 자동 종료 (마이크 켜진 채 소리 없음) */
  inactiveMs: 15 * 60 * 1000,
  ref: { min: 410, max: 466, default: 442 },
} as const

/** 설정 화면의 3단계 값 매핑 (v1 RMS_LEVELS / SMOOTH_LEVELS) */
export const RMS_LEVELS = [.024, .014, .008] as const
/** 표시 평활 계수 — 분석 프레임(≈43 Hz) 기준. v1(.05/.10/.15 @ 60 Hz·4프레임 스킵)과 시간상수가 같도록 환산 */
export const SMOOTH_LEVELS = [.06, .12, .20] as const

export type SubDiv = 1 | 2 | 3 | 'd'
export type TimeSig = 2 | 3 | 4 | 6

// ── 사용자 설정 (영속) ──
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
}
export const settingsStore = createStore<Settings>({
  tolCents: 15, rmsMin: RMS_LEVELS[1], smoothing: SMOOTH_LEVELS[1], wakeLock: true,
  bpm: 80, timeSig: 4, subDiv: 1, refHz: CFG.ref.default, metroVol: 0.7, noteNames: 'ko', autoDelete: true,
})

// ── 튜너 (고빈도) ──
export interface TunerState {
  micReady: boolean
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
  /** 연주 감지 */
  playing: boolean
  lastActivityMs: number
}
export const tunerStore = createStore<TunerState>({
  micReady: false, running: false, frame: 0, hz: -1, midi: -1, cents: 0, inTune: false, conf: 0, playing: false, lastActivityMs: Date.now(),
})

// ── 메트로놈 ──
export interface MetroState {
  playing: boolean
  /** 폰 레이아웃에서 본체 접힘 */
  collapsed: boolean
  /** 마지막으로 울린 틱 (시각 피드백용). {n} 카운터로 같은 틱도 재알림 */
  lastTick: { tick: number; n: number }
}
export const metroStore = createStore<MetroState>({ playing: false, collapsed: true, lastTick: { tick: -1, n: 0 } })

// ── 기준음 ──
export interface RefToneState { octave: number; active: string | null }
export const refToneStore = createStore<RefToneState>({ octave: 4, active: null })

// ── 세션 (타이머 / 녹음) ──
export interface SessionState {
  timerRunning: boolean
  elapsedSec: number
  detectedSec: number
  recording: boolean
  recElapsedSec: number
}
export const sessionStore = createStore<SessionState>({ timerRunning: false, elapsedSec: 0, detectedSec: 0, recording: false, recElapsedSec: 0 })

// ── 녹음 목록 ──
export interface RecItem {
  id: number | null
  name: string
  /** 초 */
  dur: number
  blob: Blob
  mime: string
  ts: number
  url: string
  bookmarks: number[]
  ab: { a: number; b: number } | null
  peaks?: Float32Array
  /** 마지막 재생 속도 (편집기, 녹음별 기억) */
  speed?: number
}
export interface RecListState { items: RecItem[]; rev: number }
export const recListStore = createStore<RecListState>({ items: [], rev: 0 })
