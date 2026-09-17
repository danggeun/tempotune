/**
 * v2.1.0 이름 변경(Go practice → TempoTune)으로 버려진 저장소를 한 번 지운다.
 *
 * 왜 지우나: 키 이름이 바뀌었으므로 옛 데이터는 앱에서 **읽을 수도 지울 수도 없는** 상태가 된다.
 * 그냥 두면 사용자 기기에 수 MB 짜리 IndexedDB 가 영원히 남아 저장 용량을 먹고,
 * 브라우저 quota 압박이 오면 **새 녹음이 먼저 밀려나는** 일까지 생긴다. 버리고 갈 거면 치우고 간다.
 *
 * 실패해도 앱은 계속 진행한다 — 청소가 안 됐다고 튜너를 못 쓸 이유가 없다.
 * 한 번 돌고 나면 표식을 남겨 다시 돌지 않는다(매 실행 IndexedDB 를 여는 비용을 피한다).
 */
import { LEGACY_REC_DB } from './recordingsDb.ts'
import { LEGACY_SETTINGS_KEYS } from './settings.ts'

const DONE_KEY = 'tempotune_legacy_cleared_v1'

export function clearLegacyStorage(): void {
  try { if (localStorage.getItem(DONE_KEY)) return } catch { return } // 저장소 자체를 못 쓰면 할 일도 없다
  for (const k of LEGACY_SETTINGS_KEYS) { try { localStorage.removeItem(k) } catch { /* */ } }
  try { indexedDB.deleteDatabase(LEGACY_REC_DB) } catch { /* */ }
  try { localStorage.setItem(DONE_KEY, '1') } catch { /* */ }
}
