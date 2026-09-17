/**
 * Hz 읽기표시 (v2.3.0) — 음이름 왼쪽, ¢ 의 거울 자리.
 *
 * 두 가지를 여기서 정한다. 화면은 모른다.
 *  1) 글자 폭: 값을 **6칸 고정**으로 오른쪽 맞춤해 "Hz" 가 자리를 옮기지 않는다.
 *     "  65.4 Hz" / " 196.0 Hz" / "1046.5 Hz" — 첼로 C2 부터 바이올린 E7 까지 한 폭.
 *     (모노스페이스 + white-space:pre 가 전제. 등폭이 아니면 이 계약이 깨진다.)
 *  2) 흔들림: 분석기는 프레임마다(~43/s) 새 hz 를 내고, 0.1 Hz 는 440 Hz 에서 0.4¢ 라 비브라토·잡음이
 *     그대로 마지막 자리에 나온다. ¢ 는 정수라 조용한데 Hz 만 떨면 거슬린다.
 *     그래서 (a) 지수 평활로 값을 눌러 주고 (b) 화면 갱신은 100 ms 에 한 번으로 제한한다.
 *     음이 바뀌면 평활을 버린다 — 라 에서 미 로 미끄러져 가는 숫자는 정보가 아니라 잡음이다.
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
      if (!(hz > 0)) { // 무음·마이크 꺼짐 — 즉시 비운다 (지연 없이)
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
