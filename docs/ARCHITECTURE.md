# TempoTune — Architecture

## 1. Layers

```
www/src/
  main.ts      Wiring — connects modules, startup sequence, service worker, diagnostics hook window.__tt
  ui/          DOM bindings per card: tuner, refDrum, refPanel, metro, dial, swipeBack, swipeStep, menu, settings, timer,
               micPopup, recHeader, recList, editor, toast, theme, lang. mount*() binds the DOM and subscribes to stores
  audio/       Web Audio adapters: engine (single AudioContext, mic session), analysis (+worker), capture.worklet,
               metronome (+metro.worklet), refTone, recorder, playback, messages
  state/       Stores per domain (settings / tuner / metro / refTone / session / recList). Source of the types
  persist/     Settings in localStorage, recordings in IndexedDB
  platform/    Web / Capacitor branches (status bar, wake lock, full screen, file saving, back button)
  core/        Pure logic, no browser APIs, all unit-tested:
               pitch/(fft, yinFast, spectrum, tracker, dual, analyzer) · playing/detector · metro/(sequencer, arrival, sweep, dial)
               i18n/(ko, en), note, wav, peaks, format, recPolicy, hist, trace, hzReadout, softclip, playbackGain, container,
               yin (reference only, not bundled)
```

Dependency rules (`scripts/check-deps.mjs`, part of `npm run check`):

| Layer | May import |
|---|---|
| core | core |
| state | state, core |
| persist | persist, state, core |
| platform | platform, core (on-screen text only) |
| audio | audio, core, state, persist, platform |
| ui | ui, core, state, audio (commands only), platform |

`ui` never reads `audio` state directly: `ui → audio (command) → store → ui (subscription)`.
No framework. A store is `createStore(initial)` with `get / set / select`. Styles use only the tokens on `:root` in `style.css`.

## 2. Audio pipeline

```
mic ─ getUserMedia ─▶ AudioWorkletNode (capture.worklet)        audio thread
                         │  1024-sample transferable Float32Array over a direct MessagePort
                         ▼
                  Analysis Worker (analysis.worker)             ≈43 Hz
                    ring buffer → 4096 window → FFT-YIN → spectrum (octave correction) → tracker → playing detector
                    a reference other than 440 is normalized before the tracker and restored for display
                         ▼
                  tunerStore.set(...) → ui/tuner renders only the latest value on rAF
```

- One `AudioContext` (engine.ts). It is suspended when idle (no mic, metronome or reference tone). Mic sessions are identified by `micGen`.
- The sample rate is not forced. No SharedArrayBuffer (COOP/COEP can't be set on Pages or in Capacitor).
- The metronome runs in its own worklet (metro.worklet + core/metro/sequencer). Click times (including output latency) are sent to the worker, which lowers confidence for frames in that window.
- Recording uses MediaRecorder: mp4 (AAC) first on iOS and Safari, webm/opus elsewhere. Chunks go to IndexedDB every 10 s, and an unfinished recording is recovered on the next launch.

## 3. Data

| What | Where | Schema |
|---|---|---|
| Settings | `localStorage["tempotune_settings_v1"]` | `{v:2, …}`, value ranges validated on read |
| Recordings | IndexedDB `tempotune_rec` v4 | `recordings` (blob) · `meta` (bookmarks, A-B, waveform, speed, extension, peak, keep) · `chunks` (pieces while recording) |
| Retention | `core/recPolicy` | 30-day TTL (can be turned off), notice in the last 7 days, 60-minute cap |

Changing Capacitor's `androidScheme` or `appId` changes the origin, and the data above is lost.

## 4. Language and theme

- On-screen text lives in `core/i18n/ko.ts` (source) and `en.ts`; the type system requires the same keys in both. Static text in `index.html` carries `data-t` / `data-t-aria` keys that `ui/lang.ts` fills in; dynamic text calls `t(key)`.
- Korean is the default. In English, note names are always C D E and the note-name setting is hidden.
- Colors are tokens with a dark set (`:root`) and a light set (`[data-theme=light]`). The app starts in light: `<html>` carries `data-theme="light"` and the inline script in `index.html` removes it before the first paint when dark is saved.
- A small inline script in `index.html` applies the saved theme and language before the first paint.
- `scripts/i18n.test.mjs` fails if Korean text appears in code outside the dictionary. The English e2e scenario checks every screen for leftover Korean and clipped text.

## 5. Platform branches

Only `platform/index.ts` looks at `window.Capacitor`.

| Feature | Web | Android app |
|---|---|---|
| Saving files | iOS: share sheet (inside a tap) · elsewhere: `<a download>` | `@capacitor/filesystem` → `@capacitor/share` |
| Keep screen on | Wake Lock. iOS web needs a DOM tap for the first request, so it shows a start button first | Same |
| Status bar | `theme-color` meta | `@capacitor/status-bar` |
| Back button | — | backButton: editor → settings → menu → popup; `minimizeApp` on the main screen |
| Service worker | Precache. A new version is applied when idle; otherwise a toast offers it | Not registered |

Builds: `npm run build` (base `/tempotune/`, Pages) · `npm run build:cap` (base `/`, Capacitor).

## 6. Verification

| Layer | Tool |
|---|---|
| Pure logic | Vitest `*.test.ts`, `scripts/*.test.mjs` |
| Tuner benchmark | `npm run bench` — synthetic signals: bias, p90, octave errors, lock latency, F1. Changes to the tuner or detector must not regress |
| Browser integration | `npm run e2e` — headless Chromium with WAV files as a fake mic. `--only <regex>` |
| Visual regression | `npm run shots` — 18 screens (dark, light, English) compared with `test-assets/screens/baseline/` via pixelmatch |
| Module boundaries | `scripts/check-deps.mjs` |

CI (`ci.yml`): check → build → e2e; screenshots run separately. `deploy-pages.yml` deploys only when CI is green on main.

## 7. Android release

```bash
npx cap add android      # once
npm run icons            # only when the icon sources (resources/icon*.svg) change
npm run cap:assets       # launcher icons
npm run cap:sync         # build:cap + cap sync + scripts/cap-manifest.mjs
npx cap open android
```

`cap-manifest.mjs` sets permissions (RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, INTERNET), portrait lock, and `versionName`/`versionCode` (major·10000 + minor·100 + patch) from package.json. Only bump `version` in package.json. Run `npm run cap:sync` right before a signed build.

Signed APK: Android Studio › Build › Generate Signed App Bundle / APK › APK. Keep the keystore outside the repo and back it up (`*.jks` is gitignored).
