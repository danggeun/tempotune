/**
 * 녹음 영속화 (IndexedDB). recordings = 큰 blob(거의 안 바뀜), meta = 편집 상태(자주 바뀜, blob 을 다시 쓰지 않게 분리), chunks = 녹음 중 조각.
 */
export const REC_DB = 'tempotune_rec', REC_STORE = 'recordings', META_STORE = 'meta', CHUNK_STORE = 'chunks'
export const LEGACY_REC_DB = 'gopractice_rec' // 이름 변경 전 DB — persist/legacy.ts 가 지운다
export const REC_DB_VERSION = 4 // v3: meta 분리, v4: chunks
import { REC_TTL, expires } from '../core/recPolicy.ts'
import { settingsStore } from '../state/index.ts'
export { REC_TTL }

export interface AB { a: number; b: number }
export interface RecRow { id?: number; name: string; dur: number; blob: Blob; mime: string; ts: number }
/** ext·peak·speed·keep 은 나중에 추가된 필드 — 옛 행에는 없으므로 optional, 스키마 버전은 올리지 않는다 */
export interface RecMeta { id: number; name?: string; bookmarks: number[]; ab: AB | null; peaks?: Float32Array; speed?: number; ext?: 'm4a' | 'webm'; peak?: number; keep?: boolean }
export interface RecFull extends RecRow { bookmarks: number[]; ab: AB | null; peaks?: Float32Array; speed?: number; ext?: 'm4a' | 'webm'; peak?: number; keep?: boolean }

let db: IDBDatabase | null = null
let metaError: ((m: string) => void) | null = null
export function onDbError(fn: (m: string) => void): void { metaError = fn }
const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

export function openRecDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(REC_DB, REC_DB_VERSION)
    r.onupgradeneeded = e => {
      const d = (e.target as IDBOpenDBRequest).result, tx = (e.target as IDBOpenDBRequest).transaction!
      const recs = d.objectStoreNames.contains(REC_STORE) ? tx.objectStore(REC_STORE) : d.createObjectStore(REC_STORE, { keyPath: 'id', autoIncrement: true })
      const meta = d.objectStoreNames.contains(META_STORE) ? tx.objectStore(META_STORE) : d.createObjectStore(META_STORE, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(CHUNK_STORE)) d.createObjectStore(CHUNK_STORE, { keyPath: 'seq', autoIncrement: true }).createIndex('session', 'session')
      if (e.oldVersion < 3) { // 옛 행의 편집 필드를 meta 로 옮기고 행에서는 제거
        const cur = recs.openCursor()
        cur.onsuccess = () => {
          const c = cur.result; if (!c) return
          const row = c.value as RecRow & Partial<RecMeta>
          meta.put({ id: row.id!, bookmarks: Array.isArray(row.bookmarks) ? row.bookmarks : [], ab: row.ab ?? null, peaks: row.peaks })
          if ('bookmarks' in row || 'ab' in row || 'peaks' in row) { delete row.bookmarks; delete row.ab; delete row.peaks; c.update(row) }
          c.continue()
        }
      }
    }
    r.onsuccess = e => {
      const d = (e.target as IDBOpenDBRequest).result
      d.onversionchange = () => { d.close(); if (db === d) db = null } // 다른 탭의 업그레이드가 blocked 되지 않게
      db = d; res(d)
    }
    r.onerror = () => rej(r.error)
    r.onblocked = () => console.warn('recordings db: blocked by another tab — waiting') // reject 하지 않는다 — 요청은 살아 있어 나중에 success/error 가 온다
  })
}
const store = (name: string, mode: IDBTransactionMode) => db!.transaction(name, mode).objectStore(name)

export async function dbSave(row: RecRow, meta: Omit<RecMeta, 'id'>): Promise<number | null> {
  if (!db) return null
  const id = (await req(store(REC_STORE, 'readwrite').add(row))) as number
  await req(store(META_STORE, 'readwrite').put({ id, ...meta })).catch(() => { metaError?.('편집 정보를 저장하지 못했어요') })
  return id
}
/** 두 스토어에서 지우고 결과를 기다린다 — 실패를 모르면 다음 로드에서 되살아난다 */
export async function dbDelete(id: number | null | undefined): Promise<boolean> {
  if (!db || id == null) return false
  try {
    await req(store(REC_STORE, 'readwrite').delete(id))
    await req(store(META_STORE, 'readwrite').delete(id))
    return true
  } catch { return false }
}
/** 편집 상태/이름만 갱신 — blob 은 건드리지 않는다 */
export async function dbPatchMeta(id: number | null | undefined, patch: Partial<Omit<RecMeta, 'id'>>): Promise<void> {
  if (!db || id == null) return
  try {
    const s = store(META_STORE, 'readwrite'); const cur = ((await req(s.get(id))) as RecMeta | undefined) ?? { id, bookmarks: [], ab: null }
    await req(s.put({ ...cur, ...patch, id }))
  } catch { metaError?.('편집 정보를 저장하지 못했어요') }
}
/** 전체 로드 (최신순). TTL 지난 항목은 삭제 후 제외. */
export async function dbLoadAll(): Promise<RecFull[]> {
  if (!db) return []
  const rows = (await req(store(REC_STORE, 'readonly').getAll())) as RecRow[]
  const metas = new Map(((await req(store(META_STORE, 'readonly').getAll())) as RecMeta[]).map(m => [m.id, m]))
  const now = Date.now(), keep: RecFull[] = []
  const autoDelete = settingsStore.get().autoDelete
  for (const r of rows.sort((a, b) => (b.ts || 0) - (a.ts || 0))) {
    const m = metas.get(r.id!)
    // 삭제 판정은 core/recPolicy 의 expires 하나로 — 목록의 예고문도 같은 함수를 본다
    if (expires(r.ts, m?.keep, autoDelete, now)) { void dbDelete(r.id); continue }
    keep.push({ ...r, name: m?.name ?? r.name, bookmarks: m?.bookmarks ?? [], ab: m?.ab ?? null, peaks: m?.peaks, speed: m?.speed, ext: m?.ext, peak: m?.peak, keep: m?.keep })
  }
  return keep
}

// 녹음 중 조각
export interface ChunkRow { seq?: number; session: number; t: number; mime: string; blob: Blob }
export async function dbChunkAdd(row: ChunkRow): Promise<void> {
  if (!db) return
  try { await req(store(CHUNK_STORE, 'readwrite').add(row)) } catch { /* 용량 부족 — 메모리의 조각으로 stop 때 저장된다 */ }
}
export async function dbChunksClear(session: number): Promise<void> {
  if (!db) return
  try {
    const s = store(CHUNK_STORE, 'readwrite'), keys = (await req(s.index('session').getAllKeys(session))) as IDBValidKey[]
    for (const k of keys) await req(s.delete(k))
  } catch { /* 다음 실행의 복구가 중복 항목을 만들 수 있다 — 그쪽에서 걸러낸다 */ }
}
/** 세션별 조각 (seq 순). 비어 있으면 빈 Map */
export async function dbChunksLoad(): Promise<Map<number, ChunkRow[]>> {
  const out = new Map<number, ChunkRow[]>()
  if (!db) return out
  const rows = (await req(store(CHUNK_STORE, 'readonly').getAll())) as ChunkRow[]
  for (const r of rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) { const g = out.get(r.session); if (g) g.push(r); else out.set(r.session, [r]) }
  return out
}
