/** 플랫폼 분기 (웹 / iOS 웹 / Capacitor Android). 나머지 코드는 이 모듈의 함수만 호출한다 */
import { t } from '../core/i18n/index.ts'
declare global { interface Window { Capacitor?: unknown } }

export const isNative = (): boolean => typeof window !== 'undefined' && !!window.Capacitor

/** Safari(iOS 포함). 크로미움계는 UA 에 Chrome/CriOS 가 있다 */
export const isSafari = (): boolean => typeof navigator !== 'undefined' && /Safari/.test(navigator.userAgent) && !/Chrome|CriOS|Chromium|Edg|FxiOS/.test(navigator.userAgent)
/** iOS / iPadOS. UA 를 보는 유일한 곳 — iPadOS 13+ 는 'MacIntel' 로 위장하므로 터치 포인트로 가른다 */
export const isIOS = (): boolean => {
  if (typeof navigator === 'undefined') return false
  const p = navigator.platform || ''
  return /iPad|iPhone|iPod/.test(p) || (p === 'MacIntel' && navigator.maxTouchPoints > 1) || /iPad|iPhone|iPod/.test(navigator.userAgent)
}

/** 앱(Capacitor)이면 body 에 표식. 상태바 색은 setStatusBarTheme */
/** 홈 화면 앱이 상태바 밑까지 그려지는지(위쪽 safe-area > 0) 재서 html.sb-under 로 알린다 — style.css 가 그때만 높이를 lvh 로 */
export function fitStandaloneHeight(): void {
  const measure = (): void => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:0;left:0;width:1px;visibility:hidden;height:env(safe-area-inset-top,0px)'
    document.body.appendChild(probe)
    const under = probe.offsetHeight > 0 && matchMedia('(display-mode: standalone)').matches
    probe.remove()
    document.documentElement.classList.toggle('sb-under', under)
  }
  measure(); window.addEventListener('resize', measure)
}
export function initStatusBar(): void {
  if (!isNative()) return
  document.body.classList.add('capacitor')
}
/** 상태바 글자색·배경을 테마에 맞춘다. 웹은 meta theme-color, 앱은 Capacitor StatusBar */
export function setStatusBarTheme(theme: 'dark' | 'light', bg: string): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
  if (!isNative()) return
  import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
    StatusBar.setStyle({ style: theme === 'light' ? Style.Light : Style.Dark }).catch(() => {})
    StatusBar.setBackgroundColor({ color: bg }).catch(() => {}) // Android 15 엣지투엣지에서는 무시됨 (투명 상태바)
  }).catch(() => {})
}

/** 앱에서 뒤로가기: handler 가 true 를 돌려주면 소비, 아니면 앱을 백그라운드로 (종료 대신) */
export function onBackButton(handler: () => boolean): void {
  if (!isNative()) return
  import('@capacitor/app').then(({ App }) => { void App.addListener('backButton', () => { if (!handler()) void App.minimizeApp() }) }).catch(() => {})
}

// 화면 켜짐 유지
let wakeLock: WakeLockSentinel | null = null, wakeGen = 0
let wakeWarned = false, wakeWarn: ((m: string) => void) | null = null
export function onWakeLockUnsupported(fn: (m: string) => void): void { wakeWarn = fn }
/** iOS 웹은 첫 요청에 DOM 탭(transient activation)이 필요 — 탭 핸들러에서 await 전에 부른다. 실패는 삼킨다(다음 syncWake 에서 재시도) */
export async function acquireWakeLock(): Promise<void> {
  if (wakeLock && !wakeLock.released) return // 이미 쥐고 있으면 다시 요청하지 않는다 — 앞의 센티널이 샌다
  if (!('wakeLock' in navigator)) { if (!wakeWarned) { wakeWarned = true; wakeWarn?.(t('set.wakeUnsupported')) } return }
  const gen = ++wakeGen
  try {
    const s = await navigator.wakeLock.request('screen')
    if (gen !== wakeGen) { s.release().catch(() => {}); return } // 기다리는 사이 release 가 왔다 — 고아 센티널을 쥐지 않는다
    wakeLock = s
  } catch { /* 저전력 모드·백그라운드·활성화 없음 */ }
}
export function releaseWakeLock(): void { wakeGen++; wakeLock?.release().catch(() => {}); wakeLock = null } // 이미 풀린 센티널은 reject 할 수 있다

// 전체화면 (웹 전용)
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

// 파일 저장
/** 사용자 이름에서 경로 문자·제어 문자를 제거 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\.{2,}/g, '.').trim().replace(/^\.+/, '')
  return (cleaned || 'recording').slice(0, 120)
}
const toBase64 = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(r.error); r.readAsDataURL(b) })
/** 파일을 사용자에게 건넨다. 웹: 다운로드, iOS: 공유 시트, Android 앱: 캐시에 쓰고 공유 시트(WebView 의 <a download> 는 동작하지 않는다) */
export async function saveFile(blob: Blob, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!isNative()) {
      const safe = sanitizeFileName(name)
      // iOS: <a download> 는 홈 화면 PWA 에서 조용히 실패한다 → 공유 시트. 클릭 핸들러에서 await 없이 바로 호출돼야 한다(제스처 만료)
      if (isIOS()) {
        const file = new File([blob], safe, { type: blob.type || 'application/octet-stream' })
        const nav = navigator as Navigator & { canShare?: (d: { files?: File[] }) => boolean }
        if (typeof navigator.share === 'function' && nav.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title: safe }); return { ok: true } }
          catch (e) {
            if (e instanceof Error && e.name === 'AbortError') return { ok: true } /* 취소는 오류가 아니다 */
            // 홈 화면 앱에서는 <a download> 폴백이 조용히 아무것도 안 한다 — 사파리 탭에서만 폴백
            if ((navigator as Navigator & { standalone?: boolean }).standalone) return { ok: false, error: t('app.shareFailed') }
          }
        }
      }
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = safe
      document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 3000)
      return { ok: true }
    }
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
    const safe = sanitizeFileName(name)
    // 이전 공유 파일 정리 — 캐시에 쌓이지 않게
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
    await Share.share({ title: safe, url: uri, dialogTitle: t('app.shareTitle') })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/cancel/i.test(msg)) return { ok: true } // 공유 시트 취소는 오류가 아님
    return { ok: false, error: msg }
  }
}

/** 폰 레이아웃 여부 */
export const isPhoneLayout = (): boolean => window.innerWidth < 700
