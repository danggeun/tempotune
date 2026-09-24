# TempoTune

> **in time, in tune.**
> 현악기 연습을 위한 크로마틱 튜너 · 메트로놈 · 기준음 · 녹음 편집기.
> 웹(PWA) + Android (Capacitor). 오프라인 동작, 오디오는 기기 밖으로 나가지 않는다.

[![CI](https://github.com/danggeun/tempotune/actions/workflows/ci.yml/badge.svg)](https://github.com/danggeun/tempotune/actions/workflows/ci.yml)
[![Live](https://img.shields.io/badge/Web-Live-22c55e?style=flat-square)](https://danggeun.github.io/tempotune/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

**<https://danggeun.github.io/tempotune/>** — Chrome · Safari · Edge 최신 버전. 홈 화면에 추가하면 오프라인 PWA 로 동작한다.

## 기능

**튜너** — AudioWorklet → Web Worker 파이프라인(메인 스레드는 그리기만). FFT 기반 YIN + 신뢰도 트래커, 40 Hz(콘트라베이스 E1)~4.2 kHz, 스펙트럼 배음 비교로 옥타브 오류 교정. 기준음 A = 410–466 Hz(바로크 415 포함), 허용 오차 ±5–25 ¢. 음이름 도레미 / C D E, 이명동음 병기. 최근 음정 궤적을 카드에 그린다.

**연주 감지** — 주기성·배음·평탄도·지속시간으로 말소리와 잡음을 걸러 실제 연주 시간만 센다. 오프라인, 모델 없음.

**메트로놈** — AudioWorklet 안에서 샘플 단위로 클릭을 합성한다. 화면이 꺼지거나 백그라운드여도 박자가 흔들리지 않는다(20초 동안 ±1 샘플, e2e 로 검증). 2/4 · 3/4 · 4/4 · 6/8, 세분 4종, BPM 40–200. 재생 중 변경은 다음 박부터 반영된다. 녹음 중에는 클릭이 무음이 되고 화면으로만 박을 표시한다.

**기준음** — 도~시(♯ 포함) × 옥타브 2–6. 마이크 없이도 재생된다.

**녹음 · 편집기** — IndexedDB 에 영속. 파형, A-B 구간 반복(꺼짐 / 켜짐 / 1초 전부터), 구간 확대, 북마크, 0.5–1.5× 배속(`preservesPitch`, 녹음별 기억), 구간 WAV 저장. 웹은 브라우저 다운로드, Android 는 공유 시트. 30일 자동 삭제(설정에서 끌 수 있고, 마지막 7일은 예고한다). 개별 녹음은 **남기기**로 자동 삭제에서 빼 둘 수 있다.

**연습 타이머** — 경과 시간과 "소리 낸 시간"(연주 감지)을 나눠 센다. 15분 무활동이면 마이크를 자동으로 닫는다.

**앱 완결성** — 오프라인 PWA(Service Worker 프리캐시, 자체 호스팅 폰트), 업데이트는 앱이 유휴일 때만 적용. 오디오 생명주기(인터럽트 복구, 유휴 시 컨텍스트 suspend, Wake Lock, 백그라운드 진입 시 녹음 저장). 화면이 숨겨지면 마이크를 놓아 다른 앱이 쓸 수 있게 한다. 다크 고정, 터치 타겟 44 px, 대비 WCAG AA 이상.

## 실행

```bash
npm install          # Node 22 이상
npm run dev          # http://localhost:5173 — 마이크는 localhost 또는 HTTPS 에서만
npm run build        # GitHub Pages 용 (base=/tempotune/) → dist/
```

### 검증

```bash
npm run check        # 타입 검사 + 모듈 경계 검사 + 단위 테스트 (Vitest)
npm run e2e          # 헤드리스 Chromium 에 WAV 를 가짜 마이크로 주입해 시나리오 실행
npm run shots        # 6화면 스크린샷을 기준선과 픽셀 비교
npm run bench        # 합성 신호로 튜너 정확도 측정 (bias · p90 · 옥타브 오류 · 락 지연 · F1)
npm run verify       # check + shots + e2e
```

e2e·스크린샷에는 Playwright Chromium 이 필요하다: `npx playwright install chromium` (또는 `CHROMIUM_PATH` 로 기존 Chrome 지정).
CI 가 push/PR 마다 같은 검증을 돌리고, `main` 에 push 하면 GitHub Pages 에 배포한다.

**튜너·감지기를 건드리는 변경은 `npm run bench` 지표가 후퇴하지 않아야 한다.** 표시 레이어만 바꾼 경우 지표는 완전히 동일해야 한다.

## 구조

`www/src/` 는 `core / state / audio / persist / platform / ui / main.ts` 층으로 나뉘고, 의존 방향은 `npm run check` 가 강제한다(`scripts/check-deps.mjs`). 왜 이런 구조인지와 오디오 파이프라인은 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**, 실기기 점검 항목은 [docs/CHECKLIST.md](docs/CHECKLIST.md), 스토어 등록 문구는 [docs/STORE.md](docs/STORE.md), 버전별 변경은 [CHANGELOG.md](CHANGELOG.md) 에 있다.

## Android 빌드

```bash
npx cap add android   # android/ 가 없을 때 한 번 (생성물이라 리포에 없음)
npm run icons         # resources/icon*.png 생성 (scripts/gen-icons.mjs)
npm run cap:assets    # 런처 아이콘(adaptive) 생성
npm run cap:sync      # Capacitor 빌드(base=/) + android/ 동기화 + 매니페스트 보정
npx cap open android  # Android Studio → Build › Generate Signed App Bundle / APK
```

`cap:sync` 끝에 `scripts/cap-manifest.mjs` 가 `RECORD_AUDIO` / `MODIFY_AUDIO_SETTINGS` / `INTERNET` 권한, 세로 고정, `versionName`·`versionCode`(package.json 의 version)를 보정한다. 서명 APK 절차는 [docs/ARCHITECTURE.md §6](docs/ARCHITECTURE.md#6-android-릴리즈).

> `capacitor.config.json` 의 `androidScheme` 과 `appId` 는 이제 바꾸지 말 것. origin 이나 패키지명이 바뀌면 저장된 녹음·설정이 사라지고, **스토어에 한 번 올라간 뒤에는 `appId` 를 영원히 바꿀 수 없다.**

## 개인정보

마이크 입력과 녹음은 **기기에서만** 처리·저장된다. 서버로 보내지 않고, 분석 도구나 광고 SDK 도 없다. 웹 앱이 외부 호스트에 요청하지 않는 것은 CI 에서 확인한다. 자세한 내용은 [PRIVACY.md](PRIVACY.md).

## 라이선스

[MIT](LICENSE). 번들 폰트 DM Mono 는 SIL Open Font License.
