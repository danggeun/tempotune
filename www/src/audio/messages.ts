/** 메인 ↔ 워커 ↔ 워클릿 메시지 타입 (단일 정의) */
import type { Frame, AnalyzerSettings } from '../core/pitch/analyzer.ts'

/** 워클릿 → 워커: 캡처 청크 */
export interface ChunkMsg { type: 'chunk'; chunk: Float32Array; /** 청크 끝의 AudioContext 시간(초) */ t: number }
/** 워커 → 워클릿: 다 쓴 버퍼 반납 (오디오 스레드의 할당/GC 를 피한다) */
export interface RecycleMsg { type: 'recycle'; buf: ArrayBuffer }
/** 메인 → 워클릿: 워커로 가는 포트 전달 */
export interface PortMsg { type: 'port'; port: MessagePort }

/** 메인 → 워커 */
export type WorkerIn =
  | { type: 'init'; sampleRate: number; port: MessagePort; settings: AnalyzerSettings }
  | { type: 'settings'; settings: Partial<AnalyzerSettings> }
  /** 링버퍼 리셋 + afterT(초) 이전에 캡처된 청크는 버림 (백그라운드 복귀 시 밀린 청크 폭주 방지) */
  | { type: 'reset'; afterT: number }
  /** 이 구간(초, AudioContext 시계)에 걸치는 프레임은 버림 — 메트로놈 클릭이 마이크로 누설되는 구간 */
  | { type: 'mute'; from: number; until: number }

/** 워커 → 메인 */
export type WorkerOut =
  | { type: 'frame'; frame: Frame; /** 창 끝 시각(초) */ t: number; /** 처리 시간 ms */ ms: number; /** 직전에 백프레셔로 건너뛴 프레임 수 */ skipped: number }
  | { type: 'ready' }
