/**
 * 조립 지점. 모듈 간 연결(마이크 생명주기 훅, 화면 마운트, 시작 시퀀스)만 여기서 한다.
 * 의존 방향: ui → state ← audio, ui → audio(명령), * → core, audio/ui → platform (설계서 §C1)
 */
import './fonts.css'
import './style.css'
import { settingsStore, tunerStore, metroStore, refToneStore, CFG } from './state/index.ts'
import { loadSettings, startSettingsAutosave, onPersistError } from './persist/settings.ts'
import { openRecDb, onDbError } from './persist/recordingsDb.ts'
import { openMic, closeMic, onMic, A, resumeIfRunning, onEngineFatal, setIdleCheck, onContextState, isPermissionError } from './audio/engine.ts'
import { startAnalysis, lastFrameMs } from './audio/analysis.ts'
import { restoreRecordings, onRecorderError } from './audio/recorder.ts'
import { initStatusBar, isNative, acquireWakeLock, releaseWakeLock, toggleFullscreen, onBackButton, onWakeLockUnsupported } from './platform/index.ts'
import { q, on } from './ui/dom.ts'
import { toast } from './ui/toast.ts'
import { mountTuner, showTapHint, setAudioDot } from './ui/tuner.ts'
import { mountRefDrum } from './ui/refDrum.ts'
import { mountMetro } from './ui/metro.ts'
import { onMetroError } from './audio/metronome.ts'
import { mountRefPanel } from './ui/refPanel.ts'
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

initStatusBar()

// ── 설정 복원 (화면 마운트 전에: 초기 렌더가 복원값을 쓰도록) ──
loadSettings(); startSettingsAutosave()

// ── 화면 ──
mountTuner(); mountRefDrum(); mountMetro(); mountRefPanel(); mountMenu(); mountSettings()
mountTimer()
mountRecHeader(); mountRecList(openEditor, closeEditorIfEditing); mountEditor()

// ── 마이크 생명주기 ──
const tryOpenMic = async (): Promise<boolean> => {
  const r = await openMic()
  if (!r.ok && r.error !== 'busy') { if (isPermissionError(r.error)) showMicPopup(true); else toast(r.error); return false } // 권한 문제는 팝업(앱: 시스템 설정 경로), 그 외는 토스트
  // 권한 프롬프트를 거치는 동안 사용자 제스처가 만료되면 컨텍스트가 suspended 로 남는다 (iOS/Firefox) → 탭 안내 (모든 경로에서)
  setTimeout(() => { if (A.ac && A.ac.state !== 'running' && tunerStore.get().running) showTapHint(async () => { await A.ac?.resume().catch(() => {}); return A.ac?.state === 'running' }) }, 400)
  return r.ok
}
mountMicPopup(tryOpenMic)
onEngineFatal(toast); onMetroError(toast); onRecorderError(toast); onPersistError(toast); onDbError(toast); onWakeLockUnsupported(toast)
setIdleCheck(() => !metroStore.get().playing && !refToneStore.get().active)
startAnalysis()
// wake lock: 튜너(마이크) 또는 메트로놈이 살아 있는 동안 — 메트로놈만 켠 채 화면이 꺼지면 WebView 가 얼어 박자가 멈춘다 (리뷰 #9)
const wantWake = () => settingsStore.get().wakeLock && (tunerStore.get().running || metroStore.get().playing)
const syncWake = () => { if (wantWake()) acquireWakeLock(); else releaseWakeLock() }
onMic('afterOpen', syncWake)
onMic('afterClose', () => { stopTimer(); syncWake(); stopInactivityWatch() })
metroStore.select(s => s.playing, syncWake)
// 15분 무활동 자동 종료 — 연습 타이머와 무관하게 마이크가 켜져 있으면 항상 감시 (리뷰 #3: v1/이전 구현은 타이머 안에서만 검사했다)
let inactInt: ReturnType<typeof setInterval> | null = null
function stopInactivityWatch(): void { if (inactInt) clearInterval(inactInt); inactInt = null }
onMic('afterOpen', () => { stopInactivityWatch(); inactInt = setInterval(() => { if (Date.now() - tunerStore.get().lastActivityMs > CFG.inactiveMs) { toast('15분 동안 소리가 없어 마이크를 껐어요'); closeMic() } }, 30 * 1000) })
on(q('hdr-mic-btn'), 'click', () => tryOpenMic().then(ok => { if (ok) toast('마이크가 켜졌어요') }))
settingsStore.select(s => s.wakeLock, syncWake)
// ── 생명주기 매트릭스 (설계서 §B7) ──
// 숨김: 오디오는 그대로(마이크 켜져 있으면 분석 계속, 메트로놈은 오디오 스레드). 복귀: 컨텍스트 재개 + 밀린 청크 폐기 + wake lock 재획득.
on(document, 'visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    // Android 는 백그라운드 앱의 마이크를 무음으로 만든다(포그라운드 서비스 없이는) → 녹음이 무음 파일이 되기 전에 저장 (리뷰 #2)
    if (isNative() && sessionStore.get().recording) { stopRec(); toast('앱이 뒤로 가서 녹음을 저장했어요') }
    return
  }
  resumeIfRunning(); syncWake()
})
// 오디오 상태 점: 마이크가 열려 있고 컨텍스트가 돌면 초록, 마이크는 열렸는데 컨텍스트가 멈춰 있으면(탭 필요·중단) 앰버, 마이크 꺼짐이면 숨김
const syncAudioDot = () => { const t = tunerStore.get(); setAudioDot(!t.running ? 'off' : A.ac?.state === 'running' ? 'on' : 'warn') }
tunerStore.select(s => s.running, syncAudioDot)
setTimeout(syncAudioDot, 500) // 자동 시작 경로에서 running 이 먼저 서고 컨텍스트가 늦게 도는 경우
// 전화·다른 앱 오디오 등으로 컨텍스트가 멈추면: 화면에 보일 때 재개를 시도하고, 그래도 안 되면 메트로놈을 멈추고 알린다
let interruptedTimer: ReturnType<typeof setTimeout> | null = null
onContextState(state => {
  syncAudioDot()
  if (state === 'running') { if (interruptedTimer) { clearTimeout(interruptedTimer); interruptedTimer = null } return }
  if (state === 'closed') return
  if (!metroStore.get().playing && !tunerStore.get().running) return // 유휴 suspend 는 정상
  if (document.visibilityState === 'visible') resumeIfRunning()
  if (interruptedTimer) clearTimeout(interruptedTimer)
  interruptedTimer = setTimeout(() => {
    interruptedTimer = null
    if (A.ac && A.ac.state !== 'running' && document.visibilityState === 'visible') {
      if (metroStore.get().playing) { stopMetro(); toast('오디오가 중단되어 메트로놈을 멈췄어요') }
      else if (tunerStore.get().running) toast('오디오가 중단됐어요 — 화면을 탭하면 다시 시작해요')
    }
  }, 1500)
})
// Android 뒤로가기: 열린 화면부터 닫고, 메인이면 앱을 백그라운드로 (종료하지 않음)
onBackButton(() => {
  if (isEditorOpen()) { closeEditor(); return true }
  if (q('settings-page').classList.contains('open')) { closeSettings(); return true }
  if (q('menu-overlay').classList.contains('open')) { hideMenu(); return true }
  if (q('mic-popup-bg').classList.contains('show')) { closeMicPopup(); return true }
  return false
})
on(q('logo'), 'click', () => toggleFullscreen(() => toast('이 기기에서는 홈 화면에 추가하면 전체화면으로 사용할 수 있어요')))

