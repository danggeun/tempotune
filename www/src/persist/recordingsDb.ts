/**
 * 녹음 영속화 (IndexedDB). 스키마 v3:
 *   recordings: {id, name, dur, blob, mime, ts}            — 큰 blob, 거의 안 바뀜
 *   meta:       {id, name?, bookmarks, ab, peaks}          — 편집 상태, 자주 바뀜 (blob 을 다시 쓰지 않게 분리)
 * v1(필드 없음) → v2(같은 행에 bookmarks/ab) → v3(meta 분리) 마이그레이션.
 */
export const REC_DB = 'gopractice_rec', REC_STORE = 'recordings', META_STORE = 'meta'
export const REC_DB_VERSION = 3
export const REC_TTL = 30 * 24 * 60 * 60 * 1000

export interface AB { a: number; b: number }
export interface RecRow { id?: number; name: string; dur: number; blob: Blob; mime: string; ts: number }
export interface RecMeta { id: number; name?: string; bookmarks: number[]; ab: AB | null; peaks?: Float32Array }
export interface RecFull extends RecRow { bookmarks: number[]; ab: AB | null; peaks?: Float32Array }

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
    r.onblocked = () => rej(new Error('db blocked'))
  })
}
const store = (name: string, mode: IDBTransactionMode) => db!.transaction(name, mode).objectStore(name)

export async function dbSave(row: RecRow, meta: Omit<RecMeta, 'id'>): Promise<number | null> {
  if (!db) return null
  const id = (await req(store(REC_STORE, 'readwrite').add(row))) as number
  await req(store(META_STORE, 'readwrite').put({ id, ...meta })).catch(() => { metaError?.('편집 정보를 저장하지 못했어요') })
  return id
}
export function dbDelete(id: number | null | undefined): void {
  if (!db || id == null) return
  store(REC_STORE, 'readwrite').delete(id); store(META_STORE, 'readwrite').delete(id)
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
  for (const r of rows.sort((a, b) => (b.ts || 0) - (a.ts || 0))) {
    if (typeof r.ts === 'number' && now - r.ts > REC_TTL) { dbDelete(r.id); continue } // ts 없는 구버전 행은 보관
    const m = metas.get(r.id!)
    keep.push({ ...r, name: m?.name ?? r.name, bookmarks: m?.bookmarks ?? [], ab: m?.ab ?? null, peaks: m?.peaks })
  }
  return keep
}
