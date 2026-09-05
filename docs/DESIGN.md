# Go practice — 설계서 (v2, 2026-09-05)

이 문서는 로드맵 v2를 실행하기 위한 **결정 기록**이다. 각 결정에는 대안과 기각 이유를 남긴다.
전제: 사용자 실기기 테스트에 의존하지 않는다. 검증은 자동화로 대체한다.

---

## A. 검증 전략 (설계보다 먼저 정한다)

"사람 없이 어떻게 맞다고 확신하는가"가 나머지 모든 결정의 제약 조건이다.

### A1. 세 층의 자동 검증

| 층 | 대상 | 도구 | 무엇을 잡나 |
|---|---|---|---|
| 1. 순수 알고리즘 | `core/*` | Vitest | cents 오차, 락 지연, 오검출률을 **수치**로 |
| 2. 브라우저 통합 | `audio/*` + `ui/*` | Playwright + 헤드리스 Chromium | 마이크→워클릿→워커→화면까지 실제 경로 |
| 3. 시각 회귀 | 전 화면 | Playwright 스크린샷 diff | 의도치 않은 UI 변화 |

핵심 트릭: Chromium 플래그 `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>` 로 **WAV 파일을 마이크 입력으로 주입**할 수 있다. 이걸로 "440 Hz 바이올린 톤을 넣으면 화면에 '라' + 0¢가 뜨는가"를 CI에서 검증한다. 사람이 연주할 필요가 없어진다.

### A2. 테스트 신호 세트 (`test-assets/`)

실제 녹음이 없으므로 **물리적으로 그럴듯한 합성 신호**를 만든다. 순수 사인파는 튜너 검증에 거의 무의미하다(실제 악기의 어려움은 배음·비브라토·어택·노이즈에서 온다).

생성기(`scripts/gen-signals.ts`)가 만드는 것:

- **활 현악기 톤**: 배음 1~20, 진폭 1/n^1.1 (톱니에 가까움), 짝수 배음 약간 감쇠, 5.5 Hz ±15¢ 비브라토, 활 노이즈(고역 통과 잡음 −30 dB), 어택 80 ms, 릴리즈 200 ms
- **저음 현**: 첼로 C2(65.4), G2, 베이스 E1(41.2) — 옥타브 오류·저음 창 크기 검증용
- **고음 현**: 바이올린 E5(659), E6 하모닉스(1319)
- **스케일/글리산도**: 락 지연과 음 전환 측정
- **방해 신호**: 백색/핑크 잡음, 말소리 모사(빠르게 흔들리는 f0 + 무성 구간), 메트로놈 클릭 혼입, 배경 잡음 SNR 0/10/20 dB
- 각 파일에 `expected.json` (시간축 정답 f0/음이름/연주 여부)

실제 녹음이 생기면 같은 폴더에 넣고 `expected.json`만 쓰면 자동으로 벤치마크에 합류한다.

### A3. 튜너 벤치마크 (`npm run bench`)

출력 지표(표로 커밋, PR마다 비교):

| 지표 | 정의 | 목표 |
|---|---|---|
| 정상 상태 cents 오차 | 안정 구간 중앙값 절대 오차 | ≤ 1¢ (합성), ≤ 3¢ (실녹음) |
| 락 지연 | 음 시작 → 올바른 음이름 표시 | ≤ 120 ms |
| 옥타브 오류율 | 정답 대비 ±12 반음 프레임 비율 | ≤ 0.5% |
| 무음/잡음 오검출 | 잡음 구간에서 음이 뜬 프레임 비율 | ≤ 1% |
| 연주 감지 F1 | 연주/비연주 프레임 분류 | ≥ 0.95 (합성) |
| 워커 프레임 시간 | 분석 1회 ms (p95) | ≤ 4 ms (데스크탑), 예산 12 ms (폰) |

현재 코드(v1)에 대해서도 같은 벤치마크를 먼저 돌려 **기준선 숫자**를 남긴다. "다운그레이드 없음"은 이 표로 증명한다.

---

## B. 오디오 파이프라인

### B1. 스레드 구조

```
[마이크] → AudioWorkletNode(capture)
              │ MessagePort (워클릿↔워커 직결, 메인 스레드 경유 없음)
              ▼
         Analysis Worker
           링버퍼 → 창 추출 → YIN(FFT 기반) + 스펙트럼 → 신뢰도/락/연주감지
              │ postMessage({t, f0, cents, note, conf, rms, playing}) ~43 Hz
              ▼
         Main thread: store.update → UI render (rAF)
```

