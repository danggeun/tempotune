# Go Practice

악기 연습자를 위한 모바일 우선 PWA + Capacitor Android 앱.

## 주요 기능

- **크로마틱 튜너** — YIN 알고리즘 + FFT 피크 감지 + YAMNet AI 현악기 분류
- **메트로놈** — Web Audio API 기반, 박자·세분화·BPM 드래그 조절
- **기준음 재생** — 한국 음이름(도~시) 오실레이터, 옥타브 조절
- **녹음 + 편집기** — MediaRecorder, A-B 구간 잘라내기(WAV), 북마크, 배속 조절
- **연습 타이머** — 전체 시간 / AI 감지 연주 시간 분리 측정

## 로컬 개발

```bash
npm install
npm run dev        # http://localhost:5173 으로 접속
```

마이크 기능은 `localhost` 또는 HTTPS 환경에서만 동작합니다.

## 테스트

```bash
npm run test       # 단위 테스트 실행 (YIN, WAV, 포맷)
npm run test:watch # 파일 변경 시 자동 재실행
```

## Android 빌드

```bash
npm install
npm run cap:sync   # vite build → npx cap sync android
# → Android Studio에서 빌드
```

## 파일 구조

```
www/
  index.html          앱 진입점 (HTML 구조만)
  src/
    main.js           런타임 로직 전체
    style.css         스타일
    core/
      yin.js          YIN 음정 감지 알고리즘
      wav.js          WAV 인코더
      format.js       시간 포맷 유틸
dist/                 빌드 결과물 (Capacitor webDir)
android/              Capacitor Android 프로젝트
```

## 기술 스택

| 영역 | 사용 기술 |
|------|-----------|
| 번들러 | Vite 8 |
| 테스트 | Vitest |
| 오디오 처리 | Web Audio API |
| 음정 감지 | YIN 알고리즘 |
| 신호 분류 | TensorFlow.js + YAMNet |
| 녹음 | MediaRecorder API |
| 모바일 앱 | Capacitor 8 (Android) |
