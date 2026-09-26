/**
 * 조립 지점. 모듈 간 연결(마이크 생명주기 훅, 화면 마운트, 시작 시퀀스)만 여기서 한다.
 * 의존 방향: ui → state ← audio, ui → audio(명령), * → core, audio/ui → platform
 */
import './fonts.css'
import './style.css'
import { settingsStore, tunerStore, metroStore, refToneStore, droneStore, CFG } from './state/index.ts'
import { loadSettings, startSettingsAutosave, onPersistError } from './persist/settings.ts'
import { openRecDb, onDbError } from './persist/recordingsDb.ts'
import { clearLegacyStorage } from './persist/legacy.ts'
import { openMic, closeMic, onMic, A, resumeIfRunning, onEngineFatal, setIdleCheck, onContextState, isPermissionError, isOpening, cancelOpen, untilOpenSettled } from './audio/engine.ts'
import { startAnalysis, lastFrameMs, metroCalibMs } from './audio/analysis.ts'
import { playbackActive, playbackDiag } from './audio/playback.ts'
import { restoreRecordings, recoverInProgress, onRecorderError } from './audio/recorder.ts'
import { initStatusBar, fitStandaloneHeight, isNative, isIOS, acquireWakeLock, releaseWakeLock, toggleFullscreen, onBackButton, onWakeLockUnsupported } from './platform/index.ts'
import { q, on } from './ui/dom.ts'
import { toast } from './ui/toast.ts'
import { mountTuner, showTapHint, hideTapHint, setHistSec, histDiag, retheme, setMicOpener, showMicOff } from './ui/tuner.ts'
import { mountTheme, onThemeChange } from './ui/theme.ts'
import { mountLang } from './ui/lang.ts'
import { t } from './core/i18n/index.ts'
import { mountRefDrum } from './ui/refDrum.ts'
import { mountMetro } from './ui/metro.ts'
import { onMetroError } from './audio/metronome.ts'
import { mountRefPanel } from './ui/refPanel.ts'
import { mountDrone, dronePopOpen, closeDronePop } from './ui/drone.ts'
import { stopDrone } from './audio/refTone.ts'
import { mountMenu, hideMenu, closeSettings } from './ui/menu.ts'
import { mountSettings } from './ui/settings.ts'
import { mountTimer, stopTimer } from './ui/timer.ts'
import { mountMicPopup, showMicPopup, closeMicPopup } from './ui/micPopup.ts'
import { mountRecHeader } from './ui/recHeader.ts'
import { mountRecList } from './ui/recList.ts'
import { mountEditor, openEditor, closeEditorIfEditing, closeEditor, isEditorOpen, editorDiag } from './ui/editor.ts'
import { stopMetro } from './audio/metronome.ts'
import { stopRec } from './audio/recorder.ts'
import { sessionStore } from './state/index.ts'
import { registerSW } from 'virtual:pwa-register'

initStatusBar(); fitStandaloneHeight()

clearLegacyStorage()

// 설정 복원은 화면 마운트 전에 — 초기 렌더가 복원값을 쓴다
loadSettings(); startSettingsAutosave()

// 화면
mountLang(); mountTheme(); onThemeChange(retheme)
mountTuner(); mountRefDrum(); mountMetro(); mountRefPanel(); mountDrone(); mountMenu(); mountSettings()
mountTimer()
mountRecList(openEditor, closeEditorIfEditing); mountEditor()

