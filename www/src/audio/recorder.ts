/**
 * 녹음 (MediaRecorder) + 녹음 목록 상태. v1 startRec/stopRec/deleteRec 를 옮겼다.
 */
import { recListStore, sessionStore, type RecItem } from '../state/index.ts'
import { dbSave, dbDelete, dbPatchMeta, dbLoadAll } from '../persist/recordingsDb.ts'
import { computePeaks } from '../core/peaks.ts'
import { A, onMic } from './engine.ts'

const MAX_REC_SEC = 60 * 60
let cappedNotice: string | null = null
let recorder: MediaRecorder | null = null
let timerInt: ReturnType<typeof setInterval> | null = null

export function recExt(mime: string | undefined): 'm4a' | 'webm' { return mime && mime.includes('mp4') ? 'm4a' : 'webm' }
export function recFileName(item: RecItem): string { return 'gopractice_' + item.name + '.' + recExt(item.mime) }

export type RecResult = { ok: true } | { ok: false; error: string }
export function startRec(): RecResult {
  if (!A.micStream) return { ok: false, error: '마이크를 먼저 켜주세요' }
  if (recorder && recorder.state !== 'inactive') return { ok: false, error: '이미 녹음 중이에요' }
  const t0 = Date.now()
  const mimes = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', '']
  const mime = mimes.find(m => !m || MediaRecorder.isTypeSupported(m)) || ''
  const opts: MediaRecorderOptions = { audioBitsPerSecond: 256000 }; if (mime) opts.mimeType = mime
  // 세션 상태(recorder·청크·시작 시각)는 클로저에 가둔다 — 정지 직후 바로 다시 시작하면 이전 세션의 늦은 ondataavailable/onstop 이
  // 모듈 변수를 공유해 새 녹음의 청크를 지우거나 옛 청크를 새 녹음에 섞던 경합 (리뷰)
  let rec: MediaRecorder
  try { rec = new MediaRecorder(A.micStream, opts) } catch (e) { return { ok: false, error: '이 기기에서는 녹음을 지원하지 않아요' + (e instanceof Error ? ` (${e.name})` : '') } }
  const parts: Blob[] = []
  rec.ondataavailable = e => { if (e.data.size > 0) parts.push(e.data) }
  rec.onerror = () => { errorFn?.('녹음 중 오류가 나서 저장했어요'); if (recorder === rec) stopRec() }
  rec.onstop = async () => {
    const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' }); parts.length = 0 // 60분 녹음 ≈ 115 MB 가 두 벌 남지 않게
    const n = new Date(t0)
    const name = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}_${String(n.getHours()).padStart(2, '0')}${String(n.getMinutes()).padStart(2, '0')}`
    const peaks = myPeaks.length ? computePeaks([Float32Array.from(myPeaks)], 600) : undefined
    const item: RecItem = { id: null, url: URL.createObjectURL(blob), name, dur: Math.round((Date.now() - t0) / 1000), blob, mime: rec.mimeType, ts: t0, bookmarks: [], ab: null, peaks }
    item.id = await dbSave({ name: item.name, dur: item.dur, blob: item.blob, mime: item.mime, ts: item.ts }, { bookmarks: [], ab: null, peaks }).catch(() => null)
    if (item.id == null) errorFn?.('녹음을 저장하지 못했어요 — 이번 세션에만 남아 있어요') // 용량 부족·프라이빗 모드 등: 조용한 실패 금지
    const st = recListStore.get(); recListStore.set({ items: [item, ...st.items], rev: st.rev + 1 })
    if (cappedNotice) { errorFn?.(cappedNotice); cappedNotice = null }
  }
  recorder = rec
  rec.start()
  const myPeaks = startPeakCapture() // 이 세션의 피크 배열 (다음 세션이 새 배열을 만들어도 참조가 유지된다)
  sessionStore.set({ recording: true, recElapsedSec: 0 })
  if (timerInt) clearInterval(timerInt)
  timerInt = setInterval(() => {
    const sec = Math.round((Date.now() - t0) / 1000); sessionStore.set({ recElapsedSec: sec }) // 벽시계 기준 (백그라운드 스로틀링에도 정확)
    if (sec >= MAX_REC_SEC) { cappedNotice = '60분이 되어 녹음을 저장했어요 (메모리 보호)'; stopRec() } // 청크가 메모리에 쌓이므로 상한을 둔다 (256 kbps × 60 min ≈ 115 MB)
  }, 1000)
  return { ok: true }
}
export function stopRec(): void {
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  stopPeakCapture() // 피크는 onstop 이전에 멈춘다 (onstop 은 비동기로 늦게 올 수 있어 새 세션의 피크와 섞이지 않게 여기서)
  if (timerInt) clearInterval(timerInt); timerInt = null
  sessionStore.set({ recording: false, recElapsedSec: 0 })
}
export function toggleRec(): RecResult { return sessionStore.get().recording ? (stopRec(), { ok: true }) : startRec() }

// ── 녹음 중 파형 피크 누적 (디코드 없이 파형을 얻는다 — 10분 녹음의 디코드 메모리 회피) ──
let livePeaks: number[] = [], peakTimer: ReturnType<typeof setInterval> | null = null, peakAnalyser: AnalyserNode | null = null
const peakBuf = new Float32Array(2048)
function startPeakCapture(): number[] {
  stopPeakCapture(); livePeaks = []
  if (!A.micSource || !A.ac) return livePeaks
  peakAnalyser = A.ac.createAnalyser(); peakAnalyser.fftSize = 2048; A.micSource.connect(peakAnalyser)
  peakTimer = setInterval(() => { peakAnalyser!.getFloatTimeDomainData(peakBuf); let m = 0; for (let i = 0; i < peakBuf.length; i++) { const v = Math.abs(peakBuf[i]!); if (v > m) m = v } livePeaks.push(m) }, 50) // 20 개/초
  return livePeaks
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
/** 편집 상태(북마크/A-B/파형/속도)·이름을 메모리와 IndexedDB(meta) 에 반영. 새 항목 객체를 반환 */
export function patchRec(item: RecItem, patch: Partial<Pick<RecItem, 'name' | 'bookmarks' | 'ab' | 'peaks' | 'speed'>>): RecItem | null {
  const st = recListStore.get(); const idx = st.items.indexOf(item); if (idx < 0) return null
  const items = st.items.slice(); const next = { ...item, ...patch }; items[idx] = next
  void dbPatchMeta(item.id, patch)
  // rev(전체 재렌더: 펼침 상태·미니 플레이어가 리셋된다)는 이름 변경 때만. 북마크/A-B 는 items 교체만으로 목록이 메타 줄을 제자리 갱신한다 (리뷰 #5)
  recListStore.set({ items, rev: 'name' in patch ? st.rev + 1 : st.rev })
  return next
}
let errorFn: ((m: string) => void) | null = null
export function onRecorderError(fn: (m: string) => void): void { errorFn = fn }
/** 앱 시작 시 IndexedDB 에서 복원 */
export async function restoreRecordings(): Promise<void> {
  const rows = await dbLoadAll().catch(() => [])
  if (!rows.length) return
  const items: RecItem[] = rows.map(r => ({ id: r.id ?? null, url: URL.createObjectURL(r.blob), name: r.name, dur: r.dur, blob: r.blob, mime: r.mime, ts: r.ts, bookmarks: r.bookmarks, ab: r.ab, peaks: r.peaks, speed: r.speed }))
  const st = recListStore.get(); recListStore.set({ items: [...st.items, ...items], rev: st.rev + 1 })
}

onMic('beforeClose', () => { if (sessionStore.get().recording) stopRec() })
