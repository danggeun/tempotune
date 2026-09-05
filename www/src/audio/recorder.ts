/**
 * 녹음 (MediaRecorder) + 녹음 목록 상태. v1 startRec/stopRec/deleteRec 를 옮겼다.
 */
import { recListStore, sessionStore, type RecItem } from '../state/index.ts'
import { dbSave, dbDelete, dbPatchMeta, dbLoadAll } from '../persist/recordingsDb.ts'
import { computePeaks } from '../core/peaks.ts'
import { A, onMic } from './engine.ts'

const MAX_REC_SEC = 60 * 60
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
    stopPeakCapture()
    const peaks = livePeaks.length ? computePeaks([Float32Array.from(livePeaks)], 600) : undefined
    const item: RecItem = { id: null, url: URL.createObjectURL(blob), name, dur: Math.round((Date.now() - startTime) / 1000), blob, mime: rec.mimeType, ts: startTime, bookmarks: [], ab: null, peaks }
    item.id = await dbSave({ name: item.name, dur: item.dur, blob: item.blob, mime: item.mime, ts: item.ts }, { bookmarks: [], ab: null, peaks }).catch(() => null)
    if (item.id == null) errorFn?.('녹음을 저장하지 못했어요 — 이번 세션에만 남아 있어요') // 용량 부족·프라이빗 모드 등: 조용한 실패 금지
    const st = recListStore.get(); recListStore.set({ items: [item, ...st.items], rev: st.rev + 1 })
  }
  recorder.start()
  startPeakCapture()
  sessionStore.set({ recording: true, recElapsedSec: 0 })
  if (timerInt) clearInterval(timerInt)
  timerInt = setInterval(() => {
    const sec = sessionStore.get().recElapsedSec + 1; sessionStore.set({ recElapsedSec: sec })
    if (sec >= MAX_REC_SEC) { stopRec(); errorFn?.('60분이 되어 녹음을 저장했어요 (메모리 보호)') } // 청크가 메모리에 쌓이므로 상한을 둔다 (256 kbps × 60 min ≈ 115 MB)
  }, 1000)
  return { ok: true }
}
export function stopRec(): void {
  recorder?.stop()
  if (timerInt) clearInterval(timerInt); timerInt = null
  sessionStore.set({ recording: false, recElapsedSec: 0 })
}
export function toggleRec(): RecResult { return sessionStore.get().recording ? (stopRec(), { ok: true }) : startRec() }

// ── 녹음 중 파형 피크 누적 (디코드 없이 파형을 얻는다 — 10분 녹음의 디코드 메모리 회피) ──
let livePeaks: number[] = [], peakTimer: ReturnType<typeof setInterval> | null = null, peakAnalyser: AnalyserNode | null = null
const peakBuf = new Float32Array(2048)
function startPeakCapture(): void {
  livePeaks = []
  if (!A.micSource || !A.ac) return
  peakAnalyser = A.ac.createAnalyser(); peakAnalyser.fftSize = 2048; A.micSource.connect(peakAnalyser)
  peakTimer = setInterval(() => { peakAnalyser!.getFloatTimeDomainData(peakBuf); let m = 0; for (let i = 0; i < peakBuf.length; i++) { const v = Math.abs(peakBuf[i]!); if (v > m) m = v } livePeaks.push(m) }, 50) // 20 개/초
}
function stopPeakCapture(): void { if (peakTimer) clearInterval(peakTimer); peakTimer = null; peakAnalyser?.disconnect(); peakAnalyser = null }

/** 항목 식별은 인덱스가 아니라 항목 자체(녹음 중 prepend 로 인덱스가 밀려도 안전) */
export const indexOf = (item: RecItem): number => recListStore.get().items.indexOf(item)
export function deleteRec(item: RecItem): void {
  const st = recListStore.get(); if (!st.items.includes(item)) return
  URL.revokeObjectURL(item.url); dbDelete(item.id)
  recListStore.set({ items: st.items.filter(i => i !== item), rev: st.rev + 1 })
}
/** 삭제 취소용: 항목을 원래 자리에 되돌리고 DB 에 다시 저장 */
export async function restoreDeleted(item: RecItem, at: number): Promise<void> {
  const st = recListStore.get(); const items = st.items.slice()
  const back: RecItem = { ...item, url: URL.createObjectURL(item.blob) }
  items.splice(Math.min(at, items.length), 0, back)
  recListStore.set({ items, rev: st.rev + 1 })
  const id = await dbSave({ name: back.name, dur: back.dur, blob: back.blob, mime: back.mime, ts: back.ts }, { bookmarks: back.bookmarks, ab: back.ab, peaks: back.peaks }).catch(() => null)
  const st2 = recListStore.get(); const i = st2.items.indexOf(back); if (i >= 0) { const items2 = st2.items.slice(); items2[i] = { ...back, id }; recListStore.set({ items: items2, rev: st2.rev }) }
}
export function renameRec(item: RecItem, name: string): RecItem | null { return patchRec(item, { name }) }
/** 편집 상태(북마크/A-B/파형)·이름을 메모리와 IndexedDB(meta) 에 반영. 새 항목 객체를 반환. rev 는 name 변경 때만 올린다 */
export function patchRec(item: RecItem, patch: Partial<Pick<RecItem, 'name' | 'bookmarks' | 'ab' | 'peaks'>>): RecItem | null {
  const st = recListStore.get(); const idx = st.items.indexOf(item); if (idx < 0) return null
  const items = st.items.slice(); const next = { ...item, ...patch }; items[idx] = next
  void dbPatchMeta(item.id, patch)
  recListStore.set({ items, rev: 'name' in patch ? st.rev + 1 : st.rev })
  return next
}
let errorFn: ((m: string) => void) | null = null
export function onRecorderError(fn: (m: string) => void): void { errorFn = fn }
/** 앱 시작 시 IndexedDB 에서 복원 */
export async function restoreRecordings(): Promise<void> {
  const rows = await dbLoadAll().catch(() => [])
  if (!rows.length) return
  const items: RecItem[] = rows.map(r => ({ id: r.id ?? null, url: URL.createObjectURL(r.blob), name: r.name, dur: r.dur, blob: r.blob, mime: r.mime, ts: r.ts, bookmarks: r.bookmarks, ab: r.ab, peaks: r.peaks }))
  const st = recListStore.get(); recListStore.set({ items: [...st.items, ...items], rev: st.rev + 1 })
}

onMic('beforeClose', () => { if (sessionStore.get().recording) stopRec() })