// 마이크 생명주기
/** 마이크 열기. popupOnDenied 는 직접 누른 경우에만 — iOS 웹앱은 제스처 없는 호출도 NotAllowedError 를 낸다 */
const tryOpenMic = async (popupOnDenied = false): Promise<boolean> => {
  let r = await openMic()
  // busy = 다른 열기 진행 중 → 끝나길 기다렸다 한 번 더
  if (!r.ok && r.error === 'busy') {
    await untilOpenSettled()
    if (A.micStream) r = { ok: true }
    else if (document.visibilityState !== 'visible') return false // 기다리는 사이 숨겨짐 — 뒤에서 열지 않는다. 복귀 핸들러가 다시 부른다
    else { r = await openMic(); if (!r.ok && r.error === 'busy') return false } // 또 busy = 다른 호출이 여는 중 → 그쪽에 맡긴다
  }
  // busy 는 여는 도중 또 숨겨진 것 — 다음 복귀에서 재시도되므로 재개 중 상태를 유지한다
  if (r.ok || r.error !== 'busy') tunerStore.set({ micReopening: false })
  if (!r.ok && r.error !== 'busy') {
    if (!isPermissionError(r.error)) toast(r.error)
    else if (popupOnDenied) showMicPopup(true)
    return false
  }
  // iOS/Firefox: 권한 프롬프트 중 제스처가 만료되면 컨텍스트가 suspended 로 남는다 → resume 을 1.5 s 까지 기다린 뒤 탭 안내
  setTimeout(async () => { for (let i = 0; i < 5 && A.ac && A.ac.state !== 'running'; i++) await new Promise(r => setTimeout(r, 250)); if (A.ac && A.ac.state !== 'running' && tunerStore.get().running) showResumeHint() }, 400)
  return r.ok
}
/** 권한 상태. 사파리는 microphone 을 지원하지 않아 null — '모른다' 로 다룬다 */
const micPermission = async (): Promise<PermissionState | null> => {
  try { return (await navigator.permissions?.query({ name: 'microphone' as PermissionName }))?.state ?? null } catch { return null }
}
mountMicPopup(tryOpenMic)
mountRecHeader(() => tryOpenMic(true)) // REC 가 마이크를 켠다 — 직접 누른 것이므로 차단이면 안내
setMicOpener(() => startInGesture()) // 꺼진 채 남은 튜너의 시작 버튼 (정의는 아래 — 누를 때 부른다)
const droneOn = (): boolean => droneStore.get().pitchClass !== null
onEngineFatal(toast); onMetroError(toast); onRecorderError(toast); onPersistError(toast); onDbError(toast); onWakeLockUnsupported(toast)
// 녹음 재생도 유휴가 아니다 — 재생이 보정 게인 그래프를 타면 컨텍스트가 잠들 때 무음이 된다
setIdleCheck(() => !metroStore.get().playing && !refToneStore.get().active && !droneOn() && !playbackActive())
startAnalysis()
// wake lock 은 메트로놈이나 드론만 켜도 쥔다 — 화면이 꺼지면 WebView 가 얼어 소리가 멈춘다
const wantWake = () => settingsStore.get().wakeLock && (tunerStore.get().running || metroStore.get().playing || droneOn())
const syncWake = () => { if (wantWake()) acquireWakeLock(); else releaseWakeLock() }
onMic('afterOpen', syncWake)
// 타이머는 마이크가 닫힐 때 같이 멈추되, 화면 숨김·편집기로 잠시 놓는 경우는 건드리지 않는다
let releasingForHide = false, releasingForEditor = false
onMic('afterClose', () => { if (!releasingForHide && !releasingForEditor) stopTimer(); syncWake(); stopInactivityWatch() })
metroStore.select(s => s.playing, syncWake)
droneStore.select(s => s.pitchClass, syncWake)
// 15분 무활동 자동 종료 — 연습 타이머와 무관하게 마이크가 켜져 있으면 항상 감시
let inactInt: ReturnType<typeof setInterval> | null = null
function stopInactivityWatch(): void { if (inactInt) clearInterval(inactInt); inactInt = null }
// 열 때 활동 시각을 새로 잡는다 — 안 하면 15분 넘게 켜둔 뒤 마이크를 (다시) 켜는 순간 바로 종료된다
onMic('afterOpen', () => { tunerStore.set({ lastActivityMs: Date.now() }); stopInactivityWatch(); inactInt = setInterval(() => { if (Date.now() - tunerStore.get().lastActivityMs > CFG.inactiveMs) { toast(t('mic.idleOff')); closeMic(); showTapHint(tryOpenMic) } }, 30 * 1000) })
settingsStore.select(s => s.wakeLock, syncWake)
// 숨김: 마이크를 놓고 메트로놈·드론을 멈춘다(복귀 시 자동 재개 안 함). 녹음 중이면 마이크는 둔다
// 복귀: 컨텍스트 재개 + wake lock 재획득 + 놓았던 마이크를 다시 연다(못 열면 탭 안내)
let micReleasedByHide = false, pendingToast: string | null = null
on(document, 'visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    // Android 는 백그라운드 앱의 마이크를 무음으로 만든다 → 무음 파일이 되기 전에 저장
    if (isNative() && sessionStore.get().recording) { stopRec(); pendingToast = t('rec.savedOnHide') }
    if (metroStore.get().playing) stopMetro()
    stopDrone()
    if (A.micStream && !sessionStore.get().recording) {
      micReleasedByHide = true; releasingForHide = true
      tunerStore.set({ micReopening: true }) // closeMic 전에 — 닫히는 순간 renderEmpty 가 이 값을 본다
      try { closeMic() } finally { releasingForHide = false }
    } else if (isOpening()) { cancelOpen(); micReleasedByHide = true; tunerStore.set({ micReopening: true }) } // getUserMedia 대기 중 숨겨짐 — 무효화하지 않으면 뒤에서 열린 채 남는다
    return
  }
  resumeIfRunning(); syncWake()
  if (pendingToast) { toast(pendingToast); pendingToast = null }
  // 다시 열릴 때까지 플래그 유지 — 여는 도중 또 숨겨져 busy 로 끝나도 다음 복귀에서 재시도
  if (micReleasedByHide) tryOpenMic().then(ok => { if (ok) micReleasedByHide = false; else if (document.visibilityState === 'visible' && !A.micStream && !isOpening()) showTapHint(tryOpenMic) }) // isOpening: 다른 호출이 여는 중이면 그 위에 버튼을 띄우지 않는다
})
// 편집기가 열려 있는 동안 마이크를 놓는다 — iOS 는 play-and-record 중 스피커 출력을 감쇠한다. 닫으면 자동으로 다시 연다. 녹음 중이면 둔다
let micReleasedByEditor = false
{
  const page = q('editor-page')
  const sync = (): void => {
    const open = page.classList.contains('open')
    if (open && A.micStream && !sessionStore.get().recording) {
      micReleasedByEditor = true; releasingForEditor = true
      tunerStore.set({ micReopening: true }) // 다시 여는 0.2~0.5 초 동안 "켜라" 고 하지 않는다
      try { closeMic() } finally { releasingForEditor = false }
    } else if (open && isOpening()) { cancelOpen(); micReleasedByEditor = true; tunerStore.set({ micReopening: true }) }
    else if (!open && micReleasedByEditor) {
      micReleasedByEditor = false
      // 못 열면 숨김 경로와 같이 시작 버튼으로 받는다
      if (document.visibilityState === 'visible') tryOpenMic().then(ok => { if (!ok && !A.micStream && !isOpening()) showTapHint(tryOpenMic) })
    }
  }
  new MutationObserver(sync).observe(page, { attributes: true, attributeFilter: ['class'] })
}
// 전화·다른 앱 오디오로 컨텍스트가 멈추면: 보일 때 재개 시도, 그래도 안 되면 메트로놈을 멈추고 알린다
let interruptedTimer: ReturnType<typeof setTimeout> | null = null
onContextState(state => {
  if (state === 'running') { if (interruptedTimer) { clearTimeout(interruptedTimer); interruptedTimer = null } if (A.micStream) hideTapHint(); return } // 늦은 resume 뒤에 남는 시작 버튼을 거둔다
  if (state === 'closed') return
  if (!metroStore.get().playing && !droneOn() && !tunerStore.get().running) return // 유휴 suspend 는 정상
  if (document.visibilityState === 'visible') resumeIfRunning()
  if (interruptedTimer) clearTimeout(interruptedTimer)
  interruptedTimer = setTimeout(() => {
    interruptedTimer = null
    if (A.ac && A.ac.state !== 'running' && document.visibilityState === 'visible') {
      if (droneOn()) stopDrone()
      if (metroStore.get().playing) { stopMetro(); toast(t('audio.interruptedMetro')) }
      else if (tunerStore.get().running) { toast(t('audio.interruptedTap')); showResumeHint() }
    }
  }, 1500)
})
// Android 뒤로가기: 열린 화면부터 닫고, 메인이면 앱을 백그라운드로 (종료하지 않음)
onBackButton(() => {
  if (isEditorOpen()) { closeEditor(); return true }
  if (q('settings-page').classList.contains('open')) { closeSettings(); return true }
  if (q('menu-overlay').classList.contains('open')) { hideMenu(); return true }
  if (q('mic-popup-bg').classList.contains('show')) { closeMicPopup(); return true }
  if (dronePopOpen()) { closeDronePop(); return true }
  return false
})
// 설치 앱·홈 화면 웹앱은 이미 전체화면이라 행을 숨긴다
const fsRow = q('fullscreen-row')
if (isNative() || matchMedia('(display-mode: standalone)').matches) fsRow.style.display = 'none'
on(q('fullscreen-btn'), 'click', () => toggleFullscreen(() => toast(t('set.fsUnsupported'))))

