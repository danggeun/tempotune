# Go practice — 아키텍처

이 문서는 "왜 이런 구조인가"를 두 쪽으로 설명한다. 대안과 기각 이유는 [DESIGN.md](DESIGN.md), UI 의도는 [UX-AUDIT.md](UX-AUDIT.md) 에 있다.

## 1. 층 구조

```
www/src/
  main.ts      조립만 — 모듈 연결과 시작 시퀀스 (마이크 자동 시도, 권한 팝업, SW 등록, 뒤로가기, 진단 훅 window.__gp)
  ui/          카드별 DOM 바인딩: tuner, refDrum, metro, refPanel(기준음 버튼), menu, settings, timer,
               micPopup, recHeader, recList, editor, toast. mount*() 가 바인딩 + 스토어 구독
  audio/       Web Audio 어댑터: engine(단일 AudioContext·마이크 세션), analysis(+worker), capture.worklet,
               metronome(+metro.worklet), refTone, recorder, messages(메시지 타입)
  state/       도메인별 스토어 (settings / tuner / metro / refTone / session / recList). 타입의 유일한 원천
  persist/     localStorage 설정(v2, v1 마이그레이션), IndexedDB 녹음(v3)
  platform/    웹 / Capacitor 분기 (상태바, wake lock, 전체화면, 파일 저장, 뒤로가기)
  core/        순수 알고리즘. 브라우저 API 금지, 전부 단위 테스트:
               pitch/(fft, yinFast, spectrum, tracker, analyzer) · playing/detector · metro/sequencer
               note(도레미/CDE), wav, peaks, format, recPolicy(보관 정책)
```

허용된 의존 (`scripts/check-deps.mjs` 가 import 문을 검사, `npm run check` 에 포함):

| 층 | import 가능 |
|---|---|
| core | core |
| state | state, core |
| persist | persist, state, core |
| platform | platform |
| audio | audio, core, state, persist, platform |
| ui | ui, core, state, audio(명령 호출만), platform |

원칙: **`ui` 는 `audio` 의 상태를 직접 읽지 않는다** — `audio` 가 스토어에 쓰고 `ui` 는 스토어를 구독한다. 흐름이 `ui → audio(명령) → store → ui(구독)` 한 방향이라 기능을 더할 때 어디가 깨질지 예측할 수 있다.
프레임워크 없음: 스토어는 `createStore(initial)` 의 `get / set(얕은 병합) / select(값이 바뀔 때만 알림)` 세 함수뿐이다. 스타일은 `style.css` 의 토큰(`:root`)만 쓴다 — 컴포넌트 규칙에 색·크기 리터럴을 새로 쓰지 않는다.

## 2. 오디오 파이프라인

```
마이크 ─ getUserMedia ─▶ AudioWorkletNode (capture.worklet)      ← 오디오 스레드, 128 샘플마다
                            │  1024 샘플씩 모아 transferable Float32Array (버퍼 재활용)
                            │  MessagePort 직결 (메인 스레드 경유 없음)
                            ▼
                     Analysis Worker (analysis.worker)          ← 워커 스레드, ≈43 Hz
                       링버퍼 → 4096 창 → FFT-YIN(f0, 신뢰도) → 스펙트럼(옥타브 교정, 배음 수, 평탄도)
                       → 트래커(신뢰도 가중 중앙값, 음이름 히스테리시스, 비브라토 적응 평활)
                       → 연주 감지 상태기계(attack / hold / 드리프트)
                       기준음 ≠ 440 은 트래커 앞에서 정규화 (격자는 A=440), 표시에서 되돌림
                            │  {hz, midi, cents, inTune, conf, rms, playing}
                            ▼
                     main: tunerStore.set(...)                  ← 초당 ≈43회, DOM 안 만짐
                            ▼
                     ui/tuner: requestAnimationFrame 에서 최신 값만 렌더 (음이름·게이지·히스토리 캔버스)
```

