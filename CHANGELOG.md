# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [SemVer](https://semver.org/).

## [2.4.0] — 2026-09-25
- English — Settings › Language switches between 한국어 and English (Korean stays the default). Every screen, message and label is translated; note names are C D E in English
- Recovered recordings are named with `_recovered` in English
- Repository docs are now in English

## [2.3.8] — 2026-09-25
- Tuner ♭/♯ looked stretched on the iPhone start screen
- Removed the status bar notice when switching themes — it changes right away
- First-beat LED in light mode is black with a stronger glow (the counterpart of white with a glow in dark)
- Dragging the metronome card follows your finger up and down; a short drag springs back, a longer drag or a flick moves one step (upward too)
- When audio opens paused (for example right after an update), a tap anywhere starts it, not just the start button
- The iPhone home-screen app left a gap at the bottom when launched in light mode

## [2.3.7] — 2026-09-25
- Light mode — choose dark or light in Settings (dark by default)
- A three-digit BPM pushed the right-hand buttons out of the collapsed card while playing
- Expanded → full filled in from the top instead of growing upward
- The iPhone home-screen app left a gap the height of the status bar at the bottom
- The dial shows tempo terms (LARGO, ANDANTE, ALLEGRO, PRESTO) on smaller screens too

## [2.3.6] — 2026-09-25
- Removed the settings button from the menu (settings is the ⚙ in the header)
- First-beat LED is the same size as the other beats, told apart by color only, with less glow

## [2.3.5] — 2026-09-25
- Recordings are saved every 10 seconds and recovered on the next launch if the app is killed
- A new version is applied when the app is idle, otherwise you're notified. Build number next to the version in Settings
- Mac Safari records mp4 too
- Deploys only after CI passes

## [2.3.4] — 2026-09-24
### Recording and editing
- Cutting A-B from long recordings froze on iPhone
- Saving on iPhone did nothing — now "Ready · Tap to save"
- Downloads from the list also convert old webm recordings to WAV for iPhone
- Cut sections get the same loudness correction as in-app playback
- Android list seek bar, editing during delete-undo, errors right after starting a recording
### Mic
- Leaving the app while the mic was opening left it open in the background
- Tapping didn't restart audio after an interruption
- Leaving and returning quickly left the start button over the tuner
### Metronome
- Dragging BPM down collapsed the card
- Rapid size taps and full → collapsed jumped
- Swiping down on Android Chrome reloaded the page
- Subdivisions stayed on in 6/8, BPM jumped after an interrupted touch, holding Space repeated

## [2.3.3] — 2026-09-22
- The full-screen metronome is now the second step of "expanded" — header, mic and recording stay; only the tuner hides
- Animated expanded ↔ full ↔ collapsed transitions. Size button shows ∧ ∧ ∨
- METRONOME title at the top of full mode
- LEDs light at the same moment as the sound
- iPhone web app: the start button turns on keep-screen-on and the mic together

## [2.3.2] — 2026-09-21
- One size button that cycles; swipe the card down to go down a step
- BPM range 40–200 (finer dial)
- Changing the time signature while playing starts from the left
- Selected time signature and rhythm: brighter with a red border. Full-screen beat flash only when collapsed
- Header: ☰ on the left, ⚙ settings on the right. Settings closes with X
- The metronome stops when you leave the app

## [2.3.1] — 2026-09-20
- Full mode fits every screen size without scrolling; dial text keeps its size
- Removed the app name from the header; full-screen toggle moved to Settings
- Removed the beat flash in full mode; first-beat LED is white
- The hint flickered while the mic was reopening
- One notation for sharps' secondary name (`A♯/B♭`)
- Subdivision note spacing

## [2.3.0] — 2026-09-17
- Hz readout on the tuner
- Full-screen metronome with a round dial (turn it to set BPM) and tempo terms
- Swipe from the left edge to go back (menu, settings, editor)

## [2.2.0] — 2026-09-17
- The mic froze after turning it off and on in iOS
- Removed the tuner needle (the trace shows the same thing)
- Subdivisions drawn as real notation (beams, triplets, dotted), sixteenths added
- "None" time signature (beats only)
- Seiko-style LED beat display
- Full-screen metronome
- The mic is released while the editor is open
- Android icon padding

## [2.1.0] — 2026-09-15
- Renamed to TempoTune, new icon, new storage and identifiers (old data cleaned up)
- Playing no longer collapses the metronome
- The permission popup appears only when the mic is really blocked
- Contrast and color adjustments; the trace is always white
- The trace broke up while playing
- The mic is released when the app is hidden so other apps can use it
- Metronome clicks were picked up as notes (automatic latency compensation)
- "Keep" for recordings (excluded from auto-delete)
- Waveforms for short recordings, undo for several deletes in a row, save and delete failures handled
- Android auto-backup off, no external font requests
- Space key, accessibility, long names, editor dragging

## [2.0.2] — 2026-09-13
- iPhone recordings were saved in a format that couldn't be opened — now mp4, saved via the share sheet
- The tuner display jumped when the note changed; 4-second trace window
- Sensitivity tuned so muted playing is detected
- Note names wobbled during double stops
- Pitch of the lower note in double stops
- Dark only
- Loudness correction for recording playback; metronome click volume

## [2.0.1] — 2026-09-06
- Double stops showed a lower note that wasn't played — now follows the upper voice

## [2.0.0] — 2026-09-05
- Rebuilt in TypeScript, AudioWorklet + Worker analysis, offline playing detection
- Sample-accurate metronome, single AudioContext
- Recording editor (A-B, bookmarks, waveform, speed), saving on Android
- PWA, offline, design tokens, CI

## [1.0.0] — 2026-06-01
- Single-file web prototype
