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
  private buf: Float32Array<ArrayBuffer> = new Float32Array(CHUNK)
  private pos = 0
  private out: MessagePort | null = null
  /** 워커가 반납한 버퍼 — 오디오 스레드에서 new 를 피한다 (GC 스캐빈지가 128-샘플 콜백을 넘기지 않게) */
  private free: Float32Array<ArrayBuffer>[] = []
  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'port') { this.out = e.data.port; this.out!.onmessage = ev => this.onRecycle(ev) }
    }
  }
  private onRecycle(e: MessageEvent): void {
    if (e.data && e.data.type === 'recycle' && this.free.length < 8) this.free.push(new Float32Array(e.data.buf as ArrayBuffer))
  }
  process(inputs: Float32Array[][]): boolean {
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
