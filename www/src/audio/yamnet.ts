/**
 * YAMNet(TensorFlow.js) 현악기 분류 — v1 그대로. Phase 2에서 신호처리 감지기로 대체 예정(설계서 §B5).
 * tf 전역은 index.html 의 CDN 스크립트가 제공한다.
 */
import { CFG } from '../state/index.ts'
import { A } from './engine.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const tf: any

type Status = 'loading' | 'ready'
let model: { predict(x: unknown): unknown } | null = null
let ready = false, running = false, saysString = false
const statusListeners: Array<(s: Status) => void> = []
export function onYamnetStatus(fn: (s: Status) => void): void { statusListeners.push(fn) }
function setStatus(s: Status) { for (const f of statusListeners) f(s) }

export async function loadYamnet(): Promise<void> {
  setStatus('loading')
  try {
    let w = 0; while (typeof tf === 'undefined' && w < 10000) { await new Promise(r => setTimeout(r, 200)); w += 200 }
    model = await tf.loadGraphModel('https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1', { fromTFHub: true })
    ready = true; setStatus('ready')
  } catch { ready = true; setStatus('ready') } // v1 동작: 실패해도 '준비됨' — Phase 2에서 표면화
}
export const yamnetAvailable = (): boolean => !!model
export const yamnetSaysString = (): boolean => saysString
export function resetYamnet(): void { saysString = false }
export const yamnetReady = (): boolean => ready

export async function runYamnet(): Promise<void> {
  const Y = CFG.yamnet
  if (!model || running || A.pcmPos < Y.inputLen) return
  running = true; let wf: { dispose(): void } | null = null, res: unknown = null
  try {
    const s = new Float32Array(Y.inputLen), st = A.pcmPos - Y.inputLen
    for (let i = 0; i < Y.inputLen; i++) s[i] = A.pcm16k[(st + i) % A.pcm16k.length]!
    wf = tf.tensor1d(s); res = model.predict(wf)
    const sc = Array.isArray(res) ? res[0] : res
    const arr = await sc.array(), flat: number[] = Array.isArray(arr[0]) ? arr[0] : arr
    let mx = 0; for (const idx of Y.stringIdx) { if (flat[idx]! > mx) mx = flat[idx]! }
    saysString = mx >= Y.threshold
  } catch { saysString = true }
  finally {
    if (wf) wf.dispose()
    if (res) { if (Array.isArray(res)) res.forEach((t: { dispose(): void }) => t.dispose()); else (res as { dispose(): void }).dispose() }
    running = false
  }
}
