# Changelog

형식: [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/). 버전은 [SemVer](https://semver.org/lang/ko/).

## [2.0.0] — 2026-09-05

v1(단일 파일 웹 프로토타입)을 기능·디자인 언어를 유지한 채 전면 재구성. 로드맵 Phase 0–7 ([docs/ROADMAP.md](docs/ROADMAP.md)).

### Phase 0 — 기준선
- 합성 현악기/잡음/말소리 신호 생성기, v1 튜너 벤치마크 수치, 스크린샷 기준선, 설계서·로드맵·기능 체크리스트

### Phase 1 — TypeScript 전환 + 구조 분리
- 단일 파일 → `core / state / audio / persist / platform / ui` 층 (동작 변경 0, 스크린샷 diff 0), 모듈 경계 검사, strict TypeScript
- 수정: 편집기 파일명이 재시작 후 되돌아가던 버그, 편집기 고아 오디오 재생, BPM 로드 클램프, 설정 즉시 저장(pagehide)

### Phase 2 — 오디오 코어
- FFT 기반 YIN(O(N log N)) + 신뢰도, 스펙트럼 옥타브 교정, 신뢰도 가중 트래커(비브라토 적응)
- AudioWorklet 캡처 → Web Worker 분석 파이프라인 (`ScriptProcessorNode`·`AnalyserNode` 제거)
- YAMNet(온라인 모델) 제거 → 신호처리 기반 연주 감지기 (오프라인, 첼로/베이스 저음 40 Hz)
- 워커 ready 대기, 백그라운드 복귀 시 오래된 청크 폐기, 백프레셔, 버퍼 재활용

### Phase 3 — 메트로놈 / 기준음
- 메트로놈을 AudioWorklet 안에서 샘플 정확도로 합성. BPM 변경 즉시 반영, 6/8 중간 액센트
- 단일 AudioContext (마이크 없이 기준음 재생), 유휴 시 컨텍스트 일시정지, `interrupted` 복구, 출력 지연 기반 클릭 뮤트 창

### Phase 4 — 녹음 / 편집기
- IndexedDB v3: 북마크·A-B·파형 영속, meta 스토어 분리. 파형 미니맵, A-B 핸들 드래그·±0.25 s, 삭제 실행 취소, 표시명 `M/D HH:MM`
- Android 네이티브 저장 (Filesystem + Share), 저장 실패 표면화, webm 길이 Infinity 폴백

### Phase 5 — 앱 완결성
- PWA: Service Worker 프리캐시(prompt 모드, 유휴 시 적용), manifest, 아이콘, 자체 호스팅 폰트
- 생명주기 매트릭스, 권한 흐름(미결정/거부/차단), 조용한 실패 전수 제거, 백그라운드 진입 시 녹음 저장, 무활동 감시 독립화, 메트로놈 wake lock, 녹음 60분 상한, Android 뒤로가기, 매니페스트 권한 보정 스크립트

### Phase 6 — UI/UX
- UI/UX 감사(의도 복원·사용 상황 분석) → 디자인 토큰 체계 (경계 1 px, 반경 16/10/7, 조작 48/36 + 히트 44, 액센트 AA)
- 다크 토스트, 상태 점, 반복 프리롤, 속도 프리셋 + 녹음별 기억, 목록 메타, 편집기 진입 페이드, 타이머 초기화 실행 취소, ❚❚
- 독립 리뷰 38건 반영: 선택 상태 통일, 페이지 상단 정렬, 편집기 부제·버튼 정리, 🔈 → 음량, 해요체

### Phase 7 — 최종 검토 + 마감
- **결함 수정**: 기준음 ≠ 440(바로크 415 등)에서 음이름이 반음 틀리던 문제 · 메트로놈+튜너 동시 사용 시 빠른 템포에서 튜너가 얼어붙던 문제 · 녹음 정지 직후 재시작 경합 · openMic 도중 닫힘 · 워클릿 좀비 · `play()` 거부 · 저장 설정 범위 검증
- **제품**: 헤더 'A 듣기', 음이름 도레미/C D E 설정, 편집기 구간 확대, 게이지 ♭♯ 단서, 재생 중 메트로놈 펼치기, 앱 첫 실행 권한 안내·차단 안내, 녹음 보관 30일/계속, 버전 표시, 360 px 헤더, 엣지투엣지 safe-area, 죽은 기준음 바텀시트 제거
- **브랜드**: 아이콘을 앱 워드마크(Cormorant italic "Go" + 초록 띠, 검정 무대)로 재생성 — adaptive/maskable 올바른 형태, 앱 이름 "Go practice"
- **마감**: GitHub Actions CI(check·build·e2e·스크린샷) + Pages 배포, README/ARCHITECTURE/CHANGELOG, MIT 라이선스, Windows 호환 스크립트(cross-env), 매니페스트에 버전·세로 고정 보정, `.gitattributes`

### 검증
- 단위 테스트 73개, e2e 시나리오 38개(가짜 마이크 WAV 주입), 스크린샷 회귀 12장, 튜너 벤치마크 39 신호

## [1.0.0] — 2026-06-01
- 단일 파일 웹 프로토타입 (YIN + FFT 교차검증 튜너, lookahead 메트로놈, YAMNet 연주 감지, IndexedDB 녹음, Capacitor Android)

[2.0.0]: https://github.com/danggeun/go_practice/compare/fd56de1...v2.0.0