- **단일 `AudioContext`** (engine.ts). 첫 사용자 제스처에서 생성, 마이크는 소스 노드 연결/해제만. 유휴(마이크·메트로놈·기준음 없음)면 `suspend()` 해 오디오 포커스를 돌려준다. 마이크 세션은 토큰(`micGen`)으로 식별해, 여는 도중 닫혀도 옛 세션이 이어지지 않는다.
- 샘플레이트를 강제하지 않는다 (Android 다수가 48 kHz). 모든 계산은 `sr` 파라미터.
- SharedArrayBuffer 미사용: COOP/COEP 헤더를 GitHub Pages·Capacitor 로컬 스킴에서 못 건다.
- **메트로놈은 별도 워클릿** (metro.worklet + core/metro/sequencer): 샘플 카운터로 다음 클릭 위치를 계산해 클릭을 직접 합성. BPM/박자/음량은 port 메시지로 다음 박부터. 화면이 꺼져도 오디오 스레드는 스로틀되지 않는다. 클릭 시각(출력 지연 반영)을 워커에 알리면 그 창의 프레임은 버리지 않고 **신뢰도를 낮춰** 처리한다 — 버리면 빠른 템포에서 튜너가 얼어붙는다.
- 기준음(refTone)은 같은 컨텍스트의 오실레이터. 녹음(recorder)은 MediaRecorder(webm/opus 우선) + 녹음 중 피크 누적(파형용). 세션 상태는 클로저에 가둬 정지 직후 재시작해도 섞이지 않는다.

## 3. 데이터

| 무엇 | 어디 | 스키마 |
|---|---|---|
| 설정 | `localStorage["gopractice_settings_v1"]` | `{v:2, …}` — 키 이름은 v1 호환. 읽을 때 값 범위까지 검증(refHz 410–466, 허용 오차 5단계, 음량 0–1) |
| 녹음 | IndexedDB `gopractice_rec` **v3** | `recordings`(id, name, ts, dur, mime, blob) + `meta`(북마크, A-B, 파형 피크, 마지막 속도) 분리 — 편집 정보 저장이 blob 을 다시 쓰지 않게 |
| 보관 정책 | `core/recPolicy` | 30일 TTL(설정에서 끌 수 있음), 마지막 7일 예고, 60분 벽시계 상한 자동 저장 |

Capacitor 는 `androidScheme: https` 를 쓴다. **이 값을 바꾸면 origin 이 바뀌어 위 데이터가 전부 사라진다.**

## 4. 플랫폼 분기

`platform/index.ts` 만 `window.Capacitor` 를 본다. 나머지는 `saveFile`, `acquireWakeLock`, `onBackButton`, `initStatusBar` 같은 함수만 호출한다.

| 기능 | 웹 | Android 앱 |
|---|---|---|
| 파일 저장 | `<a download>` | `@capacitor/filesystem`(캐시) → `@capacitor/share` 시트 |
| 화면 켜짐 | Wake Lock API | 동일 |
| 상태바 | — | `@capacitor/status-bar`, 라이트/다크 (Android 15 엣지투엣지에서는 스타일만 유효, 여백은 CSS safe-area) |
| 권한 | `permissions.query` 로 미결정/거부 분기 팝업 | 첫 실행 안내 팝업 → OS 다이얼로그, 거부 시 시스템 설정 경로 안내 |
| 뒤로가기 | — | `@capacitor/app` backButton: 편집기 → 설정 → 메뉴 → 팝업 순으로 닫고, 메인에서는 `minimizeApp` |
| Service Worker | 등록 (프리캐시, prompt 모드 — 유휴일 때만 적용) | 등록 안 함 (파일이 로컬) |

빌드는 두 종류: `npm run build` (base `/go_practice/`, Pages) 와 `npm run build:cap` (base `/`, Google Fonts 링크 제거, Capacitor `webDir: dist`).

## 5. 검증 백본 — "사람이 연주하지 않고 확신하는 법"

