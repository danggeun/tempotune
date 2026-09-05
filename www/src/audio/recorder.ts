/**
 * 녹음 (MediaRecorder) + 녹음 목록 상태. v1 startRec/stopRec/deleteRec 를 옮겼다.
 */
import { recListStore, sessionStore, type RecItem } from '../state/index.ts'
import { dbSave, dbDelete, dbRename, dbLoadAll } from '../persist/recordingsDb.ts'
import { A, onMic } from './engine.ts'

let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let startTime = 0
let timerInt: ReturnType<typeof setInterval> | null = null

export function recExt(mime: string | undefined): 'm4a' | 'webm' { return mime && mime.includes('mp4') ? 'm4a' : 'webm' }
export function recFileName(item: RecItem): string { return 'gopractice_' + item.name + '.' + recExt(item.mime) }

export type RecResult = { ok: true } | { ok: false; error: string }
export function startRec(): RecResult {
  if (!A.micStream) return { ok: false, error: '마이크를 먼저 켜주세요' }
  chunks = []; startTime = Date.now()
  const mimes = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', '']
  const mime = mimes.find(m => !m || MediaRecorder.isTypeSupported(m)) || ''
  const opts: MediaRecorderOptions = { audioBitsPerSecond: 256000 }; if (mime) opts.mimeType = mime
  recorder = new MediaRecorder(A.micStream, opts)
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
  recorder.onstop = async () => {
    const rec = recorder!
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
    const n = new Date(startTime)
    const name = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}_${String(n.getHours()).padStart(2, '0')}${String(n.getMinutes()).padStart(2, '0')}`
    const item: RecItem = { id: null, url: URL.createObjectURL(blob), name, dur: Math.round((Date.now() - startTime) / 1000), blob, mime: rec.mimeType, ts: startTime }
    item.id = await dbSave({ name: item.name, dur: item.dur, blob: item.blob, mime: item.mime, ts: item.ts }).catch(() => null)
    const st = recListStore.get(); recListStore.set({ items: [item, ...st.items], rev: st.rev + 1 })
  }
  recorder.start()
  sessionStore.set({ recording: true, recElapsedSec: 0 })
  if (timerInt) clearInterval(timerInt)
  timerInt = setInterval(() => sessionStore.set({ recElapsedSec: sessionStore.get().recElapsedSec + 1 }), 1000)
  return { ok: true }
}
export function stopRec(): void {
  recorder?.stop()
  if (timerInt) clearInterval(timerInt); timerInt = null
  sessionStore.set({ recording: false, recElapsedSec: 0 })
}
export function toggleRec(): RecResult { return sessionStore.get().recording ? (stopRec(), { ok: true }) : startRec() }

export function deleteRec(idx: number): void {
  const st = recListStore.get(); const item = st.items[idx]; if (!item) return
  URL.revokeObjectURL(item.url); dbDelete(item.id)
  recListStore.set({ items: st.items.filter((_, i) => i !== idx), rev: st.rev + 1 })
}
export function renameRec(idx: number, name: string): void {
  const st = recListStore.get(); const item = st.items[idx]; if (!item) return
  const items = st.items.slice(); items[idx] = { ...item, name }
  dbRename(item.id, name)
  recListStore.set({ items, rev: st.rev + 1 })
}
/** 앱 시작 시 IndexedDB 에서 복원 */
export async function restoreRecordings(): Promise<void> {
  const rows = await dbLoadAll().catch(() => [])
  if (!rows.length) return
  const items: RecItem[] = rows.map(r => ({ id: r.id ?? null, url: URL.createObjectURL(r.blob), name: r.name, dur: r.dur, blob: r.blob, mime: r.mime, ts: r.ts }))
  const st = recListStore.get(); recListStore.set({ items: [...st.items, ...items], rev: st.rev + 1 })
}

onMic('beforeClose', () => { if (sessionStore.get().recording) stopRec() })
