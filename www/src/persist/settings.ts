/** 설정 영속화 (localStorage). 스키마 v2 + v1 마이그레이션 */
import { settingsStore, RMS_LEVELS, V1_RMS_LEVELS, V201_RMS_LEVELS, SMOOTH_LEVELS, CFG, type Settings, type SubDiv, type TimeSig } from '../state/index.ts'
import { t } from '../core/i18n/index.ts'

export const SETTINGS_KEY = 'intonome_settings_v1'
export const LEGACY_SETTINGS_KEYS = ['gopractice_settings_v1', 'gp_mic_intro', 'tempotune_settings_v1', 'tempotune_legacy_cleared_v1'] // 옛 이름(Go practice · TempoTune) 키 — persist/legacy.ts 가 지운다

type StoredV2 = { v: 2 } & Settings
interface StoredV1 { cents?: number; rms?: number; smooth?: number; wakelock?: boolean; bpm?: number; timeSig?: number; subDiv?: number | string; refHz?: number; vol?: number; savedAt?: number }

/** 저장된 감도 값 → 현재 단계 값. 숫자가 아니라 단계(인덱스)를 옮긴다. 표는 저장 키로 고른다 — v1 rms 와 v2 rmsMin 은 값 범위가 겹친다 */
function rmsStep(v: unknown, tables: ReadonlyArray<ReadonlyArray<number>>): number | null {
  if (typeof v !== 'number' || !isFinite(v)) return null
  for (const table of tables) {
    const i = table.findIndex(x => Math.abs(x - v) < x * 0.05) // 그 표의 값과 5 % 안에서 일치
    if (i >= 0) return RMS_LEVELS[i]!
  }
  return null
}
/** v2 키(`rmsMin`): 현재 값 또는 v2.0.0~2.0.1 값 */
const V2_TABLES = [RMS_LEVELS, V201_RMS_LEVELS]
/** v1 키(`rms`): v1 값만 */
const V1_TABLES = [V1_RMS_LEVELS]
function isTimeSig(v: unknown): v is TimeSig { return v === 1 || v === 2 || v === 3 || v === 4 || v === 6 } // 1 = 정박 모드 — 빠지면 새로고침에 풀린다
function isSubDiv(v: unknown): v is SubDiv { return v === 1 || v === 2 || v === 3 || v === 4 || v === 'd' }
const clampBpm = (v: number) => Math.max(CFG.metro.bpmMin, Math.min(CFG.metro.bpmMax, Math.round(v))) // 음수 BPM 은 스케줄러 무한루프

/** 저장된 값 → Settings 부분 객체. 알 수 없는/깨진 값은 무시(기본값 유지). */
export function parseStored(raw: string | null): Partial<Settings> {
  if (!raw) return {}
  let d: unknown
  try { d = JSON.parse(raw) } catch { return {} }
  if (!d || typeof d !== 'object') return {}
  const out: Partial<Settings> = {}
  // 값 범위도 검증한다 — 손상된 저장값(refHz 1000 등)이 분석기 전체를 틀리게 하지 않게
  const num = (v: unknown, lo: number, hi: number): number | null => typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null
  const tol = (v: unknown): number | null => (typeof v === 'number' && [5, 10, 15, 20, 25].includes(v)) ? v : null
  if ((d as StoredV2).v === 2) {
    const s = d as Partial<StoredV2>
    { const v = tol(s.tolCents); if (v !== null) out.tolCents = v }
      { const v = rmsStep(s.rmsMin, V2_TABLES); if (v !== null) out.rmsMin = v }
    if (typeof s.smoothing === 'number' && SMOOTH_LEVELS.some(v => Math.abs(v - s.smoothing!) < .001)) out.smoothing = s.smoothing
    if (typeof s.wakeLock === 'boolean') out.wakeLock = s.wakeLock
    if (typeof s.bpm === 'number' && isFinite(s.bpm)) out.bpm = clampBpm(s.bpm)
    if (isTimeSig(s.timeSig)) out.timeSig = s.timeSig
    if (isSubDiv(s.subDiv)) out.subDiv = s.subDiv
    { const v = num(s.refHz, CFG.ref.min, CFG.ref.max); if (v !== null) out.refHz = Math.round(v) }
    { const v = num(s.metroVol, 0, 1); if (v !== null) out.metroVol = v }
    if (s.noteNames === 'ko' || s.noteNames === 'en') out.noteNames = s.noteNames
    if (typeof s.autoDelete === 'boolean') out.autoDelete = s.autoDelete
    if (s.theme === 'dark' || s.theme === 'light') out.theme = s.theme
    if (s.lang === 'ko' || s.lang === 'en') out.lang = s.lang
    if (s.aOctave === 2 || s.aOctave === 3 || s.aOctave === 4) out.aOctave = s.aOctave
    if (out.timeSig === 6) out.subDiv = 1 // 6/8 은 세분 없음 — 따로 저장된 옛 값이 시퀀서·스윕을 어긋나게 한다
    return out
  }
  // v1 스키마
  const s = d as StoredV1
  { const v = tol(s.cents); if (v !== null) out.tolCents = v }
  { const v = rmsStep(s.rms, V1_TABLES); if (v !== null) out.rmsMin = v }
  if (s.smooth) { const V1_SMOOTH = [.05, .10, .15]; const i = V1_SMOOTH.findIndex(v => Math.abs(v - s.smooth!) < .001); if (i >= 0) out.smoothing = SMOOTH_LEVELS[i]! }
  if (s.wakelock != null) out.wakeLock = !!s.wakelock
  if (typeof s.bpm === 'number' && isFinite(s.bpm)) out.bpm = clampBpm(s.bpm)
  if (isTimeSig(s.timeSig)) out.timeSig = s.timeSig
  if (isSubDiv(s.subDiv)) out.subDiv = s.subDiv
  { const v = num(s.refHz, CFG.ref.min, CFG.ref.max); if (v !== null) out.refHz = Math.round(v) }
  { const v = num(s.vol, 0, 1); if (v !== null) out.metroVol = v }
  if (out.timeSig === 6) out.subDiv = 1
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
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(d)) } catch { if (!warned) { warned = true; persistError?.(t('set.saveFailed')) } }
}
export function startSettingsAutosave(): void {
  settingsStore.subscribe(() => { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(writeNow, 300) }) // BPM 드래그 중 연속 쓰기 방지
  // 앱이 300 ms 안에 닫히면(안드로이드 뒤로가기 등) 마지막 변경이 유실되므로 숨김/종료 시 즉시 기록
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) writeNow() })
  window.addEventListener('pagehide', () => { if (saveTimer) writeNow() })
}