결정과 이유:

- **AudioWorklet 캡처**: `ScriptProcessorNode` 폐기 예정 + 메인 스레드 콜백. 워클릿은 오디오 스레드에서 128 샘플 단위로 받는다.
- **워클릿→워커 직결**: 메인에서 `MessageChannel` 생성, 한 port는 `workletNode.port.postMessage({port}, [port])`로 워클릿에, 다른 port는 워커에 전달. 메인 스레드가 오디오 데이터를 만지지 않는다.
- **SharedArrayBuffer 미사용**: COOP/COEP 헤더가 필요한데 GitHub Pages·Capacitor 로컬 스킴에서 설정 불가. 대신 워클릿이 1024 샘플씩 모아 transferable `Float32Array`로 전송(초당 ~43회, 오버헤드 무시 가능).
- **분석은 워커**: YIN을 메인에서 4프레임마다 돌리던 타협 제거. 폰에서 UI 애니메이션과 분석이 서로를 막지 않는다.
- **샘플레이트 강제 안 함**: 현재 `sampleRate:44100` 요청 → Android 다수가 48 kHz라 리샘플 비용/실패 가능. 컨텍스트 기본값을 쓰고 모든 계산은 `sr` 파라미터로.

### B2. 창(window)과 홉(hop)

| 항목 | 값 | 이유 |
|---|---|---|
| 창 | 4096 @ 44.1/48 kHz (~85–93 ms) | 첼로 C2(65 Hz) 6주기, 베이스 E1(41 Hz) 3.8주기 확보 |
| 홉 | 1024 (~21–23 ms) | 화면 갱신 43–47 Hz, 락 지연 예산 안 |
| 최소 f0 | 40 Hz | 베이스 E1 커버 (현재 hzMin 80 → 첼로 누락 문제 해소) |
| 최대 f0 | 4200 Hz | 바이올린 최고 하모닉스 여유 |

저음 정확도가 부족하면 "저음 악기 모드"에서 창 8192로 확장 가능하도록 창 크기를 파라미터화(설정에 노출은 벤치마크 결과 보고 결정).

### B3. 피치 추정: FFT 기반 YIN + 신뢰도

현재 YIN은 O(N²/4) 직접 계산. 4096 창이면 약 4백만 곱셈-덧셈/회. 워커로 옮겨도 폰에서 43 Hz로 돌리기엔 무겁다.

**결정: 차분 함수를 FFT 자기상관으로 계산** (O(N log N)).
- d(τ) = Σx² 항(누적합) − 2·r(τ), r은 FFT 자기상관
- 이후 CMND(누적 평균 정규화)와 절대 임계 탐색, 포물선 보간은 기존과 동일
- 자체 실수 FFT(radix-2, 사전 계산된 twiddle) — 외부 의존성 없음, 스펙트럼 분석에도 재사용

**신뢰도**: 선택된 τ에서의 CMND 값 d′(0=완전 주기, 1=비주기)을 `conf = 1 − d′`로 반환. 지금은 이 값을 버리고 있다. 이 값이 이후 모든 판단(락, 스무딩, 연주 감지)의 입력이 된다.

**옥타브 오류 억제**: YIN 후보 f0에 대해 스펙트럼에서 f0/2, f0, 2f0의 배음 에너지 합을 비교(간이 harmonic product). f0/2가 뚜렷이 우세하면 후보를 f0/2로 교정. 현재의 "FFT 피크 vs 락된 음" 비교보다 원리적이다.

### B4. 락(lock)과 스무딩: 휴리스틱 → 통계

현재: `lockFrames`, `rmsWeak`, `isOctaveJump`, `fftFavorsLocked` 4중 휴리스틱.
결정: 두 단계로 단순화.

1. **신뢰도 가중 중앙값** (최근 5프레임, conf ≥ 0.6만 참여): 순간 튀는 값 제거
2. **음이름 히스테리시스**: 표시 음이름은 현재 음 기준 ±65¢ 안에 있으면 유지, 벗어난 값이 conf 높게 3프레임 연속이면 전환
3. **표시용 지수 평활**: cents 값에만 적용, 설정(느림/보통/빠름)은 여기 계수만 바꿈

이 세 규칙으로 기존 4 휴리스틱을 대체하되, 벤치마크에서 기존보다 락 지연·옥타브 오류가 나빠지면 규칙을 추가하지 말고 계수를 조정한다.

