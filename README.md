# Intonome

> **in time, in tune.**
> Chromatic tuner, metronome, reference tones and a practice recorder for string players.
> Web (PWA) and Android (Capacitor). Works offline; audio never leaves the device.

[![CI](https://github.com/danggeun/intonome/actions/workflows/ci.yml/badge.svg)](https://github.com/danggeun/intonome/actions/workflows/ci.yml)
[![Live](https://img.shields.io/badge/Web-Live-22c55e?style=flat-square)](https://danggeun.github.io/intonome/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

**<https://danggeun.github.io/intonome/>** — current Chrome, Safari and Edge. Add it to your home screen to use it as an offline app.

Korean by default; English in Settings › Language.

## Features

- **Tuner** — 40 Hz (double bass E1) to 4.2 kHz, reference A = 410–466 Hz, tolerance ±5–25 ¢, pitch trace, double stops.
- **Metronome** — sample-accurate clicks from an AudioWorklet, steady with the screen off. 40–200 BPM, 2/4 · 3/4 · 4/4 · 6/8, four subdivisions, a full-screen dial.
- **Reference tones** — C to B with sharps, octaves 2–6, no mic needed.
- **Recorder and editor** — waveform, A-B loop, zoom, bookmarks, 0.5–1.5× speed, save a section as WAV. Recordings are saved every 10 s and recovered if the app is killed.
- **Practice timer** — counts the time you actually played; speech and noise are ignored.
- Dark and light themes, touch targets of 44 px, WCAG AA contrast.

## Run

```bash
npm install          # Node 22+
npm run dev          # http://localhost:5173 — the mic needs localhost or HTTPS
npm run build        # for GitHub Pages (base=/intonome/) → dist/
```

## Verify

```bash
npm run check        # type check + module boundaries + unit tests (Vitest)
npm run e2e          # scenarios in headless Chromium with WAV files as a fake mic
npm run shots        # screenshot comparison against the baselines
npm run bench        # tuner accuracy on synthetic signals
npm run verify       # check + shots + e2e
```

e2e and screenshots need Playwright's Chromium: `npx playwright install chromium` (or point `CHROMIUM_PATH` at an existing Chrome).
CI runs the same checks on every push and PR, and deploys to GitHub Pages when `main` is green.

The source is split into `core / state / audio / persist / platform / ui` layers — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Android

```bash
npx cap add android   # once (android/ is generated, not in the repo)
npm run cap:assets    # launcher icons
npm run cap:sync      # Capacitor build + sync + manifest fixes
npx cap open android  # Android Studio → Build › Generate Signed App Bundle / APK
```

Don't change `androidScheme` or `appId` in `capacitor.config.json` — a new origin loses saved recordings and settings, and the store doesn't allow a new `appId`. Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#7-android-release).

## Privacy

Mic input and recordings are processed and stored only on the device. Nothing is sent to a server, and there are no analytics or ad SDKs. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE). The bundled DM Mono font is under the SIL Open Font License. Note icons are drawn from glyphs of the Bravura music font (© Steinberg Media Technologies, SIL Open Font License) — see `scripts/gen-note-glyphs.py`.
