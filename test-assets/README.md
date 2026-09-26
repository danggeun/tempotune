# test-assets

| Path | Contents | Made by |
|---|---|---|
| `signals/` | Synthetic string and noise WAVs with answer JSON (gitignored, regenerated deterministically) | `npm run gen:signals` |
| `bench/latest.md` | Latest tuner benchmark, overwritten on every run | `npm run bench` |
| `bench/baseline-v1.md` | Tuner benchmark baseline from before the v1 refactor | `npm run bench -- --adapters v1,v1skip4` |
| `bench/phase2-v1-vs-v2.md` | v1 vs v2 tuner comparison from the 2.0.0 rebuild, kept for reference | one-off run |
| `screens/baseline/` | Visual regression baselines (committed) | `npm run shots:baseline` |
| `screens/current/` | Latest run with `*.diff.png` (gitignored) | `npm run shots` |

To add a real recording to the benchmark, put a WAV in `signals/` with a `.json` of the same name (see the generator for the segment format).
The screenshot script takes the Chromium path from `CHROMIUM_PATH` (Playwright's default otherwise).
