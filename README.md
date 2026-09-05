# Go practice

> 현악기 연습을 위한 크로마틱 튜너 · 메트로놈 · 기준음 · 녹음 편집기
> 웹(PWA) + Android 앱 (Capacitor)

[![CI](https://github.com/danggeun/go_practice/actions/workflows/ci.yml/badge.svg)](https://github.com/danggeun/go_practice/actions/workflows/ci.yml)
[![Live](https://img.shields.io/badge/Web-Live-22c55e?style=flat-square)](https://danggeun.github.io/go_practice/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

**웹 앱: <https://danggeun.github.io/go_practice/>** — Chrome · Safari · Edge 최신 버전. 홈 화면에 추가하면 오프라인에서도 동작하는 PWA.

보면대 위 60–90 cm 에서, 활을 든 채 쓰는 것을 전제로 만들었다: 검정 무대 위의 큰 음이름, 초록은 '맞음' 하나의 뜻, 확인 대화상자 없이 실행 취소, 글자 버튼.

---

## 기능

### 튜너
- FFT 기반 YIN 음정 감지 + 신뢰도 트래커. AudioWorklet → Web Worker 파이프라인이라 메인 스레드는 화면만 그린다
- 40 Hz(콘트라베이스 E1) ~ 4.2 kHz, 스펙트럼 배음 비교로 옥타브 오류 자동 교정
- 신호처리 기반 **연주 감지** — 주기성·배음·평탄도·지속시간으로 말소리/잡음을 걸러 실제 연주 시간만 센다 (오프라인, 모델 없음)
- 기준음 A = 410–466 Hz 드럼 피커(바로크 415 포함), 헤더의 **A 듣기**로 메뉴 없이 A 현을 맞춘다
- 음이름 도레미 / C D E (선택하지 않은 쪽은 작게 병기), 이명동음 병기, 허용 오차 ±5–25 ¢, 반응 속도·마이크 감도 설정
- 합성 신호 39개 벤치마크 (`test-assets/bench/phase2-v1-vs-v2.md`)

### 메트로놈
- AudioWorklet 안에서 샘플 단위로 클릭 합성 — 화면이 꺼지거나 백그라운드여도 박자가 흔들리지 않음 (20 s 동안 ±1 샘플, e2e 검증)
- 2/4 · 3/4 · 4/4 · 6/8, 세분 4종, BPM 20–220 (버튼·드래그), 재생 중 변경은 다음 박부터 즉시 반영
- 폰에서는 재생 시작 시 접혀 튜너만 남고(♩BPM + 박 점), 재생 중에도 펼쳐서 바꿀 수 있다. 녹음 중에는 클릭 무음 + 시각 피드백

### 기준음
- 도~시(♯ 포함) + 옥타브 2–6, 마이크 없이도 재생 (단일 AudioContext)

### 녹음 · 편집기
- 녹음 목록은 IndexedDB 에 영속 (30일 자동 삭제 — 설정에서 끌 수 있음, 마지막 7일 예고)
- 파형, A-B 구간 반복(꺼짐 / 켜짐 / 1초 전부터), **구간 확대**, 북마크, 0.5–1.5× 배속(`preservesPitch`, 값 탭으로 프리셋 순환, 녹음별 기억), 구간 WAV 저장
- 웹은 브라우저 다운로드, Android 앱은 공유 시트(파일·드라이브 등)로 저장
- 삭제·타이머 초기화는 확인 없이 즉시 + 5초 실행 취소. 저장 실패는 반드시 알린다 (조용한 실패 없음)

### 연습 타이머
- 경과 시간과 "소리 낸 시간"(연주 감지) 분리 측정, 15분 무활동 시 마이크 자동 종료

### 앱 완결성
- 오프라인 PWA (Service Worker 프리캐시, 자체 호스팅 폰트), 업데이트는 앱이 유휴일 때만 적용
- 오디오 생명주기: 인터럽트 복구, 유휴 시 컨텍스트 suspend, 화면 켜짐 유지(Wake Lock), 백그라운드 진입 시 녹음 저장
- 권한 흐름: 미결정/거부/차단 각각 안내 (앱은 시스템 설정 경로). Android 뒤로가기는 열린 화면부터 닫음
- 라이트/다크, 터치 타겟 44 px, 대비 AA, 상태는 점으로

---

## 실행

```bash
npm install          # 처음 한 번 (Node 22 이상)
npm run dev          # http://localhost:5173 — 마이크는 localhost 또는 HTTPS 에서만
npm run build        # GitHub Pages 용 (base=/go_practice/) → dist/
```

### 검증

```bash
npm run check        # 타입 검사 + 모듈 경계 검사 + 단위 테스트 (Vitest, 73개)
npm run e2e          # 헤드리스 Chromium 에 WAV 를 가짜 마이크로 주입해 동작 시나리오 38개 실행
npm run shots        # 라이트/다크 × 6화면 스크린샷을 기준선과 픽셀 비교
npm run bench        # 튜너 벤치마크 (합성 신호 39개)
npm run verify       # check + shots + e2e
```

e2e/스크린샷은 Playwright Chromium 이 필요하다: `npx playwright install chromium` (또는 `CHROMIUM_PATH` 환경변수로 기존 Chrome 지정).
CI(GitHub Actions)가 push/PR 마다 같은 검증을 돌리고, `main` 에 push 하면 GitHub Pages 에 자동 배포한다 (리포 Settings › Pages › Source 를 **GitHub Actions** 로).

디자인 후보를 실제 화면으로 비교할 때: `node scripts/ux-compare.mjs --variant a=dist --variant b=dist:override.css`.

## 구조

`www/src/` 아래 `core / state / audio / persist / platform / ui / main.ts` 층으로 나뉘며 의존 방향은 `npm run check` 가 강제한다.
왜 이런 구조인지, 오디오 파이프라인과 검증 방식은 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** 참고.
결정 기록은 [docs/DESIGN.md](docs/DESIGN.md), UI 의도와 감사는 [docs/UX-AUDIT.md](docs/UX-AUDIT.md), 진행 이력은 [docs/ROADMAP.md](docs/ROADMAP.md), 기능 체크리스트는 [docs/CHECKLIST.md](docs/CHECKLIST.md).

## Android 빌드

```bash
npx cap add android   # android/ 가 없을 때 한 번 (생성물이라 리포에 없음)
npm run cap:assets    # resources/icon*.png 에서 런처 아이콘(adaptive) 생성
npm run cap:sync      # Capacitor 용 빌드(base=/) + android/ 동기화 + 매니페스트 보정(권한·세로 고정·버전)
npx cap open android  # Android Studio → Build › Generate Signed App Bundle / APK
```

`cap:sync` 끝에 `scripts/cap-manifest.mjs` 가 `RECORD_AUDIO` / `MODIFY_AUDIO_SETTINGS` / `INTERNET` 권한, 세로 고정, `versionName/versionCode`(package.json 의 version) 를 보정한다.
서명 APK 절차는 [docs/ARCHITECTURE.md §6](docs/ARCHITECTURE.md#6-android-릴리즈) 참고. `capacitor.config.json` 의 `androidScheme` 은 바꾸지 말 것 — origin 이 바뀌면 저장된 녹음·설정이 사라진다.

## 라이선스

[MIT](LICENSE). 번들 폰트 DM Mono · Cormorant Garamond 는 SIL Open Font License.
