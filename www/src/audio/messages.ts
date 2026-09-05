/** 메인 ↔ 워커 ↔ 워클릿 메시지 타입 (단일 정의) */
import type { Frame, AnalyzerSettings } from '../core/pitch/analyzer.ts'

/** 워클릿 → 워커: 캡처 청크 */
export interface ChunkMsg { type: 'chunk'; chunk: Float32Array; /** 청크 끝의 AudioContext 시간(초) */ t: number }
/** 메인 → 워클릿: 워커로 가는 포트 전달 */
export interface PortMsg { type: 'port'; port: MessagePort }

/** 메인 → 워커 */
export type WorkerIn =
  | { type: 'init'; sampleRate: number; port: MessagePort; settings: AnalyzerSettings }
  | { type: 'settings'; settings: Partial<AnalyzerSettings> }
  | { type: 'reset' }
  /** 이 시각(초) 전까지의 프레임은 무시 (메트로놈 클릭 누설 — Phase 3 에서 사용) */
  | { type: 'muteUntil'; t: number }

/** 워커 → 메인 */
export type WorkerOut =
  | { type: 'frame'; frame: Frame; /** 창 끝 시각(초) */ t: number; /** 처리 시간 ms */ ms: number }
  | { type: 'ready' }
