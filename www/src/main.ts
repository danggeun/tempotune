/**
 * 조립 지점. 모듈 간 연결(마이크 생명주기 훅, 화면 마운트, 시작 시퀀스)만 여기서 한다.
 * 의존 방향: ui → state ← audio, ui → audio(명령), * → core, audio/ui → platform (설계서 §C1)
 */
import './fonts.css'
import './style.css'
import { settingsStore, tunerStore, metroStore, refToneStore, CFG } from './state/index.ts'
import { loadSettings, startSettingsAutosave, onPersistError } from './persist/settings.ts'
import { openRecDb, onDbError } from './persist/recordingsDb.ts'
import { clearLegacyStorage } from './persist/legacy.ts'
import { openMic, closeMic, onMic, A, resumeIfRunning, onEngineFatal, setIdleCheck, onContextState, isPermissionError, isOpening, cancelOpen, untilOpenSettled } from './audio/engine.ts'
import { startAnalysis, lastFrameMs, metroCalibMs } from './audio/analysis.ts'
import { playbackActive, playbackDiag } from './audio/playback.ts'
import { restoreRecordings, onRecorderError } from './audio/recorder.ts'
import { initStatusBar, isNative, isIOS, acquireWakeLock, releaseWakeLock, toggleFullscreen, onBackButton, onWakeLockUnsupported } from './platform/index.ts'
import { q, on } from './ui/dom.ts'
import { toast } from './ui/toast.ts'
import { mountTuner, showTapHint, hideTapHint, setHistSec, histDiag } from './ui/tuner.ts'
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

// v2.1.0 이름 변경으로 버려진 옛 저장소를 한 번 치운다 (읽을 수도 지울 수도 없는 데이터를 남기지 않는다)
clearLegacyStorage()

// ── 설정 복원 (화면 마운트 전에: 초기 렌더가 복원값을 쓰도록) ──
loadSettings(); startSettingsAutosave()

// ── 화면 ──
mountTuner(); mountRefDrum(); mountMetro(); mountRefPanel(); mountMenu(); mountSettings()
mountTimer()
mountRecHeader(); mountRecList(openEditor, closeEditorIfEditing); mountEditor()

// ── 마이크 생명주기 ──
/**
 * 마이크 열기. `popupOnDenied` 는 **사용자가 직접 마이크를 누른 경우에만** 켠다.
 *
 * U2(베타 피드백 #1): 예전에는 권한 오류면 무조건 차단 팝업을 띄웠다. 그런데 iOS 웹앱에서는
 * 제스처 없이 연 호출도 같은 NotAllowedError 로 떨어져서, 실제로 차단되지 않았는데도 실행할 때마다
 * "마이크가 차단돼 있어요" 가 떴다 — "왜 자꾸 물어보냐" 의 정체. 자동 시도의 실패는 팝업이 아니라
 * 가벼운 탭 안내로 받는다.
 */