### B5. 연주 감지 (YAMNet 대체)

목표: "악기 소리가 나고 있는가"를 오프라인·저비용으로. 악기 종류 식별은 목표가 아니다(YAMNet도 실사용에서 그 수준은 아니었다).

프레임 특징(모두 이미 계산된 값에서 파생, 추가 비용 거의 0):
- `conf` (주기성)
- `rms` 대 적응형 잡음 바닥(무음 구간 이동 최소값 추적)
- 배음 수: 스펙트럼에서 k·f0 (k=2..6) 피크 존재 개수
- 스펙트럼 평탄도 (잡음은 평탄, 악기는 뾰족)
- **f0 안정도**: 최근 300 ms f0 표준편차(cents). 말소리는 크게 흔들리고 끊김, 활 현악기는 비브라토 폭(±20¢) 안에서 안정

판정: 가중 점수 → 상태기계 (attack 60 ms 이상 지속 시 ON, 250 ms 이하 공백은 유지, 그 이상이면 OFF). 이 히스테리시스가 현재 `holdFrames:45`의 역할을 대체한다.

한계(문서에 명시): 노래·휘파람·다른 선율 악기도 "연주 중"으로 잡힌다. 혼자 연습하는 상황에서는 문제되지 않는다. 필요해지면 나중에 YAMNet을 옵션으로 되살릴 수 있도록 감지기 인터페이스를 `PlayingDetector`로 추상화한다.

### B6. 메트로놈: 워클릿 내부 생성 (샘플 정확도)

현재: 메인 스레드 `setTimeout` 폴링 + lookahead. 정석이지만 두 약점 — 화면 꺼짐/백그라운드 시 타이머 스로틀링, 튜너 뮤트를 위해 `isClick` 플래그를 시간 추정으로 세팅.

**결정: 메트로놈을 AudioWorkletProcessor로 구현.**
- 프로세서가 샘플 카운터로 다음 클릭 위치를 계산, 클릭 파형을 직접 합성(짧은 감쇠 사인 + 노이즈 버스트, 강/약/세분 3종)
- BPM/박자/세분/볼륨 변경은 port 메시지, 다음 박부터 반영(현재의 stop→start 재시작 제거 → BPM 드래그 중 끊김 없음)
- 박 이벤트를 port로 메인에 통보(시각 피드백) — 클릭 샘플 위치 + `currentTime`으로 정확한 타이밍
- **클릭 뮤트 없이 튜너 보호**: 메트로놈 출력은 스피커로만 가고 마이크 경로에는 없으므로, 문제는 스피커 소리가 마이크로 다시 들어오는 것. 클릭 시각(정확히 알 수 있음)을 워커에 알려 해당 구간의 분석 프레임을 "무시" 표시. 지금의 `isClick` 타이밍 추정보다 정확.
- 타이머 스로틀링 영향 0 (오디오 스레드는 스로틀되지 않음)

녹음 중 동작: 현재처럼 클릭 무음 + 시각 피드백만 유지(스피커 클릭이 마이크 녹음에 섞이는 것을 막기 위함). 이어폰 감지 시 소리 유지 옵션은 확인 필요.

기각한 대안: 스케줄러를 Worker로만 이동 — 스로틀링은 피하지만 AudioContext 스케줄은 여전히 메인 경유, 튜너 뮤트 정확도 문제는 남음.

### B7. AudioContext 생명주기

- **단일 컨텍스트**. 현재의 `micAC`/`metroAC` 이중 구조와 전환 로직 삭제.
- 첫 사용자 제스처에서 생성(`latencyHint:'interactive'`), 그 후 마이크는 소스 노드 연결/해제만.
- 상태 매트릭스(모두 자동 테스트 대상):

| 이벤트 | 동작 |
|---|---|
| 페이지 숨김 | 튜너 분석 계속(마이크 켜져 있으면), 화면 갱신만 중단 |
| 페이지 복귀 | `resume()`, 워커에 리셋 신호 (오래된 링버퍼 폐기) |
| `statechange: interrupted/suspended` (전화 등) | 상태 표시 "일시정지", 복귀 시 자동 resume, 실패 시 탭 안내 |
| 마이크 장치 변경/해제 (`track.ended`) | 튜너 정지 + 토스트 + 재연결 버튼 |
| 15분 무활동 | 마이크만 해제, 메트로놈은 유지 |

---

## C. 코드 구조와 상태

