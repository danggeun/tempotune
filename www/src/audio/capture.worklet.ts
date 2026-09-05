/**
 * AudioWorkletProcessor — 마이크 입력을 1024 샘플 청크로 모아 워커에 직접 보낸다(메인 스레드 경유 없음).
 * 메인이 MessageChannel 의 한쪽 포트를 'port' 메시지로 넘겨주면 그쪽으로 보내고, 없으면 자기 포트로 보낸다.
 * 이 파일은 AudioWorkletGlobalScope 에서 실행된다 — DOM/모듈 import 없음.
 */
declare const sampleRate: number
declare const currentTime: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor { readonly port: MessagePort; constructor() }

const CHUNK = 1024

class CaptureProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(CHUNK)
  private pos = 0
  private out: MessagePort | null = null
  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent) => { if (e.data && e.data.type === 'port') this.out = e.data.port }
  }
  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.pos++] = ch[i]!
      if (this.pos === CHUNK) {
        const c = this.buf; this.buf = new Float32Array(CHUNK); this.pos = 0
        ;(this.out ?? this.port).postMessage({ type: 'chunk', chunk: c, t: currentTime + ch.length / sampleRate }, [c.buffer])
      }
    }
    return true
  }
}
registerProcessor('gp-capture', CaptureProcessor)