/**
 * 오디오가 멈춘 채 남았을 때(사용자 동작 없이 열린 경우 — 예: 새 버전 적용 뒤 자동 새로고침) 시작 버튼을 띄우되,
 * 화면 어디든 첫 터치로도 깨운다. pointerup·keydown 은 브라우저가 '사용자 동작'으로 치는 이벤트다
 */
function showResumeHint(): void {
  const resume = async (): Promise<boolean> => { await A.ac?.resume().catch(() => {}); return A.ac?.state === 'running' }
  showTapHint(resume)
  const any = (): void => { off(); void resume().then(ok => { if (ok) hideTapHint() }) }
  const off = (): void => { document.removeEventListener('pointerup', any, true); document.removeEventListener('keydown', any, true) }
  document.addEventListener('pointerup', any, true); document.addEventListener('keydown', any, true)
}
// 시작 시퀀스: denied 가 확실할 때만 팝업, 그 외는 바로 시도 → 실패하면 탭 안내
// iOS 웹: WebKit 의 wake lock 은 DOM 터치(transient activation)가 필요하고 OS 권한 시트의 탭은 해당 안 됨 → 첫 탭 안에서 먼저 쥔다
const startInGesture = async (): Promise<boolean> => {
  if (settingsStore.get().wakeLock) void acquireWakeLock() // await 전에 — 요청은 동기라 이 탭의 활성화 창 안에서 나간다
  if (await tryOpenMic()) return true
  if (await micPermission() === 'denied') showMicPopup(true) // 탭까지 했는데 안 되면 진짜 차단이다
  return false
}
void (async () => {
  const state = await micPermission()
  if (state === 'denied') { showMicPopup(true); showMicOff(); return }
  if (isIOS() && !isNative() && settingsStore.get().wakeLock) { showTapHint(startInGesture, 'tuner.startSub'); return }
  if (await tryOpenMic()) return
  showTapHint(startInGesture)
})()

