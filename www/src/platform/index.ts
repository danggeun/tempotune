/**
 * 플랫폼 분기 (웹 / Capacitor Android). 나머지 코드는 이 모듈의 함수만 호출한다.
 */
declare global { interface Window { Capacitor?: unknown } }

export const isNative = (): boolean => typeof window !== 'undefined' && !!window.Capacitor

/**
 * iOS / iPadOS 인가. **여기서만** UA 를 본다.
 * 왜 UA 인가: 고쳐야 하는 것이 "`<a download>` 가 조용히 실패한다" 인데 그건 기능 검출로 알 수 없다
 * (`navigator.canShare({files})` 는 안드로이드·데스크톱에서도 true 라 구분이 안 된다). 그래서 공유 시트를
 * **iOS 에서만** 쓴다 — 다른 플랫폼의 즉시 다운로드 동작은 그대로 둔다 (기존 기능 유지).
 * iPadOS 13+ 는 'MacIntel' 로 위장하므로 터치 포인트로 가른다.
 */
export const isIOS = (): boolean => {
  if (typeof navigator === 'undefined') return false
  const p = navigator.platform || ''
  return /iPad|iPhone|iPod/.test(p) || (p === 'MacIntel' && navigator.maxTouchPoints > 1) || /iPad|iPhone|iPod/.test(navigator.userAgent)
}

/** Capacitor 상태바를 앱 배경색에 맞춘다. 웹에서는 no-op. */
export function initStatusBar(): void {
  if (!isNative()) return
  document.body.classList.add('capacitor')
  import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
    // 앱은 다크 고정이므로 시스템 테마를 따라가지 않는다 (style.css :root 주석 참고)
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
    StatusBar.setBackgroundColor({ color: '#0f0f0f' }).catch(() => {}) // Android 15 엣지투엣지에서는 무시됨 (투명 상태바) — 스타일만 유효
  }).catch(() => {})
}

// ── Android 뒤로가기 ──
/** 앱에서 뒤로가기: handler 가 true 를 돌려주면 소비, 아니면 앱을 백그라운드로 (종료 대신) */
export function onBackButton(handler: () => boolean): void {
  if (!isNative()) return
  import('@capacitor/app').then(({ App }) => { void App.addListener('backButton', () => { if (!handler()) void App.minimizeApp() }) }).catch(() => {})
}

// ── 화면 켜짐 유지 ──
let wakeLock: WakeLockSentinel | null = null
let wakeWarned = false, wakeWarn: ((m: string) => void) | null = null
export function onWakeLockUnsupported(fn: (m: string) => void): void { wakeWarn = fn }
export async function acquireWakeLock(): Promise<void> {
  if (wakeLock && !wakeLock.released) return // 이미 쥐고 있으면 다시 요청하지 않는다 — 앞의 센티널을 놓지 못해 새는 것을 막는다 (R7)
  if (!('wakeLock' in navigator)) { if (!wakeWarned) { wakeWarned = true; wakeWarn?.('이 브라우저는 화면 켜짐 유지를 지원하지 않아요') } return }
  try { wakeLock = await navigator.wakeLock.request('screen') } catch { /* 배터리 절약 모드·백그라운드 — 다음 visible 에서 재시도 */ }
}
export function releaseWakeLock(): void { wakeLock?.release().catch(() => {}); wakeLock = null } // 이미 해제된 센티널이면 reject — 잡지 않으면 unhandled rejection (R7)

// ── 전체화면 (웹 전용) ──
export function toggleFullscreen(onUnsupported: () => void): void {
  if (isNative()) return
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void }
  if (!document.fullscreenElement && !doc.webkitFullscreenElement) {
    if (el.requestFullscreen) el.requestFullscreen()
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
    else onUnsupported()
  } else {
    if (document.exitFullscreen) document.exitFullscreen()
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen()
  }
}

// ── 파일 저장 ──
/** 사용자 이름에서 경로 문자·제어 문자를 제거 (하위 폴더로 새거나 실패하지 않게) */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\.{2,}/g, '.').trim().replace(/^\.+/, '')
  return (cleaned || 'recording').slice(0, 120)
}
const toBase64 = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(r.error); r.readAsDataURL(b) })
/**
 * 파일을 사용자에게 건넨다. 웹: 브라우저 다운로드. Android 앱: 캐시에 쓰고 공유 시트(파일 앱·드라이브 등으로 저장).
 * WebView 의 <a download> 는 동작하지 않는 경우가 많아(설계서 §D1) 네이티브 경로를 쓴다.
 */
export async function saveFile(blob: Blob, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!isNative()) {
      const safe = sanitizeFileName(name)
      // iOS: 공유 시트로 건넨다 (B13). `<a download>` 는 홈 화면 PWA 에서 조용히 실패하고, 성공해도 '파일' 앱
      // 안에만 남아 다른 앱으로 보내기가 번거롭다. 공유 시트는 파일에 저장·AirDrop·메시지·카톡이 한 번에 열린다
      // — 안드로이드 앱 경로(Share 플러그인)와 사용자 경험도 같아진다.
      // 제스처 만료 주의: 이 함수는 클릭 핸들러에서 await 없이 바로 호출돼야 한다(호출부가 그렇게 되어 있다).
      if (isIOS()) {
        const file = new File([blob], safe, { type: blob.type || 'application/octet-stream' })
        const nav = navigator as Navigator & { canShare?: (d: { files?: File[] }) => boolean }
        if (typeof navigator.share === 'function' && nav.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title: safe }); return { ok: true } }
          catch (e) { if (e instanceof Error && e.name === 'AbortError') return { ok: true } /* 취소는 오류가 아니다 */ }
          // 그 밖의 거부(NotAllowedError 등)는 아래 다운로드로 폴백
        }
      }
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = safe
      document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 3000)
      return { ok: true }
    }
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
    const safe = sanitizeFileName(name)
    // 이전 공유 파일 정리 (캐시에 50 MB 씩 쌓이지 않게)
    await Filesystem.rmdir({ path: 'tempotune', directory: Directory.Cache, recursive: true }).catch(() => {})
    await Filesystem.mkdir({ path: 'tempotune', directory: Directory.Cache, recursive: true }).catch(() => {})
    // 큰 파일은 1 MB 씩 나눠 쓴다 — base64 문자열 한 덩어리로 브리지를 건너면 ANR/OOM
    const CHUNK = 1024 * 1024; const path = 'tempotune/' + safe
    for (let off = 0; off < blob.size; off += CHUNK) {
      const b64 = await toBase64(blob.slice(off, off + CHUNK))
      if (off === 0) await Filesystem.writeFile({ path, data: b64, directory: Directory.Cache })
      else await Filesystem.appendFile({ path, data: b64, directory: Directory.Cache })
    }
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
    await Share.share({ title: safe, url: uri, dialogTitle: '저장 / 공유' })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/cancel/i.test(msg)) return { ok: true } // 공유 시트 취소는 오류가 아님
    return { ok: false, error: msg }
  }
}

/** 폰 레이아웃 여부 (v1: window.innerWidth<700) */
export const isPhoneLayout = (): boolean => window.innerWidth < 700
