/**
 * 플랫폼 분기 (웹 / Capacitor Android). 나머지 코드는 이 모듈의 함수만 호출한다.
 */
declare global { interface Window { Capacitor?: unknown } }

export const isNative = (): boolean => typeof window !== 'undefined' && !!window.Capacitor

/** Capacitor 상태바를 앱 배경색에 맞춘다. 웹에서는 no-op. */
export function initStatusBar(): void {
  if (!isNative()) return
  document.body.classList.add('capacitor')
  import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
    const dark = window.matchMedia('(prefers-color-scheme:dark)').matches
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
    StatusBar.setBackgroundColor({ color: dark ? '#0f0f0f' : '#f7f8fb' })
  }).catch(() => {})
}

// ── 화면 켜짐 유지 ──
let wakeLock: WakeLockSentinel | null = null
export async function acquireWakeLock(): Promise<void> {
  try { wakeLock = (await navigator.wakeLock?.request('screen')) ?? null } catch { /* 지원 안 함 / 거부 */ }
}
export function releaseWakeLock(): void { wakeLock?.release(); wakeLock = null }

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
/**
 * 파일을 사용자에게 건넨다. 웹: 브라우저 다운로드. Android 앱: 캐시에 쓰고 공유 시트(파일 앱·드라이브 등으로 저장).
 * WebView 의 <a download> 는 동작하지 않는 경우가 많아(설계서 §D1) 네이티브 경로를 쓴다.
 */
export async function saveFile(blob: Blob, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!isNative()) {
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name
      document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 3000)
      return { ok: true }
    }
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
    const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob) })
    const w = await Filesystem.writeFile({ path: 'gopractice/' + name, data: b64, directory: Directory.Cache, recursive: true })
    await Share.share({ title: name, url: w.uri, dialogTitle: '저장 / 공유' })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/cancel/i.test(msg)) return { ok: true } // 공유 시트 취소는 오류가 아님
    return { ok: false, error: msg }
  }
}

/** 폰 레이아웃 여부 (v1: window.innerWidth<700) */
export const isPhoneLayout = (): boolean => window.innerWidth < 700