const tryOpenMic = async (popupOnDenied = false): Promise<boolean> => {
  let r = await openMic()
  // 'busy' = 다른 열기가 진행 중. 그걸 실패로 보고 시작 버튼을 띄우면 곧 열릴 튜너 위에 버튼이 남는다(감사 B12) → 끝나길 기다렸다 한 번 더
  if (!r.ok && r.error === 'busy') {
    await untilOpenSettled()
    if (A.micStream) r = { ok: true }
    else if (document.visibilityState !== 'visible') return false // 기다리는 사이 숨겨졌다 — 뒤에서 열지 않는다(A5). 복귀 핸들러가 다시 부른다
    else { r = await openMic(); if (!r.ok && r.error === 'busy') return false } // 또 busy = 다른 호출이 열고 있다 → 그쪽에 맡긴다(안내 없음)
  }
  // 자동 재개가 끝났다(성공이든 실패든). 'busy' 는 여는 도중 또 숨겨진 것 — 다음 복귀에서 재시도되므로 재개 중 상태를 유지한다 (L4)
  if (r.ok || r.error !== 'busy') tunerStore.set({ micReopening: false })
  if (!r.ok && r.error !== 'busy') {
    if (!isPermissionError(r.error)) toast(r.error)
    else if (popupOnDenied) showMicPopup(true)
    return false
  }
  // 권한 프롬프트를 거치는 동안 사용자 제스처가 만료되면 컨텍스트가 suspended 로 남는다 (iOS/Firefox) → 탭 안내 (모든 경로에서)
  setTimeout(async () => { for (let i = 0; i < 5 && A.ac && A.ac.state !== 'running'; i++) await new Promise(r => setTimeout(r, 250)); if (A.ac && A.ac.state !== 'running' && tunerStore.get().running) showTapHint(async () => { await A.ac?.resume().catch(() => {}); return A.ac?.state === 'running' }) }, 400) // resume 이 느리면 1.5 s 까지 기다린 뒤에만 (B12)
  return r.ok
}
/** 권한 상태. 사파리는 microphone 을 지원하지 않아 null 이 나온다 — 그때는 '모른다' 로 다룬다 */
const micPermission = async (): Promise<PermissionState | null> => {
  try { return (await navigator.permissions?.query({ name: 'microphone' as PermissionName }))?.state ?? null } catch { return null }
}
mountMicPopup(tryOpenMic)
onEngineFatal(toast); onMetroError(toast); onRecorderError(toast); onPersistError(toast); onDbError(toast); onWakeLockUnsupported(toast)
// 유휴 판정에 '녹음 재생 중' 을 포함한다 — 재생이 보정 게인 그래프를 타면 컨텍스트가 잠들 때 무음이 된다 (B12c)
setIdleCheck(() => !metroStore.get().playing && !refToneStore.get().active && !playbackActive())
startAnalysis()
// wake lock: 튜너(마이크) 또는 메트로놈이 살아 있는 동안 — 메트로놈만 켠 채 화면이 꺼지면 WebView 가 얼어 박자가 멈춘다 (리뷰 #9)
const wantWake = () => settingsStore.get().wakeLock && (tunerStore.get().running || metroStore.get().playing)
const syncWake = () => { if (wantWake()) acquireWakeLock(); else releaseWakeLock() }
onMic('afterOpen', syncWake)
// 타이머는 사용자가 직접 켜고 끄는 것이라 마이크가 닫힐 때 같이 멈춘다(무활동·수동 종료). 단 **화면 숨김으로 잠시 놓는 것**(P1)은
// 연습이 끝난 게 아니므로 타이머를 건드리지 않는다 — 악보 앱을 잠깐 보고 돌아와도 경과 시간이 이어진다
let releasingForHide = false, releasingForEditor = false
onMic('afterClose', () => { if (!releasingForHide && !releasingForEditor) stopTimer(); syncWake(); stopInactivityWatch() })
metroStore.select(s => s.playing, syncWake)
// 15분 무활동 자동 종료 — 연습 타이머와 무관하게 마이크가 켜져 있으면 항상 감시 (리뷰 #3: v1/이전 구현은 타이머 안에서만 검사했다)
let inactInt: ReturnType<typeof setInterval> | null = null
function stopInactivityWatch(): void { if (inactInt) clearInterval(inactInt); inactInt = null }
// 마이크를 열 때 활동 시각을 새로 잡는다 — 이걸 안 하면 "앱을 15분 넘게 켜둔 뒤 마이크를 (다시) 켠 순간" 바로 자동 종료된다.
// P1(숨김 → 복귀 시 마이크 재개)이 이 상황을 매번 만든다. 뜻은 '마이크가 켜진 뒤 15분간 소리가 없으면' 이다.
onMic('afterOpen', () => { tunerStore.set({ lastActivityMs: Date.now() }); stopInactivityWatch(); inactInt = setInterval(() => { if (Date.now() - tunerStore.get().lastActivityMs > CFG.inactiveMs) { toast('15분 동안 소리가 없어 마이크를 껐어요'); closeMic(); showTapHint(tryOpenMic) } }, 30 * 1000) })
on(q('hdr-mic-btn'), 'click', () => tryOpenMic(true).then(ok => { if (ok) toast('마이크가 켜졌어요') })) // 직접 누른 것이므로 차단이면 안내한다
settingsStore.select(s => s.wakeLock, syncWake)
// ── 생명주기 매트릭스 (설계서 §B7, v2.0.3 P1 개정) ──
// 숨김: **마이크를 놓고 메트로놈도 멈춘다.**
//   · 마이크 — 숨겨진 동안 튜너는 볼 수 없으니 쥐고 있을 이유가 없고, 쥐고 있으면 안드로이드에서 다른 앱(폰 녹음기 등)이
//     마이크를 못 쓰거나 묵음 스트림을 받는다(실측: 사용자 녹음 34초 중 4초만 소리, 나머지는 정확히 0). 웹에서 녹음 중이면 놓지 않는다.
//   · 메트로놈 — v2.3.1 까지는 그냥 뒀다. 오디오 워클릿은 화면과 무관하게 도는 게 설계이고 "플랫폼이 알아서 멈추겠지" 라고 봤는데,
//     **안드로이드 웹앱 실측에서 앱을 나가도 계속 울렸다**(v2.3.2 M11). 나간 앱이 계속 소리를 내는 건 사고지 기능이 아니다 —
//     화면을 못 보는 동안 박을 맞출 수도 없다. 그래서 숨김과 함께 멈춘다. 돌아왔을 때 **자동으로 다시 켜지지는 않는다**(놀라게 하지 않는다).
//     화면 잠금도 hidden 을 내지만, '화면 항상 켜짐'(기본 켜짐)이 연습 중 화면을 지켜 준다.
// 복귀: 컨텍스트 재개 + 밀린 청크 폐기 + wake lock 재획득 + **놓았던 마이크를 다시 연다**(권한은 같은 세션이라 다시 묻지 않는다;
//       못 열면 기존과 같은 '탭하여 시작' 안내).
let micReleasedByHide = false, pendingToast: string | null = null
on(document, 'visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    // Android 는 백그라운드 앱의 마이크를 무음으로 만든다(포그라운드 서비스 없이는) → 녹음이 무음 파일이 되기 전에 저장 (리뷰 #2)
    if (isNative() && sessionStore.get().recording) { stopRec(); pendingToast = '앱이 뒤로 가서 녹음을 저장했어요' }
    if (metroStore.get().playing) stopMetro() // M11: 나간 앱이 계속 딱딱거리지 않게
    if (A.micStream && !sessionStore.get().recording) {
      micReleasedByHide = true; releasingForHide = true
      tunerStore.set({ micReopening: true }) // closeMic 전에 — 닫히는 순간 renderEmpty 가 이 값을 본다 (L4)
      try { closeMic() } finally { releasingForHide = false }
    } else if (isOpening()) { cancelOpen(); micReleasedByHide = true; tunerStore.set({ micReopening: true }) } // getUserMedia 를 기다리는 중에 숨겨짐 — 무효화하지 않으면 뒤에서 열린 채 남는다 (감사 A5)
    return
  }
  resumeIfRunning(); syncWake()
  if (pendingToast) { toast(pendingToast); pendingToast = null }
  // 다시 열릴 때까지 플래그를 유지한다 — 여는 도중에 또 숨겨져 'busy' 로 끝나도 다음 복귀에서 다시 시도된다
  if (micReleasedByHide) tryOpenMic().then(ok => { if (ok) micReleasedByHide = false; else if (document.visibilityState === 'visible' && !A.micStream && !isOpening()) showTapHint(tryOpenMic) }) // isOpening: 다른 호출이 여는 중이면 그 위에 버튼을 띄우지 않는다 (B12)
})
/**
 * 편집기가 열려 있는 동안에는 마이크를 놓는다 (K6).
 * 왜 세 가지가 한꺼번에 좋아진다:
 *   ① 녹음을 **듣는** 화면이라 튜너가 돌 이유가 없다 (배터리·워커)
 *   ② iOS 는 'play-and-record' 인 동안 스피커 출력을 감쇠하거나 수화기로 돌린다(B12,
 *      "폰 볼륨 최대인데 30 % 수준"). 마이크를 놓아야 재생이 제 음량으로 나온다
 *   ③ OS 의 마이크 사용 표시가 그동안 사라진다 — 사용자가 "계속 떠 있다" 고 지적한 그것
 * 튜너로 돌아오면 **자동으로 다시 연다.** 사용자가 뭘 눌러야 하는 상황은 만들지 않는다 —
 * "튜너 사용에 무조건 문제가 없어야 한다" 가 이 항목의 상위 제약이다.
 * 녹음 중이면 건드리지 않는다(녹음이 끊기면 안 된다 — P1 과 같은 규칙).
 */
