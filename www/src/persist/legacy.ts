/**
 * 옛 이름(Go practice · TempoTune)의 저장소를 한 번 지운다 — 남겨두면 quota 압박 시 새 녹음이 먼저 밀려난다.
 * 실패해도 앱은 계속 진행. 완료 표식을 남겨 다시 돌지 않는다.
 */
import { LEGACY_REC_DBS } from './recordingsDb.ts'
import { LEGACY_SETTINGS_KEYS } from './settings.ts'

const DONE_KEY = 'intonome_legacy_cleared_v1' // 이름이 바뀔 때마다 새 표식 — 늘어난 목록으로 한 번 더 돈다

export function clearLegacyStorage(): void {
  try { if (localStorage.getItem(DONE_KEY)) return } catch { return } // 저장소 자체를 못 쓰면 할 일도 없다
  for (const k of LEGACY_SETTINGS_KEYS) { try { localStorage.removeItem(k) } catch { /* */ } }
  for (const db of LEGACY_REC_DBS) { try { indexedDB.deleteDatabase(db) } catch { /* */ } }
  try { localStorage.setItem(DONE_KEY, '1') } catch { /* */ }
}
