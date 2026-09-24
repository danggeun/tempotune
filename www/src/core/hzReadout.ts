/**
 * Hz 읽기표시의 문자열·갱신 규칙. 값은 6칸 고정 오른쪽 맞춤(모노스페이스 + white-space:pre 전제).
 * 지수 평활 + 100 ms 갱신 제한으로 마지막 자리 떨림을 누르고, 음이 바뀌면 평활을 버린다.
 */
export function fmtHz(hz: number): string {
  if (!isFinite(hz) || hz <= 0) return ''
  return hz.toFixed(1).padStart(6, ' ') + ' Hz'
}

export type HzReadout = {
  /** 새 프레임. 화면에 쓸 문자열을 주거나, 아직 갱신할 때가 아니면 null. hz ≤ 0 이면 '' (비움) */
  push(hz: number, midi: number, nowMs: number): string | null
  reset(): void
}

export function createHzReadout(opt: { alpha?: number; everyMs?: number } = {}): HzReadout {
  const alpha = opt.alpha ?? 0.35, everyMs = opt.everyMs ?? 100
  let ema = -1, lastMidi = -1, lastShownMs = -Infinity, lastText = ''
  return {
    push(hz, midi, nowMs) {
      if (!(hz > 0)) { // 무음·마이크 꺼짐: 지연 없이 비운다
        ema = -1; lastMidi = -1; lastShownMs = -Infinity
        if (lastText === '') return null
        lastText = ''; return ''
      }
      if (midi !== lastMidi || ema < 0) { ema = hz; lastMidi = midi; lastShownMs = -Infinity } // 새 음: 평활 버리고 바로 표시
      else ema += alpha * (hz - ema)
      if (nowMs - lastShownMs < everyMs) return null
      lastShownMs = nowMs
      const t = fmtHz(ema)
      if (t === lastText) return null
      lastText = t; return t
    },
    reset() { ema = -1; lastMidi = -1; lastShownMs = -Infinity; lastText = '' },
  }
}
