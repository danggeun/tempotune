/**
 * 전용 모드 다이얼 (v2.3.0) — 실물 메트로놈의 다이얼처럼 링을 돌려 BPM 을 정한다.
 * 수학은 core/metro/dial.ts. 여기서는 SVG 를 한 번 만들고, BPM 이 바뀌면 바늘과 채움 호만 움직인다.
 *
 * 그림 (viewBox 320, 중심 160):
 *   r 112  링(트랙) + 시작~현재의 채움 호 + 현재 위치의 바늘점
 *   r 119~ 눈금: 5 BPM 마다 짧게, 20 BPM 마다 길게. 숫자는 눈금 끝 바깥쪽으로 정렬(outwardAnchor) — 겹치지 않는다
 *   r 94   템포 이름 — 링 안쪽, 이정표 넷만, 흐리게 (ARC_LABELS 의 이유 참고)
 * 가운데의 숫자·용어는 HTML(#dial-bpm, #dial-name) — 글꼴이 앱과 같아야 해서 SVG text 를 안 쓴다.
 *
 * 조작: 링 어디든 누르고 **돌린 만큼**만 변한다(상대 회전). 잡는 순간 값이 튀지 않는다.
 *   1.35°/BPM (20~220 이 270°) — 반지름 118 에서 약 2.8 px/BPM. 세로 ↕ 드래그(2 px/BPM)와 비슷한 손맛.
 *   −/+ 버튼은 ±1 미세 조정으로 그대로 둔다.
 */
import { bpmToAngle, degPerBpm, angleDelta, pointToAngle, polar, arcPath, tempoName, ARC_LABELS } from '../core/metro/dial.ts'
import { CFG } from '../state/index.ts'
import { q, on } from './dom.ts'

const NS = 'http://www.w3.org/2000/svg'
const C = 160, R_RING = 112, R_TICK0 = 119, R_NUM = 133, R_NAME = 94
const A0 = -135, A1 = 135

/** 숫자를 눈금 **바깥쪽으로** 붙인다 — 중심에서 본 방향에 따라 정렬점을 바꿔, 글자가 항상 눈금에서 멀어지는 쪽으로 자란다 */
function outwardAnchor(deg: number): { anchor: string; baseline: string } {
  const a = (deg * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a)
  return {
    anchor: dx > 0.35 ? 'start' : dx < -0.35 ? 'end' : 'middle',
    baseline: dy > 0.35 ? 'hanging' : dy < -0.35 ? 'alphabetic' : 'central',
  }
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag)
  for (const k in attrs) e.setAttribute(k, String(attrs[k]))
  return e
}

let fill: SVGPathElement, needle: SVGCircleElement, built = false

export function buildDial(): void {
  if (built) return
  built = true
  const { bpmMin: min, bpmMax: max } = CFG.metro
  const svg = q<HTMLElement>('dial-svg') as unknown as SVGSVGElement
  svg.setAttribute('viewBox', '0 0 320 320')

  // 트랙
  svg.appendChild(el('path', { d: arcPath(C, C, R_RING, A0, A1), class: 'dial-track' }))
  // 눈금 + 숫자
  for (let b = min; b <= max; b += 5) {
    const a = bpmToAngle(b, min, max), major = b % 20 === 0
    const p0 = polar(C, C, R_TICK0, a), p1 = polar(C, C, R_TICK0 + (major ? 9 : 5), a)
    svg.appendChild(el('line', { x1: p0.x.toFixed(2), y1: p0.y.toFixed(2), x2: p1.x.toFixed(2), y2: p1.y.toFixed(2), class: major ? 'dial-tick major' : 'dial-tick' }))
    if (major) {
      const pn = polar(C, C, R_NUM, a), { anchor, baseline } = outwardAnchor(a)
      const t = el('text', { x: pn.x.toFixed(2), y: pn.y.toFixed(2), class: 'dial-num', 'text-anchor': anchor, 'dominant-baseline': baseline })
      t.textContent = String(b); svg.appendChild(t)
    }
  }
  // 템포 이름 — 링 **안쪽** 호를 따라, 구간 가운데 정렬. 실물 다이얼도 용어는 판 안에 인쇄돼 있다 — 바깥 숫자와 다투지 않는다
  const defs = el('defs', {}); svg.appendChild(defs)
  ARC_LABELS.forEach(([name, from, to], i) => {
    const id = `dial-arc-${i}`
    defs.appendChild(el('path', { id, d: arcPath(C, C, R_NAME, bpmToAngle(from, min, max), bpmToAngle(to, min, max)) }))
    const t = el('text', { class: 'dial-name' })
    const tp = el('textPath', { href: `#${id}`, startOffset: '50%', 'text-anchor': 'middle' })
    tp.setAttribute('href', `#${id}`); tp.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${id}`)
    tp.textContent = name; t.appendChild(tp); svg.appendChild(t)
  })
  // 채움 호 + 바늘점 (맨 위에)
  fill = el('path', { d: '', class: 'dial-fill' }); svg.appendChild(fill)
  needle = el('circle', { cx: C, cy: C, r: 8, class: 'dial-needle' }); svg.appendChild(needle)

  attachRotate(q('dial'))
}

/** BPM → 바늘·채움·숫자·용어 */
export function setDialBpm(bpm: number): void {
  if (!built) return
  const { bpmMin: min, bpmMax: max } = CFG.metro
  const a = bpmToAngle(bpm, min, max), p = polar(C, C, R_RING, a)
  needle.setAttribute('cx', p.x.toFixed(2)); needle.setAttribute('cy', p.y.toFixed(2))
  fill.setAttribute('d', a > A0 + 0.01 ? arcPath(C, C, R_RING, A0, a) : '')
  q('dial-bpm').textContent = String(bpm)
  q('dial-name').textContent = tempoName(bpm)
}

let onChange: ((bpm: number) => void) | null = null
export function onDialChange(fn: (bpm: number) => void): void { onChange = fn }

function attachRotate(host: HTMLElement): void {
  let active = false, lastA = 0, acc = 0, base = 0
  const center = () => { const r = host.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
  on(host, 'pointerdown', (e: PointerEvent) => {
    active = true; acc = 0; base = +q('dial-bpm').textContent!
    const c = center(); lastA = pointToAngle(e.clientX - c.x, e.clientY - c.y)
    host.setPointerCapture(e.pointerId); e.preventDefault()
  })
  on(host, 'pointermove', (e: PointerEvent) => {
    if (!active) return
    const c = center(), a = pointToAngle(e.clientX - c.x, e.clientY - c.y)
    const { bpmMin: min, bpmMax: max } = CFG.metro, dpb = degPerBpm(min, max)
    acc += angleDelta(lastA, a); lastA = a
    acc = Math.max((min - base) * dpb, Math.min((max - base) * dpb, acc)) // 끝에서 멈춘다 — 실물 다이얼처럼. 넘겨 돌린 만큼을 되감을 필요가 없다
    const next = Math.round(base + acc / dpb)
    if (onChange && next !== +q('dial-bpm').textContent!) onChange(next)
  })
  const end = () => { active = false }
  on(host, 'pointerup', end); on(host, 'pointercancel', end)
}
