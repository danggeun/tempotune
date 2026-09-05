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

/** 폰 레이아웃 여부 (v1: window.innerWidth<700) */
export const isPhoneLayout = (): boolean => window.innerWidth < 700