/** 편집기(K6)만. 메트로놈 전용 모드도 v2.3.2 까지는 여기 묶여 있었지만(K10) v2.3.3(N1)부터 "펼침의 2단계" 라 마이크를 건드리지 않는다 —
 *  헤더의 REC 가 그대로 살아 있는 화면에서 마이크를 놓으면, 녹음하려고 MIC 를 다시 켜는 탭이 생긴다. 편집기는 여전히 '듣는 화면' 이라 놓는다. */
let micReleasedByEditor = false
{
  const page = q('editor-page')
  const sync = (): void => {
    const open = page.classList.contains('open')
    if (open && A.micStream && !sessionStore.get().recording) {
      micReleasedByEditor = true; releasingForEditor = true
      tunerStore.set({ micReopening: true }) // 편집기를 나오면 스스로 다시 연다 — 그 0.2~0.5 초 동안 "켜라" 고 하지 않는다 (L4)
      try { closeMic() } finally { releasingForEditor = false }
    } else if (open && isOpening()) { cancelOpen(); micReleasedByEditor = true; tunerStore.set({ micReopening: true }) } // 감사 A5
    else if (!open && micReleasedByEditor) {
      micReleasedByEditor = false
      // 못 열면 숨김 경로와 같이 시작 버튼으로 받는다 — 전엔 조용히 실패해 "MIC 를 켜면 시작해요" 만 남았다 (감사 B13)
      if (document.visibilityState === 'visible') tryOpenMic().then(ok => { if (!ok && !A.micStream && !isOpening()) showTapHint(tryOpenMic) })
    }
  }
  new MutationObserver(sync).observe(page, { attributes: true, attributeFilter: ['class'] })
}
// 전화·다른 앱 오디오 등으로 컨텍스트가 멈추면: 화면에 보일 때 재개를 시도하고, 그래도 안 되면 메트로놈을 멈추고 알린다
let interruptedTimer: ReturnType<typeof setTimeout> | null = null
onContextState(state => {
  if (state === 'running') { if (interruptedTimer) { clearTimeout(interruptedTimer); interruptedTimer = null } if (A.micStream) hideTapHint(); return } // 마이크가 열려 있고 컨텍스트가 돌면 시작 버튼은 할 일이 없다 — 늦은 resume 뒤에 남던 버튼 (B12)
  if (state === 'closed') return
  if (!metroStore.get().playing && !tunerStore.get().running) return // 유휴 suspend 는 정상
  if (document.visibilityState === 'visible') resumeIfRunning()
  if (interruptedTimer) clearTimeout(interruptedTimer)
  interruptedTimer = setTimeout(() => {
    interruptedTimer = null
    if (A.ac && A.ac.state !== 'running' && document.visibilityState === 'visible') {
      if (metroStore.get().playing) { stopMetro(); toast('오디오가 중단되어 메트로놈을 멈췄어요') }
      else if (tunerStore.get().running) { toast('오디오가 중단됐어요 — 화면을 탭하면 다시 시작해요'); showTapHint(async () => { await A.ac?.resume().catch(() => {}); return A.ac?.state === 'running' }) } // 말만 하고 핸들러가 없던 것 (감사 A6)
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
// 전체화면 토글 (L10: 워드마크 탭에서 설정으로). 설치 앱·홈 화면 웹앱은 이미 전체화면이라 행을 숨긴다 — 안 되는 버튼을 보여주지 않는다
const fsRow = q('fullscreen-row')
if (isNative() || matchMedia('(display-mode: standalone)').matches) fsRow.style.display = 'none'
on(q('fullscreen-btn'), 'click', () => toggleFullscreen(() => toast('이 기기에서는 홈 화면에 추가하면 전체화면으로 사용할 수 있어요')))

// ── 시작 시퀀스 ──
// U2: 튜너에 마이크가 필요한 건 자명하다. 우리가 한 번 더 묻지 않는다 — 들어오면 바로 연다.
// 팝업은 '문 앞의 관문' 이 아니라 **정말 차단됐을 때의 안내** 로만 쓴다.
//   · 권한이 확실히 denied → 안내 팝업 (설정에서 풀어야 하므로 경로를 알려줘야 한다)
//   · 그 외(prompt · 모름) → 바로 시도. 실패하면 탭 안내로 받고, 탭한 뒤에도 denied 면 그때 팝업.
// 사파리는 권한 API 가 없어 항상 '모름' 이다 → 자동 시도 → 실패 시 탭 안내. 매번 뜨던 팝업이 사라진다.
// iOS 웹(사파리·홈 화면 앱)은 예외 (v2.3.3 N7): WebKit 의 WakeLock.cpp 는 화면 켜짐 요청에 **DOM 터치(transient activation)** 를 요구하고,
// 그 허가는 페이지 객체에만 남아 앱을 껐다 켜면 사라진다. OS 권한 시트의 "허용" 은 DOM 터치가 아니다. 그래서 손대지 않고 마이크를
// 열면(U2) 그 뒤 어떤 요청도 거부돼 튜닝 중 화면이 꺼졌다. iOS 웹에서는 첫 탭을 받고 **그 탭 안에서** 화면 켜짐을 먼저 쥔 뒤
// 마이크를 연다 — 사용자에겐 "탭 → 허용" 한 흐름. 안드로이드·데스크톱은 이 문이 없어 그대로 자동.
const startInGesture = async (): Promise<boolean> => {
  if (settingsStore.get().wakeLock) void acquireWakeLock() // await 전에 — 요청 자체는 동기라 이 탭의 활성화 창 안에서 나간다
  if (await tryOpenMic()) return true
  if (await micPermission() === 'denied') showMicPopup(true) // 탭까지 했는데 안 되면 진짜 차단이다
  return false
}
void (async () => {
  const state = await micPermission()
  if (state === 'denied') { showMicPopup(true); return }
  if (isIOS() && !isNative() && settingsStore.get().wakeLock) { showTapHint(startInGesture, '마이크 사용을 물어볼게요'); return }
  if (await tryOpenMic()) return
  showTapHint(startInGesture)
})()

// ── 녹음 복원 ──
openRecDb().then(restoreRecordings).catch(() => toast('녹음 저장소를 열 수 없어요 — 녹음은 이번 세션에만 남아요'))

// ── Service Worker (웹 PWA 만): 새 버전은 앱이 유휴일 때 적용해 리로드 — 연습 중에 화면이 갈리지 않게 ──
if (!isNative() && 'serviceWorker' in navigator) {
  const idle = () => !tunerStore.get().running && !metroStore.get().playing && !sessionStore.get().recording && !isEditorOpen()
  const updateSW = registerSW({
    onNeedRefresh() {
      if (idle()) { void updateSW(true); return }
      toast('새 버전이 준비됐어요 · 탭해서 적용', 10000, () => void updateSW(true))
      const tryApply = () => { if (idle()) void updateSW(true); else setTimeout(tryApply, 60 * 1000) }; setTimeout(tryApply, 60 * 1000)
    },
    // 브라우저는 SW 갱신을 '탐색할 때' 만 확인한다 — 튜너를 켜두고 며칠 쓰는 사용법(PWA 를 홈 화면에 둔 경우)에서는
    // 탐색이 일어나지 않아 새 버전이 영영 안 온다. 1시간마다 직접 확인한다. 적용은 여전히 유휴일 때만(위 onNeedRefresh). (R5)
    onRegisteredSW(_url, reg) { if (reg) setInterval(() => { void reg.update().catch(() => {}) }, 60 * 60 * 1000) },
  })
}

// ── 진단 훅 (e2e/디버그): 워커 프레임 시간, 컨텍스트 상태 ──
;(window as unknown as { __tt: unknown }).__tt = {
  stats: () => ({ frameMs: lastFrameMs(), acState: A.ac?.state ?? 'none', micOpen: !!A.micStream, sampleRate: A.sampleRate, metroCalibMs: metroCalibMs() }),
  ac: () => A.ac,
  /** 테스트용: 마지막 활동 시각을 과거로 (무활동 감시 검증) */
  backdate: (ms: number) => tunerStore.set({ lastActivityMs: Date.now() - ms }),
  editor: editorDiag,
  closeMic,
  /**
   * 트레이스 진단/주입 (e2e·비교 렌더 전용). 합성 프레임을 그대로 밀어넣어 캔버스를 결정적으로 그린다 —
   * 실제 연주 없이 "음이 바뀔 때 가로줄이 그어지는가"(C1)를 픽셀로 검증할 수 있다.
   */
  /** 재생 보정 게인 진단 (e2e) */
  playback: playbackDiag,
  tuner: {
    diag: histDiag,
    setHistSec,
    /** @param frames null = 무음 프레임. dualMidi/dualCents 를 주면 중음 프레임 (B17). held 를 주면 유지 프레임 (T1) */
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
