/**
 * 녹음 영속화 (IndexedDB). 스키마 v2: 북마크·A-B 구간·파형 피크를 녹음과 함께 저장한다.
 * v1 → v2 마이그레이션은 onupgradeneeded 에서 기존 행에 기본값을 채운다.
 */
export const REC_DB = 'gopractice_rec', REC_STORE = 'recordings'
export const REC_DB_VERSION = 2
export const REC_TTL = 30 * 24 * 60 * 60 * 1000

export interface AB { a: number; b: number }
export interface RecRow {
  id?: number
  name: string
  dur: number
  blob: Blob
  mime: string
  ts: number
  /** v2 */
  bookmarks: number[]
  ab: AB | null
  /** 파형 미니맵 (0..1 피크, 길이 ≈ 600). 편집기가 처음 열 때 계산해 저장 */
  peaks?: Float32Array
}

let db: IDBDatabase | null = null
const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

export function openRecDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(REC_DB, REC_DB_VERSION)
    r.onupgradeneeded = e => {
      const d = (e.target as IDBOpenDBRequest).result, tx = (e.target as IDBOpenDBRequest).transaction!
      const store = d.objectStoreNames.contains(REC_STORE) ? tx.objectStore(REC_STORE) : d.createObjectStore(REC_STORE, { keyPath: 'id', autoIncrement: true })
      if (e.oldVersion < 2) { // v1 행에 v2 필드 채우기
        const cur = store.openCursor()
        cur.onsuccess = () => { const c = cur.result; if (!c) return; const row = c.value as Partial<RecRow>; if (!Array.isArray(row.bookmarks)) row.bookmarks = []; if (row.ab === undefined) row.ab = null; c.update(row); c.continue() }
      }
    }
    r.onsuccess = e => { db = (e.target as IDBOpenDBRequest).result; res(db) }
    r.onerror = () => rej(r.error)
    r.onblocked = () => rej(new Error('db blocked'))
  })
}
const store = (mode: IDBTransactionMode) => db!.transaction(REC_STORE, mode).objectStore(REC_STORE)

export async function dbSave(row: RecRow): Promise<number | null> {
  if (!db) return null
  return req(store('readwrite').add(row)) as Promise<number>
}
export function dbDelete(id: number | null | undefined): void { if (db && id != null) store('readwrite').delete(id) }
/** 일부 필드만 갱신 (get → put). 실패는 조용히 — 편집 상태는 메모리에 남아 있다 */
export async function dbPatch(id: number | null | undefined, patch: Partial<Omit<RecRow, 'id'>>): Promise<void> {
  if (!db || id == null) return
  const s = store('readwrite'); const row = (await req(s.get(id))) as RecRow | undefined
  if (row) { Object.assign(row, patch); await req(s.put(row)) }
}
/** 전체 로드 (최신순). TTL 지난 항목은 삭제 후 제외. */
export async function dbLoadAll(): Promise<RecRow[]> {
  if (!db) return []
  const rows = (await req(store('readonly').getAll())) as Partial<RecRow>[]
  const now = Date.now(), keep: RecRow[] = []
  for (const r of rows.sort((a, b) => b.ts! - a.ts!)) {
    if (now - r.ts! > REC_TTL) { dbDelete(r.id); continue }
    keep.push({ ...r, bookmarks: r.bookmarks ?? [], ab: r.ab ?? null } as RecRow)
  }
  return keep
}
