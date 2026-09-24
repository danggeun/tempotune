/**
 * AudioWorkletProcessor — 마이크 입력을 1024 샘플 청크로 모아 워커 포트('port' 메시지)로 직접 보낸다.
 * AudioWorkletGlobalScope 에서 실행 — DOM/모듈 import 없음.
 */
declare const sampleRate: number
declare const currentTime: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor { readonly port: MessagePort; constructor() }

const CHUNK = 1024

class CaptureProcessor extends AudioWorkletProcessor {
  private buf: Float32Array<ArrayBuffer> = new Float32Array(CHUNK)
  private pos = 0
  private out: MessagePort | null = null
  /** 워커가 반납한 버퍼 — 오디오 스레드에서 new 를 피한다 (GC 가 128-샘플 콜백을 넘기지 않게) */
  private free: Float32Array<ArrayBuffer>[] = []
  /** 'stop' 후 process 가 false 를 돌려 프로세서를 수거 — 안 그러면 마이크 세션마다 좀비 프로세서가 남는다 */
  private stopped = false
  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'port') { this.out = e.data.port; this.out!.onmessage = ev => this.onRecycle(ev) }
      else if (e.data && e.data.type === 'stop') { this.stopped = true; this.out?.close(); this.out = null }
    }
  }
  private onRecycle(e: MessageEvent): void {
    if (e.data && e.data.type === 'recycle' && this.free.length < 8) this.free.push(new Float32Array(e.data.buf as ArrayBuffer))
  }
  process(inputs: Float32Array[][]): boolean {
    if (this.stopped) return false
    const ch = inputs[0]?.[0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.pos++] = ch[i]!
      if (this.pos === CHUNK) {
        const c = this.buf; this.buf = this.free.pop() ?? new Float32Array(CHUNK); this.pos = 0
        ;(this.out ?? this.port).postMessage({ type: 'chunk', chunk: c, t: currentTime + ch.length / sampleRate }, [c.buffer])
      }
    }
    return true
  }
}
registerProcessor('gp-capture', CaptureProcessor)