### C1. 모듈 경계

```
core/       브라우저 API import 금지 (ESLint 규칙으로 강제)
audio/      Web Audio 어댑터. store에 쓰고, store를 읽지 않음(명령은 함수 호출로)
state/      단일 store. 타입 정의의 유일한 원천
ui/         DOM 바인딩. store 구독 + audio 명령 호출. audio 내부 상태 직접 접근 금지
platform/   capacitor/web 분기. 나머지 코드는 platform 인터페이스만 본다
```

의존 방향: `ui → state ← audio`, `ui → audio(명령만)`, `* → core`, `audio/ui → platform`. 순환 없음. `dependency-cruiser` 또는 ESLint `no-restricted-imports`로 CI에서 검사.

### C2. 상태 스토어

프레임워크 도입 안 함(HTML/CSS 자산 보존, 번들 최소). 손수 만든 최소 스토어:

```ts
type Listener<T> = (v: T) => void
createStore<S>(initial: S): {
  get(): S
  set(patch: Partial<S>): void            // 얕은 병합, 변경 없으면 알림 없음
  select<T>(sel: (s: S) => T, fn: Listener<T>, eq?): () => void  // 값 바뀔 때만
}
```

스토어는 도메인별로 분리: `tunerStore`(f0/cents/note/conf/playing), `metroStore`, `sessionStore`(타이머/녹음), `settingsStore`(영속). 튜너 스토어는 초당 40회 갱신되므로 UI는 rAF에서 최신 값만 읽는다(구독 콜백에서 DOM을 만지지 않음).

기각: Preact signals / Zustand — 좋은 도구지만 지금 규모에 의존성만 늘림. 필요해지면 인터페이스가 같아서 교체 쉬움.

### C3. UI 모듈

기존 `index.html`의 DOM은 그대로. 각 카드가 하나의 모듈:

```ts
export function mountTuner(root: HTMLElement, deps: {tuner: TunerStore, settings: SettingsStore}): () => void
```

`mount`는 이벤트 바인딩 + 구독을 하고 언마운트 함수를 반환. 인라인 스타일 조작(`el.style.color=...`)은 클래스 토글로 치환하여 CSS가 시각을 전담.

메트로놈 접힘: `maxHeight` 측정 코드 전부 삭제 → `.metro-body{display:grid;grid-template-rows:1fr;transition:grid-template-rows .25s}` + `.collapsed{grid-template-rows:0fr}`. JS는 클래스만 토글.

### C4. 영속화

- 설정: `localStorage` 유지, `{v:2, ...}` 스키마 버전 + v1 마이그레이션 함수. TTL 제거(왜 7일 후 BPM을 잊어야 하는지 근거 없음 — 확인 필요, 의도가 있었다면 유지).
- 녹음: IndexedDB v2 스키마 `{id, name, ts, dur, mime, blob, bookmarks:number[], ab:{a,b}|null}`. `name` 수정·북마크·A-B가 영속. 마이그레이션 `onupgradeneeded`에서 v1 레코드에 기본값 채움.
- 30일 TTL 삭제는 유지하되 **삭제 전 안내**(설정에서 끄기 가능).

### C5. TypeScript 규칙

`strict: true`, `noUncheckedIndexedAccess: true`. `any` 금지(ESLint). DOM 참조는 `q<T extends Element>(id): T` 헬퍼로 null 체크를 한 곳에서. 워커/워클릿과 주고받는 메시지는 discriminated union 타입 하나(`messages.ts`)로 정의.

---

## D. 플랫폼

### D1. Capacitor

| 기능 | 웹 | Android 앱 |
|---|---|---|
| 파일 저장(WAV/녹음) | `<a download>` | `@capacitor/filesystem` → `Directory.Documents` 후 `@capacitor/share` 시트 (확인 필요: WebView의 `<a download>`는 보통 동작하지 않음) |
| 화면 켜짐 | Wake Lock API | 동일 (Chrome WebView 지원). 실패 시 `@capacitor-community/keep-awake` 폴백 |
| 상태바 | — | 기존 `@capacitor/status-bar` 유지 |
| 햅틱 | Vibration API (선택) | `@capacitor/haptics` (선택, 설정 기본 꺼짐) |
| 마이크 권한 | `getUserMedia` | 동일 + 거부 시 앱 설정으로 보내는 안내 |

`platform/index.ts`가 `Capacitor.isNativePlatform()`으로 구현을 고른다. 나머지 코드는 `platform.saveFile(blob, name)` 같은 인터페이스만 사용.

