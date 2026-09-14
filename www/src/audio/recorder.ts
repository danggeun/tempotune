/**
 * 녹음 (MediaRecorder) + 녹음 목록 상태. v1 startRec/stopRec/deleteRec 를 옮겼다.
 */
import { recListStore, sessionStore, type RecItem } from '../state/index.ts'
import { dbSave, dbDelete, dbPatchMeta, dbLoadAll } from '../persist/recordingsDb.ts'
import { computePeaks, peakOf } from '../core/peaks.ts'
import { containerOf, extFromMime, type RecContainer } from '../core/container.ts'
import { isIOS } from '../platform/index.ts'
import { A, onMic } from './engine.ts'

const MAX_REC_SEC = 60 * 60
let cappedNotice: string | null = null
let recorder: MediaRecorder | null = null
let timerInt: ReturnType<typeof setInterval> | null = null

/** 확장자: 저장 때 파일 내용으로 판정해 둔 값이 우선, 없으면(옛 행) mime 으로 추정 (B13) */
export const recExt = (item: Pick<RecItem, 'ext' | 'mime'>): RecContainer => item.ext ?? extFromMime(item.mime)
export function recFileName(item: RecItem): string { return 'gopractice_' + item.name + '.' + recExt(item) }

export type RecResult = { ok: true } | { ok: false; error: string }
export function startRec(): RecResult {
  if (!A.micStream) return { ok: false, error: '마이크를 먼저 켜주세요' }
  if (recorder && recorder.state !== 'inactive') return { ok: false, error: '이미 녹음 중이에요' }
  const t0 = Date.now()
  // 컨테이너 우선순위 (B13).
  //
  // 문제: iOS 18.4 부터 Safari 가 `audio/webm;codecs=opus` 녹음을 지원하게 되면서, webm 을 맨 앞에 두었던
  // 이 목록이 **아이폰에서 진짜 WebM 을 만들기 시작했다.** iOS 는 .webm 오디오를 열거나 보낼 수 없다
  // (파일 앱·메시지·카톡이 거부하고 macOS 기본 재생기도 못 연다). 코드가 아니라 브라우저가 변해서 생긴 회귀다.
  //
  // 왜 전 플랫폼 mp4 우선이 아닌가 — 실측으로 확인한 함정:
  //   Chromium 141 은 `isTypeSupported('audio/mp4')` 가 true 지만 실제 출력이 **`audio/mp4;codecs=opus`**
  //   (MP4 컨테이너 안의 Opus) 다. 그러면 이름은 .m4a 인데 아이폰·맥이 못 여는 파일이 되어 **더 나빠진다.**
  //   `audio/mp4;codecs=mp4a.40.2`(AAC 명시)는 Chromium 이 false 를 돌려준다.
  // 그래서 **iOS 에서만** mp4 를 앞세운다(Safari 의 mp4 = AAC). 그 밖의 플랫폼은 v2.0.1 순서 그대로 —
  // 안드로이드 출력은 한 글자도 바뀌지 않는다.
  const mimes = isIOS()
    ? ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', '']
    : ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', '']
  const mime = mimes.find(m => !m || MediaRecorder.isTypeSupported(m)) || ''
  const opts: MediaRecorderOptions = { audioBitsPerSecond: 256000 }; if (mime) opts.mimeType = mime
  // 세션 상태(recorder·청크·시작 시각)는 클로저에 가둔다 — 정지 직후 바로 다시 시작하면 이전 세션의 늦은 ondataavailable/onstop 이
  // 모듈 변수를 공유해 새 녹음의 청크를 지우거나 옛 청크를 새 녹음에 섞던 경합 (리뷰)
  let rec: MediaRecorder
  try { rec = new MediaRecorder(A.micStream, opts) } catch (e) { return { ok: false, error: '이 기기에서는 녹음을 지원하지 않아요' + (e instanceof Error ? ` (${e.name})` : '') } }
  const parts: Blob[] = []
  rec.ondataavailable = e => { if (e.data.size > 0) parts.push(e.data) }
  rec.onerror = () => { errorFn?.('녹음 중 오류가 나서 저장했어요'); if (recorder === rec) stopRec() }
  // 저장 경로의 어떤 단계가 실패해도 **녹음 자체는 잃지 않는다**: 파형·피크·확장자는 부가 정보라
  // 없어도 재생·편집·다운로드가 된다(편집기는 peaks 가 없으면 오디오에서 계산). blob 을 못 만들 때만 포기한다. (D4)
  rec.onstop = async () => {
    let blob: Blob
    try { blob = new Blob(parts, { type: rec.mimeType || 'audio/mp4' }) }
    catch { parts.length = 0; errorFn?.('녹음을 저장하지 못했어요'); return }
    parts.length = 0 // 60분 녹음 ≈ 115 MB 가 두 벌 남지 않게
    const n = new Date(t0)
    const name = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}_${String(n.getHours()).padStart(2, '0')}${String(n.getMinutes()).padStart(2, '0')}`
    // 파형용 peaks 는 최대값으로 정규화되므로(core/peaks.ts) 절대 레벨이 사라진다 → 재생 보정용 원시 피크를 따로 남긴다 (B12c)
    let peak: number | undefined, peaks: Float32Array | undefined
    try {
      peak = myPeaks.length ? peakOf(myPeaks) : undefined
      peaks = myPeaks.length ? computePeaks([Float32Array.from(myPeaks)], 600) : undefined
    } catch { peak = undefined; peaks = undefined; errorFn?.('녹음은 저장했지만 파형을 만들지 못했어요') }
    // 확장자는 mimeType 문자열이 아니라 파일 앞부분 바이트로 정한다 — 빈 mimeType·예상 밖 값에도 내용과 맞는 이름이 붙게
    let ext: RecContainer
    try { ext = containerOf(new Uint8Array(await blob.slice(0, 16).arrayBuffer().catch(() => new ArrayBuffer(0))), rec.mimeType) }
    catch { ext = extFromMime(rec.mimeType) }
    const item: RecItem = { id: null, url: URL.createObjectURL(blob), name, dur: Math.round((Date.now() - t0) / 1000), blob, mime: rec.mimeType, ext, peak, ts: t0, bookmarks: [], ab: null, peaks }
    item.id = await dbSave({ name: item.name, dur: item.dur, blob: item.blob, mime: item.mime, ts: item.ts }, { bookmarks: [], ab: null, peaks, ext, peak }).catch(() => null)
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
  const id = await dbSave({ name: back.name, dur: back.dur, blob: back.blob, mime: back.mime, ts: back.ts }, { bookmarks: back.bookmarks, ab: back.ab, peaks: back.peaks, ext: back.ext, peak: back.peak }).catch(() => null)
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
  const items: RecItem[] = rows.map(r => ({ id: r.id ?? null, url: URL.createObjectURL(r.blob), name: r.name, dur: r.dur, blob: r.blob, mime: r.mime, ext: r.ext, peak: r.peak, ts: r.ts, bookmarks: r.bookmarks, ab: r.ab, peaks: r.peaks, speed: r.speed }))
  const st = recListStore.get(); recListStore.set({ items: [...st.items, ...items], rev: st.rev + 1 })
}

onMic('beforeClose', () => { if (sessionStore.get().recording) stopRec() })
