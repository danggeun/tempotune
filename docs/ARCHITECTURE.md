# TempoTune — 아키텍처

## 1. 층 구조

```
www/src/
  main.ts      조립 — 모듈 연결, 시작 시퀀스, SW 등록, 진단 훅 window.__tt
  ui/          카드별 DOM 바인딩: tuner, refDrum, refPanel, metro, dial, swipeBack, swipeStep, menu, settings, timer,
               micPopup, recHeader, recList, editor, toast. mount*() 가 바인딩 + 스토어 구독
  audio/       Web Audio 어댑터: engine(단일 AudioContext·마이크 세션), analysis(+worker), capture.worklet,
               metronome(+metro.worklet), refTone, recorder, playback, messages
  state/       도메인별 스토어 (settings / tuner / metro / refTone / session / recList). 타입의 원천
  persist/     localStorage 설정, IndexedDB 녹음
  platform/    웹 / Capacitor 분기 (상태바, wake lock, 전체화면, 파일 저장, 뒤로가기)
  core/        순수 알고리즘, 브라우저 API 없음, 전부 단위 테스트:
               pitch/(fft, yinFast, spectrum, tracker, dual, analyzer) · playing/detector · metro/(sequencer, arrival, sweep, dial)
               note, wav, peaks, format, recPolicy, hist, trace, hzReadout, softclip, playbackGain, container, yin(참조용, 번들 미포함)
```

의존 규칙 (`scripts/check-deps.mjs`, `npm run check` 에 포함):

| 층 | import 가능 |
|---|---|
| core | core |
| state | state, core |
| persist | persist, state, core |
| platform | platform |
| audio | audio, core, state, persist, platform |
| ui | ui, core, state, audio(명령만), platform |

`ui` 는 `audio` 의 상태를 직접 읽지 않는다: `ui → audio(명령) → store → ui(구독)`.
프레임워크 없음. 스토어는 `createStore(initial)` 의 `get / set / select`. 스타일은 `style.css` 의 `:root` 토큰만 쓴다.

## 2. 오디오 파이프라인

```
마이크 ─ getUserMedia ─▶ AudioWorkletNode (capture.worklet)      오디오 스레드
                            │  1024 샘플씩 transferable Float32Array, MessagePort 직결
                            ▼
                     Analysis Worker (analysis.worker)          ≈43 Hz
                       링버퍼 → 4096 창 → FFT-YIN → 스펙트럼(옥타브 교정) → 트래커 → 연주 감지
                       기준음 ≠ 440 은 트래커 앞에서 정규화, 표시에서 되돌림
                            ▼
                     tunerStore.set(...) → ui/tuner 가 rAF 에서 최신 값만 렌더
```

- `AudioContext` 는 하나(engine.ts). 유휴(마이크·메트로놈·기준음 없음)면 `suspend()`. 마이크 세션은 `micGen` 으로 식별.
- 샘플레이트를 강제하지 않는다. SharedArrayBuffer 미사용(COOP/COEP 를 Pages·Capacitor 에서 못 건다).
- 메트로놈은 별도 워클릿(metro.worklet + core/metro/sequencer). 클릭 시각(출력 지연 반영)을 워커에 알려 그 창의 프레임은 신뢰도를 낮춰 처리한다.
- 녹음은 MediaRecorder. iOS·Safari 는 mp4(AAC) 우선, 그 밖은 webm/opus. 10 초마다 조각을 IndexedDB 에 두고 다음 실행에서 끝내지 못한 녹음을 복구한다.

## 3. 데이터

| 무엇 | 어디 | 스키마 |
|---|---|---|
| 설정 | `localStorage["tempotune_settings_v1"]` | `{v:2, …}`. 읽을 때 값 범위 검증 |
| 녹음 | IndexedDB `tempotune_rec` v4 | `recordings`(blob) · `meta`(북마크, A-B, 파형, 속도, 확장자, 피크, 남기기) · `chunks`(녹음 중 조각) |
| 보관 | `core/recPolicy` | 30일 TTL(끌 수 있음), 마지막 7일 예고, 60분 상한 |

Capacitor 의 `androidScheme` 과 `appId` 를 바꾸면 origin 이 바뀌어 위 데이터가 사라진다.

## 4. 플랫폼 분기

`platform/index.ts` 만 `window.Capacitor` 를 본다.

| 기능 | 웹 | Android 앱 |
|---|---|---|
| 파일 저장 | iOS: 공유 시트(탭 안에서) · 그 밖: `<a download>` | `@capacitor/filesystem` → `@capacitor/share` |
| 화면 켜짐 | Wake Lock. iOS 웹은 첫 요청에 DOM 탭이 필요해 시작 버튼을 먼저 받는다 | 동일 |
| 상태바 | — | `@capacitor/status-bar` |
| 뒤로가기 | — | backButton: 편집기 → 설정 → 메뉴 → 팝업, 메인에서는 `minimizeApp` |
| Service Worker | 프리캐시. 새 버전은 유휴일 때 적용, 아니면 토스트로 알린다 | 등록 안 함 |

빌드: `npm run build`(base `/tempotune/`, Pages) · `npm run build:cap`(base `/`, Capacitor).

## 5. 검증

| 층 | 도구 |
|---|---|
| 순수 알고리즘 | Vitest `*.test.ts` |
| 튜너 벤치마크 | `npm run bench` — 합성 신호로 bias·p90·옥타브 오류·락 지연·F1. 튜너·감지기를 바꾸면 후퇴하면 안 된다 |
| 브라우저 통합 | `npm run e2e` — 헤드리스 Chromium 에 WAV 를 가짜 마이크로 주입. `--only <정규식>` |
| 시각 회귀 | `npm run shots` — 6장을 `test-assets/screens/baseline/` 과 pixelmatch |
| 모듈 경계 | `scripts/check-deps.mjs` |

CI(`ci.yml`): check → build → e2e, 스크린샷은 별도. `deploy-pages.yml` 은 CI 가 main 에서 녹색일 때만 배포한다.

## 6. Android 릴리즈

```bash
npx cap add android      # 처음 한 번
npm run icons            # 아이콘 원본(resources/icon-src.png)을 바꿨을 때만
npm run cap:assets       # 런처 아이콘
npm run cap:sync         # build:cap + cap sync + scripts/cap-manifest.mjs
npx cap open android
```

`cap-manifest.mjs` 는 권한(RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, INTERNET), 세로 고정, `versionName`/`versionCode`(major·10000 + minor·100 + patch) 를 package.json 기준으로 맞춘다. 버전은 package.json 의 `version` 만 올린다. 서명 빌드 직전에 `npm run cap:sync`.

서명 APK: Android Studio › Build › Generate Signed App Bundle / APK › APK. 키스토어는 리포 밖에 두고 백업한다(`*.jks` 는 gitignore).
