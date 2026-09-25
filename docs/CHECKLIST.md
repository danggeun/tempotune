# Feature checklist

User-facing scenarios. `[A]` items are automated (CI checks them every time); `[D]` items need a real device (check once before a release).

## Startup / mic
- [A] First launch opens the mic without a popup (iOS web shows a start button first). If the browser requires a gesture, a start button appears
- [A] Permission already granted → mic turns on automatically, header MIC button hidden
- [A] Permission blocked → popup explaining where to allow it; the header MIC button can retry
- [A] AudioContext starts suspended (for example after an automatic update reload) → start button, and a tap anywhere resumes
- [D] Android app: tries the mic on launch; a toast explains how to allow it if denied

## Tuner
- [A] 440 Hz input with A=442 → A4 (라4), −8 ¢ (WAV injection e2e)
- [A] Cello C2 (65 Hz) → C2 (도2)
- [A] Silence → "--", empty history
- [A] Inside the tolerance the note turns green, the card gets `in-tune`, the band is green
- [A] Sharps show the enharmonic flat
- [A] Reference drum (410–466 Hz) drag → A= updates, cents recalculated, setting saved
- [A] Settings: tolerance ±5/10/15/20/25 changes the band width
- [A] Settings: response slow/normal/fast, mic sensitivity low/normal/high → saved and restored
- [A] The tuner keeps working while the metronome clicks (only click windows are down-weighted)

## Metronome
- [A] Plays without the mic
- [A] Play/stop from the card button, the header button (collapsed and playing) and the space bar
- [A] BPM −/+, drag (2 px per BPM), clamped to 40–200
- [A] Time signatures none/2/4/3/4/4/4/6/8, subdivisions; 6/8 disables subdivisions
- [A] Collapsed and playing: the card and tuner header flash on beats
- [A] Playing never changes the size; the size button cycles collapsed → expanded → full → collapsed
- [A] Dragging the card follows the finger: up grows a step, down shrinks a step; a short drag springs back
- [A] Volume slider (card and full mode stay in sync) → saved and restored
- [A] While recording, clicks are silent and beats stay visible
- [A] Timing: the worklet renders 120 bpm with ≤1-sample jitter over 20 s (OfflineAudioContext e2e)
- [A] Changing BPM while playing takes effect on the next tick without restarting
- [A] Full mode fits every tested screen size without scrolling; dial text keeps its rendered size

## Reference tone
- [A] C–B (with sharps) and C↑; tapping the same button again stops it
- [A] Octave −/+ (2–6), changes apply immediately while playing
- [A] Plays without the mic

## Recording
- [A] Start/stop from the header REC or the menu, elapsed time shown
- [A] Without the mic: "Turn on the mic first"
- [A] New recording at the top of the list, named `YYYYMMDD_HHMM`, with its length
- [A] Newest one open, the rest behind "Show N older recordings"
- [A] Play/pause, seek, only one plays at a time
- [A] Delete removes it from the list and IndexedDB; undo within 5 s
- [A] List survives a restart; items older than 30 days are deleted (can be turned off); last-7-days notice with "Keep"
- [A] An unfinished recording (app killed) is recovered on the next launch
- [A] Download: browser download on the web; Filesystem + share sheet in the Android app — [D] check the share sheet on a device

## Editor
- [A] Opens with title, 00:00 / length, play button enabled when ready
- [A] Play/pause, tap or drag the track to seek
- [A] Speed 0.5–1.5× (`preservesPitch`), remembered per recording
- [A] Set A → set B (after A only) → loop off / on / from 1 s before; drag handles or nudge ±0.25 s
- [A] Works when webm reports an infinite duration (Android MediaRecorder)
- [A] Bookmarks: add (no duplicates within 0.3 s), jump, delete
- [A] Save A–B → WAV
- [A] Waveform on the track (peaks computed once and stored)
- [A] Bookmarks and A-B are stored with the recording and survive a restart
- [A] Rename persists
- [A] Back returns to the menu, stops audio, releases handlers

## Timer
- [A] Start/stop/reset; elapsed always counts, playing time only while playing is detected
- [A] Reset shows an undo toast that restores the counts and running state
- [A] 15 minutes without sound → mic turns off with a toast

## Robustness
- [A] Offline: the service worker precache lets the tuner run after a reload without network; fonts are self-hosted
- [A] If the context is stopped from outside (iOS "interrupted"), it resumes on return; if it can't within 1.5 s, the metronome stops with a notice
- [A] App update: a new service worker is applied only when idle (no mic session in use, metronome, recording or editor)
- [D] Android app going to the background saves an in-progress recording
- [A] Idle (mic off, metronome stopped, no reference tone) suspends the context and releases audio focus
- [A] getUserMedia errors become actionable messages (no mic / another app / HTTPS required)
- [A] No silent failures: settings save, recording storage, edit info and wake lock problems all show a toast
- [A] Worker frame p95 < 12 ms in headless Chromium — [D] check real phones with `window.__tt.stats()`
- [D] Android back button: editor → settings → menu → popup, then background on the main screen
- [D] Phone calls during and after use, Bluetooth headphone latency

## Look and feel
- [A] Screenshot baselines: 18 screens (dark, light, English) match pixel for pixel
- [A] Touch targets are at least 44 px (visible size unchanged)
- [A] Text and control contrast meets WCAG AA in both themes
- [A] Theme: light by default, dark in Settings › Appearance, independent of the system setting; applied before the first paint; status bar follows
- [A] Language: Korean by default, English in Settings › Language; no Korean left on any screen in English, nothing clipped, survives a reload
- [A] Header LED row fits with a three-digit BPM on 360 px phones
- [D] Readable from 60–90 cm; REC, size and drum usable while holding a bow
- [D] Larger system font sizes on the tuner card layout
- [D] Android 15 edge-to-edge: header clear of the status bar; adaptive launcher icon; app name "TempoTune"
- [D] iPhone home-screen app: no gap at the bottom (iOS 26), nothing cut off in either theme

## Settings / other
- [A] Keep screen on on/off (Wake Lock)
- [A] Playing detection: speech and noise don't count; sustained string tones count after about 0.3 s
- [A] Note names 도레미 / C D E in Korean (the other system shown small); always C D E in English
- [A] Recordings kept 30 days / forever; version shown at the bottom of Settings
- [A] Landscape on small phones (height ≤ 500 px) shows a notice
