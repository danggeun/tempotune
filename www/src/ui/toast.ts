import { q } from './dom.ts'
let t: ReturnType<typeof setTimeout> | null = null
export function toast(msg: string): void {
  const el = q('toast'); el.textContent = msg; el.classList.add('show')
  if (t) clearTimeout(t)
  t = setTimeout(() => el.classList.remove('show'), 2500)
}
