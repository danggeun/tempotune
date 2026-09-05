/**
 * 조립 지점. 모듈 간 연결(마이크 생명주기 훅, 화면 마운트, 시작 시퀀스)만 여기서 한다.
 * 의존 방향: ui → state ← audio, ui → audio(명령), * → core, audio/ui → platform (설계서 §C1)
 */
import './fonts.css'
import './style.css'
import { settingsStore, tunerStore, metroStore, refToneStore } from './state/index.ts'
import { loadSettings, startSettingsAutosave, onPersistError } from './persist/settings.ts'
import { openRecDb, onDbError } from './persist/recordingsDb.ts'
import { openMic, closeMic, onMic, A, resumeIfRunning, onEngineFatal, setIdleCheck, onContextState, isPermissionError } from './audio/engine.ts'
import { startAnalysis, stopAnalysis, lastFrameMs } from './audio/analysis.ts'
import { restoreRecordings, onRecorderError } from './audio/recorder.ts'
import { initStatusBar, isNative, acquireWakeLock, releaseWakeLock, toggleFullscreen, onBackButton, onWakeLockUnsupported } from './platform/index.ts'
import { q, on } from './ui/dom.ts'
import { toast } from './ui/toast.ts'
import { mountTuner, showTapHint } from './ui/tuner.ts'
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
import { mountEditor, openEditor, closeEditorIfEditing, closeEditor, isEditorOpen } from './ui/editor.ts'
import { stopMetro } from './audio/metronome.ts'

initStatusBar()

// ── 설정 복원 (화면 마운트 전에: 초기 렌더가 복원값을 쓰도록) ──
loadSettings(); startSettingsAutosave()

// ── 화면 ──
mountTuner(); mountRefDrum(); mountMetro(); mountRefPanel(); mountMenu(); mountSettings()
mountTimer(() => { toast('비활성으로 마이크 자동 종료'); closeMic() })
mountRecHeader(); mountRecList(openEditor, closeEditorIfEditing); mountEditor()

// ── 마이크 생명주기 ──
const tryOpenMic = async (): Promise<boolean> => {
  const r = await openMic()
  if (!r.ok && r.error !== 'busy') { if (isPermissionError(r.error) && !isNative()) showMicPopup(true); toast(r.error) }
  return r.ok
}
mountMicPopup(tryOpenMic)
onEngineFatal(toast); onMetroError(toast); onRecorderError(toast); onPersistError(toast); onDbError(toast); onWakeLockUnsupported(toast)
setIdleCheck(() => !metroStore.get().playing && !refToneStore.get().active)
startAnalysis()
onMic('afterOpen', () => { if (settingsStore.get().wakeLock) acquireWakeLock() })
onMic('afterClose', () => { releaseWakeLock(); stopAnalysis(); stopTimer() })
on(q('hdr-mic-btn'), 'click', () => tryOpenMic().then(ok => { if (ok) toast('마이크가 켜졌어요') }))
settingsStore.select(s => s.wakeLock, v => { if (v) { if (tunerStore.get().running) acquireWakeLock() } else releaseWakeLock() })
// ── 생명주기 매트릭스 (설계서 §B7) ──
// 숨김: 오디오는 그대로(마이크 켜져 있으면 분석 계속, 메트로놈은 오디오 스레드). 복귀: 컨텍스트 재개 + 밀린 청크 폐기 + wake lock 재획득.
on(document, 'visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  resumeIfRunning()
  if (tunerStore.get().running && settingsStore.get().wakeLock) acquireWakeLock()
})
// 전화·다른 앱 오디오 등으로 컨텍스트가 멈추면: 화면에 보일 때 재개를 시도하고, 그래도 안 되면 메트로놈을 멈추고 알린다
let interruptedTimer: ReturnType<typeof setTimeout> | null = null
onContextState(state => {
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
  tryOpenMic().then(ok => { if (!ok) { showTapHint(tryOpenMic); toast('마이크 권한을 허용해주세요') } })
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

// ── 진단 훅 (e2e/디버그): 워커 프레임 시간, 컨텍스트 상태 ──
;(window as unknown as { __gp: unknown }).__gp = {
  stats: () => ({ frameMs: lastFrameMs(), acState: A.ac?.state ?? 'none', micOpen: !!A.micStream, sampleRate: A.sampleRate }),
  ac: () => A.ac,
}
