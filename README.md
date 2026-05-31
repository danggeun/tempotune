# Go Practice

> 악기 연습자를 위한 크로마틱 튜너 · 메트로놈 · 녹음 편집기  
> PWA + Android 네이티브 앱

[![Live](https://img.shields.io/badge/Web-Live-22c55e?style=flat-square)](https://carrot-dev01.github.io/go_practice)
[![Android](https://img.shields.io/badge/Android-APK-3ddc84?style=flat-square&logo=android)](#android-빌드)
[![License](https://img.shields.io/badge/License-ISC-blue?style=flat-square)](#)

---

## 기능

### 크로마틱 튜너
- **YIN 알고리즘** 기반 실시간 음정 감지 — 단순 FFT보다 정확한 시간 도메인 자기상관
- **TensorFlow.js + YAMNet** AI로 현악기 신호 분류 (비음악 소음과 연주음을 구분)
- 60fps 히스토리 캔버스로 음정 변화를 연속적으로 시각화
- A=415–466Hz 기준음 드럼 피커로 개인 조율 기준 설정 (바로크 A=415 포함)

### 메트로놈
- 마이크 없이도 독립 동작 (전용 `AudioContext` 분리)
- 2/4 · 3/4 · 4/4 · 6/8 박자, 4종 세분화, BPM 드래그 조절
- Web Audio API 정밀 스케줄링으로 지연 없는 클릭음

### 기준음 재생
- 한국 음이름(도~시♯) + 옥타브 조절
- Web Audio API 오실레이터 기반, 배터리 영향 없음

### 녹음 + 편집기
- **IndexedDB 영속화** — 앱 재시작 후에도 녹음 목록 유지
- A-B 구간 설정 후 WAV 파일 잘라내기 다운로드
- 북마크, 0.5×–1.5× 배속 조절 (`preservesPitch`)
- webm/opus · mp4/aac 자동 선택

### 연습 타이머
- 전체 연습 시간 + AI가 실제 연주로 감지한 시간 분리 측정
- 15분 비활성 시 자동 마이크 종료

---

## 기술 스택

| | |
|---|---|
| 번들러 | Vite 8 |
| 테스트 | Vitest 4 (YIN · WAV · 포맷 단위 테스트 17개) |
| 음정 감지 | YIN 알고리즘 — `www/src/core/yin.js` |
| AI 분류 | TensorFlow.js + YAMNet (tfhub.dev, 인덱스 132–147 현악기) |
| 오디오 | Web Audio API (`AudioContext` · `AnalyserNode` · `ScriptProcessorNode`) |
| 녹음 영속화 | IndexedDB (`gopractice_rec`) |
| 화면 유지 | Screen Wake Lock API |
| 설정 저장 | localStorage |
| 모바일 앱 | Capacitor 8 (Android) |
| 상태바 | `@capacitor/status-bar` — 라이트/다크 자동 대응 |

---

## 시작하기

### 웹 개발 서버

```bash
npm install
npm run dev        # http://localhost:5173
```

> 마이크는 `localhost` 또는 HTTPS에서만 동작합니다.

### 테스트

```bash
npm run test       # 단위 테스트 17개 실행
npm run test:watch # 파일 변경 감지 자동 재실행
```

### Android 빌드

```bash
npm run cap:sync   # Capacitor용 빌드(base=/) + android/ 동기화
# → Android Studio → Build → Build APK(s)
```

> `npm run build` 는 GitHub Pages용(base=/go_practice), `npm run cap:sync` 는 별도 Capacitor 빌드를 사용합니다.

---

## 파일 구조

```
www/
  index.html          앱 진입점
  src/
    main.js           런타임 로직 전체 (~1,055줄)
    style.css         스타일 (~275줄)
    core/
      yin.js          YIN 음정 감지 알고리즘 (순수 함수)
      wav.js          WAV 인코더 (순수 함수)
      format.js       시간 포맷 유틸 (순수 함수)
dist/                 Vite 빌드 결과 (Capacitor webDir)
android/              Capacitor Android 네이티브 프로젝트
```

---

## 웹 앱

[https://carrot-dev01.github.io/go_practice](https://carrot-dev01.github.io/go_practice)

Chrome · Safari · Edge 최신 버전 지원. 홈 화면에 추가하면 PWA로 사용 가능.
