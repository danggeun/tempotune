/**
 * 녹음 영속화 (IndexedDB). 스키마 v3:
 *   recordings: {id, name, dur, blob, mime, ts}            — 큰 blob, 거의 안 바뀜
 *   meta:       {id, name?, bookmarks, ab, peaks, speed?}          — 편집 상태, 자주 바뀜 (blob 을 다시 쓰지 않게 분리)
 * v1(필드 없음) → v2(같은 행에 bookmarks/ab) → v3(meta 분리) 마이그레이션.
 */
export const REC_DB = 'gopractice_rec', REC_STORE = 'recordings', META_STORE = 'meta'
export const REC_DB_VERSION = 3
import { REC_TTL, expires } from '../core/recPolicy.ts'
import { settingsStore } from '../state/index.ts'
export { REC_TTL }

export interface AB { a: number; b: number }
export interface RecRow { id?: number; name: string; dur: number; blob: Blob; mime: string; ts: number }
/** ext·peak 은 v2.0.2 에서 추가 (B13 확장자 오판 / B12c 재생 게인). 옛 행에는 없으므로 전부 optional — 스키마 버전은 올리지 않는다 */
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
      if (e.oldVersion < 3) { // v1/v2 행의 편집 필드를 meta 로 옮기고 행에서는 제거
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
      d.onversionchange = () => { d.close(); if (db === d) db = null } // 다른 탭이 업그레이드하면 놓아준다 (blocked 방지)
      db = d; res(d)
    }
    r.onerror = () => rej(r.error)
    r.onblocked = () => console.warn('recordings db: blocked by another tab — waiting') // 요청은 살아 있어 나중에 success/error 가 온다. reject 하면 '열 수 없음' 토스트가 뜨는데 실제로는 열린다 (리뷰)
  })
}
const store = (name: string, mode: IDBTransactionMode) => db!.transaction(name, mode).objectStore(name)

export async function dbSave(row: RecRow, meta: Omit<RecMeta, 'id'>): Promise<number | null> {
  if (!db) return null
  const id = (await req(store(REC_STORE, 'readwrite').add(row))) as number
  await req(store(META_STORE, 'readwrite').put({ id, ...meta })).catch(() => { metaError?.('편집 정보를 저장하지 못했어요') })
  return id
}
/** 두 스토어에서 지우고 **결과를 기다린다** — 실패를 모른 채 목록에서만 지우면 다음 로드에서 되살아난다 (D5) */
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
    // 삭제 판정은 core/recPolicy 의 expires 하나로 — 목록의 예고문(itemMeta)도 같은 함수를 본다
    if (expires(r.ts, m?.keep, autoDelete, now)) { void dbDelete(r.id); continue }
    keep.push({ ...r, name: m?.name ?? r.name, bookmarks: m?.bookmarks ?? [], ab: m?.ab ?? null, peaks: m?.peaks, speed: m?.speed, ext: m?.ext, peak: m?.peak, keep: m?.keep })
  }
  return keep
}
