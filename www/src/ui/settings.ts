/** 설정 페이지의 단계 버튼 ↔ settingsStore */
import { settingsStore, RMS_LEVELS, SMOOTH_LEVELS } from '../state/index.ts'
import { q, qsa, on } from './dom.ts'

function bindSteps(groupId: string, onPick: (v: number) => void): void {
  qsa<HTMLElement>(`#${groupId} .step-btn`).forEach(b => on(b, 'click', () => onPick(+b.dataset.v!)))
}
function markSteps(groupId: string, v: number): void { qsa<HTMLElement>(`#${groupId} .step-btn`).forEach(b => b.classList.toggle('on', +b.dataset.v! === v)) }
const levelIndex = (levels: readonly number[], v: number) => levels.findIndex(x => Math.abs(x - v) < .001) + 1

export function mountSettings(): void {
  bindSteps('cents-steps', v => settingsStore.set({ tolCents: v }))
  bindSteps('rms-steps', v => { const r = RMS_LEVELS[v - 1]; if (r) settingsStore.set({ rmsMin: r }) })
  bindSteps('smooth-steps', v => { const s = SMOOTH_LEVELS[v - 1]; if (s) settingsStore.set({ smoothing: s }) })
  bindSteps('wakelock-steps', v => settingsStore.set({ wakeLock: v === 1 }))
  bindSteps('notenames-steps', v => settingsStore.set({ noteNames: v === 1 ? 'en' : 'ko' }))
  bindSteps('autodelete-steps', v => settingsStore.set({ autoDelete: v === 1 }))

  settingsStore.select(s => s.tolCents, v => markSteps('cents-steps', v), { immediate: true })
  settingsStore.select(s => s.rmsMin, v => { const i = levelIndex(RMS_LEVELS, v); if (i) markSteps('rms-steps', i) }, { immediate: true })
  settingsStore.select(s => s.smoothing, v => { const i = levelIndex(SMOOTH_LEVELS, v); if (i) markSteps('smooth-steps', i) }, { immediate: true })
  settingsStore.select(s => s.wakeLock, v => markSteps('wakelock-steps', v ? 1 : 0), { immediate: true })
  settingsStore.select(s => s.noteNames, v => markSteps('notenames-steps', v === 'en' ? 1 : 0), { immediate: true })
  settingsStore.select(s => s.autoDelete, v => markSteps('autodelete-steps', v ? 1 : 0), { immediate: true })
  q('settings-version').textContent = `Go practice ${__APP_VERSION__}` // 베타 피드백에 버전이 있어야 대화가 된다
}
