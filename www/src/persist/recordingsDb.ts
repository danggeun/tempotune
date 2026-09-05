/**
 * 녹음 영속화 (IndexedDB). 스키마 v1 그대로 (Phase 4에서 v2로 확장 예정).
 * 허용된 동작 변경(Phase 1): 이름 수정을 저장한다 (v1 버그: 메모리만 바뀌어 재시작 시 복귀).
 */
export const REC_DB = 'gopractice_rec', REC_STORE = 'recordings'
export const REC_TTL = 30 * 24 * 60 * 60 * 1000

export interface RecRow { id?: number; name: string; dur: number; blob: Blob; mime: string; ts: number }

let db: IDBDatabase | null = null

export function openRecDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(REC_DB, 1)
    req.onupgradeneeded = e => { const d = (e.target as IDBOpenDBRequest).result; if (!d.objectStoreNames.contains(REC_STORE)) d.createObjectStore(REC_STORE, { keyPath: 'id', autoIncrement: true }) }
    req.onsuccess = e => { db = (e.target as IDBOpenDBRequest).result; res(db) }
    req.onerror = () => rej(req.error)
  })
}

export function dbSave(row: RecRow): Promise<number | null> {
  if (!db) return Promise.resolve(null)
  return new Promise((res, rej) => {
    const req = db!.transaction(REC_STORE, 'readwrite').objectStore(REC_STORE).add(row)
    req.onsuccess = () => res(req.result as number)
    req.onerror = () => rej(req.error)
  })
}
export function dbDelete(id: number | null | undefined): void {
  if (!db || id == null) return
  db.transaction(REC_STORE, 'readwrite').objectStore(REC_STORE).delete(id)
}
/** 이름만 갱신 (get → put) */
export function dbRename(id: number | null | undefined, name: string): void {
  if (!db || id == null) return
  const store = db.transaction(REC_STORE, 'readwrite').objectStore(REC_STORE)
  const req = store.get(id)
  req.onsuccess = () => { const row = req.result as RecRow | undefined; if (row) { row.name = name; store.put(row) } }
}
/** 전체 로드 (최신순). TTL 지난 항목은 삭제 후 제외. */
export function dbLoadAll(): Promise<RecRow[]> {
  if (!db) return Promise.resolve([])
  return new Promise((res, rej) => {
    const req = db!.transaction(REC_STORE, 'readonly').objectStore(REC_STORE).getAll()
    req.onsuccess = () => {
      const now = Date.now()
      const rows = (req.result as RecRow[]).sort((a, b) => b.ts - a.ts)
      const keep: RecRow[] = []
      for (const r of rows) { if (now - r.ts > REC_TTL) dbDelete(r.id); else keep.push(r) }
      res(keep)
    }
    req.onerror = () => rej(req.error)
  })
}