| 층 | 도구 | 무엇을 |
|---|---|---|
| 순수 알고리즘 | Vitest (`*.test.ts`, 73개) | YIN cents 오차, 트래커, 감지기, 시퀀서, 기준음 보정, WAV, 설정 마이그레이션 |
| 튜너 벤치마크 | `npm run bench` | `scripts/gen-signals.mjs` 가 결정적 난수로 합성한 현악기·잡음·말소리 신호 39개(`test-assets/signals/`, gitignore)를 v1/v2 어댑터에 넣어 bias·p90·옥타브 오류·락 지연·F1·프레임 ms 를 표로 |
| 브라우저 통합 | `npm run e2e` (`scripts/e2e.mjs`, 38 시나리오) | 헤드리스 Chromium 에 `--use-file-for-fake-audio-capture=<wav>` 로 WAV 를 마이크로 주입. "440 Hz 를 넣으면 라 4 가 뜨는가", A=415 회귀, 권한 거부, 메트로놈 샘플 정확도(OfflineAudioContext), 녹음→편집→저장, 무활동 종료, SW 등록. 앱은 `window.__gp` 진단 훅을 노출 |
| 시각 회귀 | `npm run shots` (`scripts/screenshots.mjs`) | 390×844 @2x, 라이트/다크 × main/metro_open/menu/settings/editor/popup 12장을 `test-assets/screens/baseline/` 과 pixelmatch. 무음 WAV 를 주입해 바늘을 고정 |
| 디자인 비교 | `scripts/ux-compare.mjs` | 여러 dist(+오버라이드 CSS)를 같은 시나리오로 찍어 나란히 |
| 모듈 경계 | `scripts/check-deps.mjs` | §1 표 위반, `core` 의 브라우저 API 사용 |

CI(`.github/workflows/ci.yml`)가 push/PR 마다 check → build(두 base) → e2e → shots 를 돌린다. `deploy-pages.yml` 은 `main` push 때 Pages 배포.

## 6. Android 릴리즈

`android/` 는 생성물이라 리포에 없다. 매번 같은 순서:

```bash
npx cap add android      # 처음 한 번. appId/appName 이 이 시점에 박힌다 (capacitor.config.json)
npm run cap:assets       # resources/icon.png · icon-foreground.png · icon-background.png → 런처(adaptive) 아이콘
npm run cap:sync         # 빌드(base=/) + 복사 + 플러그인 등록 + scripts/cap-manifest.mjs
npx cap open android     # Android Studio
```

`cap-manifest.mjs` 는 (1) `RECORD_AUDIO` / `MODIFY_AUDIO_SETTINGS` / `INTERNET` 권한과 `uses-feature microphone required=false`, (2) `screenOrientation="portrait"`, (3) `build.gradle` 의 `versionName`(= package.json version) / `versionCode`(= major·10000 + minor·100 + patch) 를 보정한다. **버전을 올릴 때는 package.json 의 `version` 만 올리면 된다.** 웹 코드를 바꿀 때마다, 그리고 서명 빌드 직전에 `npm run cap:sync` 를 반드시 실행한다 (`npm run build` 직후 `npx cap sync` 만 하면 `/go_practice/` 경로가 들어간 dist 가 복사되어 흰 화면이 된다).

서명 APK (Android Studio, Windows):
1. **Build › Generate Signed App Bundle / APK…** → APK → Next
2. Key store path: **Create new…** — 경로 `C:\Users\<이름>\keys\gopractice-release.jks` (리포 폴더 밖), 비밀번호 2개, Alias `gopractice`, 유효기간 25년 이상
3. Build variant **release** → Create → `android\app\release\app-release.apk`
4. 키스토어 파일과 비밀번호를 백업한다. 잃으면 같은 서명으로 업데이트를 만들 수 없다. **키스토어는 절대 커밋하지 않는다** (`.gitignore` 에 `*.jks`)

아이콘 소스는 `npm run icons` (`scripts/gen-icons.mjs`) 가 앱의 워드마크 폰트로 렌더한다 — 앱 안의 "Go practice" 와 같은 글꼴·같은 검정 무대·같은 초록.

확인 필요(실기기): Android 15 엣지투엣지에서 상단 safe-area 값이 WebView `env()` 로 들어오는지, `minWebViewVersion: 94` 미만 기기의 안내 화면, 공유 시트, 뒤로가기, 통화 후 복구.
