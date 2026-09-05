/**
 * 설정 영속화 (localStorage). 스키마 v2 + v1 마이그레이션.
 * 결정: v1의 7일 TTL(bpm/박자 초기화)은 근거가 없어 제거 (진행 상태 문서 결정 로그 2026-09-05).
 */
import { settingsStore, RMS_LEVELS, SMOOTH_LEVELS, CFG, type Settings, type SubDiv, type TimeSig } from '../state/index.ts'

export const SETTINGS_KEY = 'gopractice_settings_v1' // 키 이름은 유지 (기존 사용자 데이터 호환)

type StoredV2 = { v: 2 } & Settings
interface StoredV1 { cents?: number; rms?: number; smooth?: number; wakelock?: boolean; bpm?: number; timeSig?: number; subDiv?: number | string; refHz?: number; vol?: number; savedAt?: number }

function isTimeSig(v: unknown): v is TimeSig { return v === 2 || v === 3 || v === 4 || v === 6 }
function isSubDiv(v: unknown): v is SubDiv { return v === 1 || v === 2 || v === 3 || v === 'd' }
const clampBpm = (v: number) => Math.max(CFG.metro.bpmMin, Math.min(CFG.metro.bpmMax, Math.round(v))) // v1 은 setBPM 이 클램프했다; 음수 BPM 은 스케줄러 무한루프

/** 저장된 값 → Settings 부분 객체. 알 수 없는/깨진 값은 무시(기본값 유지). */
export function parseStored(raw: string | null): Partial<Settings> {
  if (!raw) return {}
  let d: unknown
  try { d = JSON.parse(raw) } catch { return {} }
  if (!d || typeof d !== 'object') return {}
  const out: Partial<Settings> = {}
  if ((d as StoredV2).v === 2) {
    const s = d as Partial<StoredV2>
    if (typeof s.tolCents === 'number') out.tolCents = s.tolCents
    if (typeof s.rmsMin === 'number') out.rmsMin = s.rmsMin
    if (typeof s.smoothing === 'number') out.smoothing = s.smoothing
    if (typeof s.wakeLock === 'boolean') out.wakeLock = s.wakeLock
    if (typeof s.bpm === 'number' && isFinite(s.bpm)) out.bpm = clampBpm(s.bpm)
    if (isTimeSig(s.timeSig)) out.timeSig = s.timeSig
    if (isSubDiv(s.subDiv)) out.subDiv = s.subDiv
    if (typeof s.refHz === 'number') out.refHz = s.refHz
    if (typeof s.metroVol === 'number') out.metroVol = s.metroVol
    return out
  }
  // v1 (main.js 시절) — 값 검증은 v1 loadSettings와 동일
  const s = d as StoredV1
  if (s.cents) out.tolCents = s.cents
  if (s.rms && RMS_LEVELS.some(v => Math.abs(v - s.rms!) < .001)) out.rmsMin = s.rms
  if (s.smooth) { const V1_SMOOTH = [.05, .10, .15]; const i = V1_SMOOTH.findIndex(v => Math.abs(v - s.smooth!) < .001); if (i >= 0) out.smoothing = SMOOTH_LEVELS[i]! }
  if (s.wakelock != null) out.wakeLock = !!s.wakelock
  if (typeof s.bpm === 'number' && isFinite(s.bpm)) out.bpm = clampBpm(s.bpm)
  if (isTimeSig(s.timeSig)) out.timeSig = s.timeSig
  if (isSubDiv(s.subDiv)) out.subDiv = s.subDiv
  if (s.refHz != null) out.refHz = s.refHz
  if (s.vol != null) out.metroVol = s.vol
  return out
}

export function loadSettings(): void {
  let raw: string | null = null
  try { raw = localStorage.getItem(SETTINGS_KEY) } catch { /* 사파리 프라이빗 등 */ }
  settingsStore.set(parseStored(raw))
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let warned = false, persistError: ((m: string) => void) | null = null
export function onPersistError(fn: (m: string) => void): void { persistError = fn }
function writeNow(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  const d: StoredV2 = { v: 2, ...settingsStore.get() }
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(d)) } catch { if (!warned) { warned = true; persistError?.('설정을 저장할 수 없어요 — 저장 공간이 없거나 프라이빗 모드예요') } }
}
export function startSettingsAutosave(): void {
  settingsStore.subscribe(() => { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(writeNow, 300) }) // BPM 드래그 중 연속 쓰기 방지
  // 앱이 300 ms 안에 닫히면(안드로이드 뒤로가기 등) 마지막 변경이 유실되므로 숨김/종료 시 즉시 기록
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) writeNow() })
  window.addEventListener('pagehide', () => { if (saveTimer) writeNow() })
}