### D2. 오프라인 / PWA

- 폰트 3종 self-host (`woff2`, 필요한 weight만). Google Fonts 링크 제거
- `manifest.webmanifest` (이름, 아이콘, `display: standalone`, 테마색)
- Service Worker: 빌드 산출물 precache (vite-plugin-pwa). 런타임 캐시 없음(외부 요청이 없으므로)
- Capacitor 빌드에서는 SW 불필요하지만 무해

### D3. 빌드 산출물

- 워커: `new Worker(new URL('./analysis.worker.ts', import.meta.url), {type:'module'})`
- 워클릿: Vite에서 `?worker&url`이 아닌 `?url`로 모듈 URL 획득 후 `addModule`. **확인 필요**: Vite 8에서 워클릿 번들 처리는 Phase 2 첫 작업으로 스파이크(작은 실험)한다. 실패 시 워클릿 파일을 `public/`에 두고 별도 `esbuild`로 빌드.

---

## E. UI/UX 결정 (디자인 언어 안에서)

변경하지 않는 것은 로드맵 §2. 여기서는 바꾸는 것만.

| 항목 | 현재 | 변경 | 이유 |
|---|---|---|---|
| 튜너 신뢰도 표시 | 없음 | 음이름 불투명도를 conf에 연동 (0.4~1.0) | "확신 없는 값"을 사용자가 보게. 색·요소 추가 없음 |
| 메트로 BPM 변경 | 재시작(끊김) | 다음 박부터 반영 | B6 |
| 접힘/펼침 | maxHeight 애니메이션 | CSS grid | 스냅/클리핑 제거 |
| 편집기 트랙 | 빈 바 | 모노톤 파형(피크 미니맵), A-B 구간만 빨강 틴트 | 구간 잡기의 핵심 정보 |
| 오류 표면화 | 대부분 무음 | 토스트 + 상태점 (AI 점을 "오디오 상태"점으로 재정의) | 조용한 실패 금지 |
| 터치 타겟 | 일부 32px | 최소 44px (시각 크기는 유지, 히트 영역 확장) | 폰 오조작 |
| 첫 실행 | 팝업 | 동일 | 유지 |
| 상태 전이 | 페이지별 상이 | 250 ms, 동일 이징 | 일관성 |

추가하지 않는 것(요청 전까지): 탭 템포, 악기 프리셋 UI, 통계 화면, 온보딩 투어, 소셜 공유.

---

## F. 실행 순서 (로드맵 Phase와 매핑)

| Phase | 이 문서의 절 | 첫 커밋 |
|---|---|---|
| 0 기준선 | A1–A3 | 신호 생성기 + v1 벤치마크 숫자 + 스크린샷 기준선 |
| 1 TS+구조 | C1–C5 | `tsconfig`, 스토어, 카드 모듈화 (동작 0 변경, 스크린샷 diff 0) |
| 2 오디오 코어 | B1–B5, D3 | 워클릿 스파이크 → FFT/YIN → 워커 → 락 → 감지기, 각 단계 벤치마크 |
| 3 메트로/기준음 | B6, B7 | 워클릿 메트로놈 |
| 4 녹음/편집 | C4, D1, E(파형) | 스키마 v2 → 파형 → 네이티브 저장 |
| 5 완결성 | B7 매트릭스, D2 | 생명주기 테스트 → PWA |
| 6 UI/UX | E | 스크린샷 기준선 대비 의도된 변경만 |
| 7 마감 | A(CI) | Actions, 릴리즈, ARCHITECTURE.md |

각 PR의 머지 조건: `tsc` 0 에러, 테스트 통과, 벤치마크 지표 후퇴 없음, 스크린샷 diff는 의도된 것만(승인 목록).

---

## G. 확인 필요 목록

- [ ] Vite 8에서 AudioWorklet 모듈 번들 방식 (Phase 2 스파이크)
- [ ] Android WebView `<a download>` 동작 여부 → Filesystem+Share로 대체 전제
- [ ] 설정 7일 TTL의 원래 의도
- [ ] 저음(첼로/베이스) 정확도가 4096 창으로 충분한지 → 벤치마크로 결정
- [ ] 연주 감지기 말소리 오검출률 → 합성 말소리로 1차, 실사용 피드백으로 2차
- [ ] 햅틱 채택 여부(기본 꺼짐으로 넣고 판단)