// ── 시작 시퀀스 (v1 그대로) ──
if (isNative()) {
  // 첫 실행엔 OS 권한 다이얼로그 전에 '왜 필요한지' 를 한 번 보여준다 (팝업의 '마이크 켜기' 가 OS 다이얼로그를 띄운다). 그 뒤로는 바로 시도
  let intro = false; try { intro = !localStorage.getItem('gp_mic_intro') } catch { /* */ }
  if (intro) { try { localStorage.setItem('gp_mic_intro', '1') } catch { /* */ } showMicPopup(false) }
  else tryOpenMic().then(ok => { if (!ok) showTapHint(tryOpenMic) })
} else {
  navigator.permissions?.query({ name: 'microphone' as PermissionName })
    .then(p => {
      if (p.state !== 'granted') { showMicPopup(p.state === 'denied'); p.onchange = () => { if (p.state === 'granted') closeMicPopup() }; return }
      tryOpenMic().then(ok => {
        if (!ok) { showTapHint(tryOpenMic); return }
        // 자동 시작 시 AudioContext 가 suspended 일 수 있음 (Chrome 자동재생 정책)
        setTimeout(() => {
          if (A.ac && A.ac.state === 'suspended') showTapHint(async () => { await A.ac?.resume().catch(() => {}); return A.ac?.state === 'running' })
        }, 400)
      })
    })
    .catch(() => showMicPopup())
}

// ── 녹음 복원 ──
openRecDb().then(restoreRecordings).catch(() => toast('녹음 저장소를 열 수 없어요 — 녹음은 이번 세션에만 남아요'))

// ── Service Worker (웹 PWA 만): 새 버전은 앱이 유휴일 때 적용해 리로드 — 연습 중에 화면이 갈리지 않게 ──
if (!isNative() && 'serviceWorker' in navigator) {
  const idle = () => !tunerStore.get().running && !metroStore.get().playing && !sessionStore.get().recording && !isEditorOpen()
  const updateSW = registerSW({
    onNeedRefresh() { const tryApply = () => { if (idle()) void updateSW(true); else setTimeout(tryApply, 60 * 1000) }; tryApply() },
  })
}

// ── 진단 훅 (e2e/디버그): 워커 프레임 시간, 컨텍스트 상태 ──
;(window as unknown as { __gp: unknown }).__gp = {
  stats: () => ({ frameMs: lastFrameMs(), acState: A.ac?.state ?? 'none', micOpen: !!A.micStream, sampleRate: A.sampleRate }),
  ac: () => A.ac,
  /** 테스트용: 마지막 활동 시각을 과거로 (무활동 감시 검증) */
  backdate: (ms: number) => tunerStore.set({ lastActivityMs: Date.now() - ms }),
  editor: editorDiag,
  closeMic,
}