// 녹음 복원
openRecDb().then(restoreRecordings).then(recoverInProgress).then(n => { if (n) toast(t('rec.recovered', { n })) }).catch(() => toast(t('rec.dbFailed')))

// Service Worker (웹 PWA 만): 새 버전은 앱이 유휴일 때 적용해 리로드
if (!isNative() && 'serviceWorker' in navigator) {
  const idle = () => !tunerStore.get().running && !metroStore.get().playing && !droneOn() && !sessionStore.get().recording && !isEditorOpen()
  const updateSW = registerSW({
    onNeedRefresh() {
      if (idle()) { void updateSW(true); return }
      toast(t('app.updateReady'), 10000, () => void updateSW(true))
      const tryApply = () => { if (idle()) void updateSW(true); else setTimeout(tryApply, 60 * 1000) }; setTimeout(tryApply, 60 * 1000)
    },
    // 브라우저는 SW 갱신을 탐색할 때만 확인한다 — 홈 화면 PWA 는 탐색이 없어 1시간마다 직접 확인
    onRegisteredSW(_url, reg) { if (reg) setInterval(() => { void reg.update().catch(() => {}) }, 60 * 60 * 1000) },
  })
}

// 진단 훅 (e2e/디버그)
;(window as unknown as { __tt: unknown }).__tt = {
  stats: () => ({ frameMs: lastFrameMs(), acState: A.ac?.state ?? 'none', micOpen: !!A.micStream, sampleRate: A.sampleRate, metroCalibMs: metroCalibMs() }),
  ac: () => A.ac,
  /** 테스트용: 마지막 활동 시각을 과거로 (무활동 감시 검증) */
  backdate: (ms: number) => tunerStore.set({ lastActivityMs: Date.now() - ms }),
  editor: editorDiag,
  closeMic,
  /** 재생 보정 게인 진단 (e2e) */
  playback: playbackDiag,
  tuner: {
    diag: histDiag,
    setHistSec,
    /** @param frames null = 무음 프레임. dualMidi/dualCents 를 주면 중음 프레임, held 를 주면 유지 프레임 */
    inject: (frames: Array<{ cents: number; midi: number; dualMidi?: number; dualCents?: number; held?: number } | null>) => {
      const tol = settingsStore.get().tolCents
      for (const f of frames) {
        const st = tunerStore.get()
        if (!f) tunerStore.set({ frame: st.frame + 1, hz: -1, midi: -1, cents: 0, inTune: false, conf: 0, dualMidi: -1, dualCents: 0 })
        else tunerStore.set({ frame: st.frame + 1, hz: 440 * Math.pow(2, (f.midi - 69) / 12), midi: f.midi, cents: f.cents, inTune: Math.abs(f.cents) <= tol, conf: 0.9, held: f.held ?? 0, dualMidi: f.dualMidi ?? -1, dualCents: f.dualCents ?? 0 })
      }
    },
  },
}
