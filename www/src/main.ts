/**
 * 조립 지점. 모듈 간 연결(마이크 생명주기 훅, 화면 마운트, 시작 시퀀스)만 여기서 한다.
 * 의존 방향: ui → state ← audio, ui → audio(명령), * → core, audio/ui → platform (설계서 §C1)
 */
import './style.css'
import { settingsStore, tunerStore, metroStore, refToneStore } from './state/index.ts'
import { loadSettings, startSettingsAutosave } from './persist/settings.ts'
import { openRecDb } from './persist/recordingsDb.ts'
import { openMic, closeMic, onMic, A, resumeIfRunning, onEngineFatal, setIdleCheck } from './audio/engine.ts'
import { startAnalysis, stopAnalysis } from './audio/analysis.ts'
import { restoreRecordings, onRecorderError } from './audio/recorder.ts'
import { initStatusBar, isNative, acquireWakeLock, releaseWakeLock, toggleFullscreen } from './platform/index.ts'
import { q, on } from './ui/dom.ts'
import { toast } from './ui/toast.ts'
import { mountTuner, showTapHint } from './ui/tuner.ts'
import { mountRefDrum } from './ui/refDrum.ts'
import { mountMetro } from './ui/metro.ts'
import { onMetroError } from './audio/metronome.ts'
import { mountRefPanel } from './ui/refPanel.ts'
import { mountMenu } from './ui/menu.ts'
import { mountSettings } from './ui/settings.ts'
import { mountTimer, stopTimer } from './ui/timer.ts'
import { mountMicPopup, showMicPopup } from './ui/micPopup.ts'
import { mountRecHeader } from './ui/recHeader.ts'
import { mountRecList } from './ui/recList.ts'
import { mountEditor, openEditor, closeEditorIfEditing } from './ui/editor.ts'

initStatusBar()

// ── 설정 복원 (화면 마운트 전에: 초기 렌더가 복원값을 쓰도록) ──
loadSettings(); startSettingsAutosave()

// ── 화면 ──
mountTuner(); mountRefDrum(); mountMetro(); mountRefPanel(); mountMenu(); mountSettings()
mountTimer(() => { toast('비활성으로 마이크 자동 종료'); closeMic() })
mountRecHeader(); mountRecList(openEditor, closeEditorIfEditing); mountEditor()

// ── 마이크 생명주기 ──
const tryOpenMic = async (): Promise<boolean> => { const r = await openMic(); if (!r.ok && r.error !== 'busy') toast('마이크 오류: ' + r.error); return r.ok }
mountMicPopup(tryOpenMic)
onEngineFatal(toast); onMetroError(toast); onRecorderError(toast)
setIdleCheck(() => !metroStore.get().playing && !refToneStore.get().active)
startAnalysis()
onMic('afterOpen', () => { if (settingsStore.get().wakeLock) acquireWakeLock() })
onMic('afterClose', () => { releaseWakeLock(); stopAnalysis(); stopTimer() })
on(q('hdr-mic-btn'), 'click', () => tryOpenMic().then(ok => { if (ok) toast('마이크가 켜졌어요') }))
settingsStore.select(s => s.wakeLock, v => { if (v) { if (tunerStore.get().running) acquireWakeLock() } else releaseWakeLock() })
on(document, 'visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  resumeIfRunning() // 마이크·메트로놈·기준음 중 하나라도 살아 있으면 컨텍스트 재개 (전화 등 'interrupted' 포함)
  if (tunerStore.get().running && settingsStore.get().wakeLock) acquireWakeLock()
})
on(q('logo'), 'click', () => toggleFullscreen(() => toast('이 기기에서는 홈 화면에 추가하면 전체화면으로 사용할 수 있어요')))

// ── 시작 시퀀스 (v1 그대로) ──
if (isNative()) {
  tryOpenMic().then(ok => { if (!ok) { showTapHint(tryOpenMic); toast('마이크 권한을 허용해주세요') } })
} else {
  navigator.permissions?.query({ name: 'microphone' as PermissionName })
    .then(p => {
      if (p.state !== 'granted') { showMicPopup(); return }
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
openRecDb().then(restoreRecordings).catch(() => {})
