# test-assets

| 경로 | 내용 | 생성 |
|---|---|---|
| `signals/` | 합성 현악기/잡음 WAV + 정답 JSON (gitignore, 결정적 재생성) | `npm run gen:signals` |
| `bench/baseline-v1.md` | 리팩토링 전(v1) 튜너 벤치마크 기준선 | `npm run bench -- --adapters v1,v1skip4` |
| `screens/baseline/` | 시각 회귀 기준 스크린샷 (커밋됨) | `npm run shots:baseline` |
| `screens/current/` | 최근 실행 결과 + `*.diff.png` (gitignore) | `npm run shots` |

실제 녹음을 추가하려면 `signals/` 에 WAV와 같은 이름의 `.json`(segments 형식은 생성기 참고)을 두면 벤치마크에 자동 포함된다.
스크린샷 스크립트는 Chromium 경로를 `CHROMIUM_PATH` 환경변수로 받는다(없으면 Playwright 기본).
