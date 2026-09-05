/**
 * 메트로놈 AudioWorkletProcessor — core/metro/sequencer 를 오디오 스레드에서 돌린다.
 * 메인 → 'pattern' | 'start' | 'stop', 프로세서 → 'click' {tick, kind, t(초, 컨텍스트 시계), dur}
 * 클릭 메시지는 렌더 시점에 보내므로 실제 재생보다 (출력 지연만큼) 먼저 도착한다 — 시각 피드백/튜너 뮤트 예약에 쓴다.
 */
import { createSequencer, CLICK_DUR_S, type Pattern } from '../core/metro/sequencer.ts'

declare const sampleRate: number
declare const currentTime: number
declare const currentFrame: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor { readonly port: MessagePort; constructor() }

class MetroProcessor extends AudioWorkletProcessor {
  private seq = createSequencer(sampleRate, { bpm: 80, timeSig: 4, subDiv: 1, volume: .7, muted: false })
  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'pattern') this.seq.setPattern(m.pattern as Partial<Pattern>)
      else if (m.type === 'start') this.seq.start(Math.round(0.05 * sampleRate)) // 50 ms 뒤 첫 클릭 (v1 과 동일)
      else if (m.type === 'stop') this.seq.stop()
    }
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0]; if (!out) return true
    out.fill(0)
    const events = this.seq.render(out, currentFrame)
    for (const ev of events) this.port.postMessage({ type: 'click', tick: ev.tick, kind: ev.kind, t: currentTime + (ev.sample - currentFrame) / sampleRate, dur: CLICK_DUR_S })
    // 다른 채널에 복사 (스테레오 출력)
    const chs = outputs[0]!; for (let c = 1; c < chs.length; c++) chs[c]!.set(out)
    return true
  }
}
registerProcessor('gp-metro', MetroProcessor)
