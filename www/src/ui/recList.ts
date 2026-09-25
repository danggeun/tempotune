/** 메뉴의 녹음 목록 — 최신 1개 펼침 + 이전 N개 접힘, 항목별 미니 플레이어 */
import { recListStore, settingsStore, type RecItem } from '../state/index.ts'
import { fmtT } from '../core/format.ts'
import { deleteRec, restoreDeleted, recFileName, patchRec } from '../audio/recorder.ts'
import { expires, warnDaysLeft } from '../core/recPolicy.ts'
import { PAUSE_GLYPH, PLAY_GLYPH } from './dom.ts'
import { saveFile, isIOS } from '../platform/index.ts'
import { bufToWav } from '../core/wav.ts'
import { recExt } from '../audio/recorder.ts'
import { attachGain, beforePlay, afterStop, detachGain } from '../audio/playback.ts'
import { toast } from './toast.ts'
import { t as tr } from '../core/i18n/index.ts'
import { onLangChange } from './lang.ts'
import { q, on } from './dom.ts'

/** 자동 이름(YYYYMMDD_HHMM)은 저장명으로 두고 표시는 읽히는 형태로: '9/5 10:50'. 사용자가 바꾼 이름은 그대로 */
export function displayName(item: RecItem): string {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/.exec(item.name)
  return m ? `${+m[2]!}/${+m[3]!} ${m[4]}:${m[5]}` : item.name
}
const players: Record<number, HTMLAudioElement> = {}
function setPlayBtn(idx: number, playing: boolean): void { const b = document.getElementById('rec-pb-' + idx); if (b) { b.textContent = playing ? PAUSE_GLYPH : PLAY_GLYPH; b.classList.toggle('playing', playing) } }
function getPlayer(idx: number): HTMLAudioElement {
  let a = players[idx]
  if (!a) {
    const item = recListStore.get().items[idx]!
    a = new Audio(item.url)
    attachGain(a, item.peak) // 녹음 레벨 보정. 게인이 1 이면 요소를 건드리지 않는다
    a.ontimeupdate = () => {
      const sk = document.getElementById('rec-seek-' + idx) as HTMLInputElement | null, tm = document.getElementById('rec-time-' + idx)
      if (sk && a!.duration) { sk.max = String(isFinite(a!.duration) ? a!.duration : item.dur); sk.value = String(a!.currentTime) } // 크로미움 WebM 은 duration 이 Infinity (crbug 642012) — 슬라이더가 100 기준으로 깨진다
      if (tm) tm.textContent = fmtT(a!.currentTime)
    }
    a.onended = () => {
      afterStop(a!)
      setPlayBtn(idx, false)
      const sk = document.getElementById('rec-seek-' + idx) as HTMLInputElement | null; if (sk) sk.value = '0'
      const tm = document.getElementById('rec-time-' + idx); if (tm) tm.textContent = fmtT(0)
      a!.currentTime = 0
    }
    players[idx] = a
  }
  return a
}
function playPause(idx: number): void {
  const a = getPlayer(idx)
  for (const k of Object.keys(players)) { const i = +k; if (i !== idx && !players[i]!.paused) { players[i]!.pause(); afterStop(players[i]!); setPlayBtn(i, false) } }
  if (a.paused) { beforePlay(a); setPlayBtn(idx, true); a.play().catch(() => { afterStop(a); setPlayBtn(idx, false); toast(tr('common.cantPlay')) }) } else { a.pause(); afterStop(a); setPlayBtn(idx, false) }
}
function seek(idx: number): void { const sk = document.getElementById('rec-seek-' + idx) as HTMLInputElement | null, a = getPlayer(idx); if (sk && a.duration) a.currentTime = +sk.value }
/** 옛 webm 녹음을 아이폰에서 열 수 있게 WAV 로 변환할 상한 (디코드 메모리: 48 kHz 모노 10분 ≈ 115 MB) */
export const WAV_RESCUE_MAX_SEC = 600
/** iOS: await 를 거친 뒤에는 탭의 활성화 창이 지나 공유 시트가 거부된다 → 토스트를 띄우고 그 탭 안에서 saveFile. 그 외는 바로 저장 */
export function handOff(blob: Blob, name: string): void {
  const go = (): void => { void saveFile(blob, name).then(r => { if (!r.ok) toast(tr('common.saveFailed', { e: r.error })) }) }
  if (isIOS()) toast(tr('rec.readyTap'), 8000, go); else go()
}
/** 다운로드 (편집기·목록 공용). 아이폰 + webm 녹음이면 WAV 로 변환해 건넨다 */
export async function downloadRec(item: RecItem): Promise<void> {
  if (isIOS() && recExt(item) === 'webm') {
    if (item.dur > WAV_RESCUE_MAX_SEC) { toast(tr('rec.tooLongConvert')); return }
    toast(tr('rec.converting'))
    try {
      const arrayBuf = await (await fetch(item.url)).arrayBuffer()
      const decoded = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(arrayBuf)
      handOff(new Blob([bufToWav(decoded)], { type: 'audio/wav' }), 'tempotune_' + item.name + '.wav')
    } catch (e) { toast(tr('rec.convertFailed', { e: e instanceof Error ? e.message : String(e) })) }
    return
  }
  const r = await saveFile(item.blob, recFileName(item)); if (!r.ok) toast(tr('common.saveFailed', { e: r.error }))
}
/** src 도 비운다 — WebView 는 동시 미디어 플레이어 수에 상한이 있어 붙잡고 있으면 재생이 조용히 실패한다 */
export function releaseAudio(a: HTMLAudioElement): void { detachGain(a); try { a.pause(); a.removeAttribute('src'); a.load() } catch { /* */ } }
export function stopPlayer(idx: number): void { const a = players[idx]; if (a) { releaseAudio(a); delete players[idx] } }

/** 목록 메타 한 줄: 편집 흔적(북마크 n · A-B)과 삭제 예고. link 는 탭할 수 있는 꼬리('남기기' / '자동 삭제 안 함'), 없으면 null */
export function itemMeta(item: RecItem, now = Date.now()): { text: string; link: string | null } {
  const parts: string[] = []
  if (item.bookmarks.length) parts.push(tr('rec.bookmarks', { n: item.bookmarks.length }))
  if (item.ab) parts.push('A-B')
  const autoDelete = settingsStore.get().autoDelete
  let link: string | null = null
  // 남긴 표시는 자동 삭제가 켜져 있을 때만 — 플래그는 남아 다시 켜면 되살아난다
  if (item.keep && autoDelete) link = tr('rec.noAutoDelete')
  else {
    // 30일 자동 삭제 예고는 마지막 7일만. 판정은 persist 와 같은 함수
    const d = warnDaysLeft(item.ts, item.keep, autoDelete, now)
    if (d !== null) { parts.push(d === 0 ? tr('rec.deletesToday') : tr('rec.deletesIn', { n: d })); link = tr('rec.keep') }
  }
  return { text: parts.join(' · '), link }
}
/** 메타 줄 — 글자는 textContent 로, 탭 가능한 꼬리만 span */
function renderMeta(el: Element, item: RecItem, idx: number): void {
  const m = itemMeta(item)
  el.textContent = m.text
  if (m.link) {
    if (m.text) el.append(' · ')
    const a = document.createElement('span'); a.className = 'rec-keep-link'; a.dataset.action = 'keep'; a.dataset.idx = String(idx); a.textContent = m.link
    el.appendChild(a)
  }
}

/** 남기기 토글. 풀 때 이미 기한이 지났다면 다음 실행에서 사라지므로 미리 알린다 */
function toggleKeep(item: RecItem): void {
  const next = !item.keep
  const applied = patchRec(item, { keep: next })
  if (!applied) return
  if (next) { toast(tr('rec.keptToast')); return }
  if (expires(applied.ts, false, settingsStore.get().autoDelete, Date.now())) {
    toast(tr('rec.pastDue'), 5000, () => { patchRec(applied, { keep: true }) })
  } else toast(tr('rec.unkept'))
}

function renderItem(item: RecItem, idx: number, defaultOpen: boolean): HTMLElement {
  const div = document.createElement('div'); div.className = 'rec-item'; div.dataset.idx = String(idx)
  div.innerHTML = `
      <div class="rec-item-head" data-action="toggle" data-idx="${idx}">
        <div><span class="rec-item-name"></span><div class="rec-item-meta"></div></div>
        <span class="rec-item-dur">${fmtT(item.dur)}</span>
      </div>
      <div class="rec-item-detail${defaultOpen ? ' open' : ''}" id="rec-detail-${idx}">
        <div class="rec-player">
          <div class="rec-player-top">
            <button class="rec-play-btn" id="rec-pb-${idx}" data-action="play" data-idx="${idx}">${PLAY_GLYPH}</button>
            <input type="range" class="rec-seek" id="rec-seek-${idx}" value="0" min="0" step="0.01" data-action="seek" data-idx="${idx}">
            <span class="rec-time" id="rec-time-${idx}">00:00</span>
          </div>
          <div class="rec-item-btns">
            <button class="rec-item-btn" data-action="edit" data-idx="${idx}">${tr('rec.edit')}</button>
            <a class="rec-item-btn rec-dl-link" href="${item.url}" data-action="download" data-idx="${idx}">${tr('common.download')}</a>
            <button class="rec-item-btn del" data-action="delete" data-idx="${idx}">${tr('rec.delete')}</button>
          </div>
        </div>
      </div>`
  div.querySelector('.rec-item-name')!.textContent = displayName(item) // 사용자 데이터는 textContent 로만 (인젝션 방지)
  renderMeta(div.querySelector('.rec-item-meta')!, item, idx)
  ;(div.querySelector('.rec-dl-link') as HTMLAnchorElement).download = recFileName(item)
  return div
}

function render(): void {
  for (const k of Object.keys(players)) { releaseAudio(players[+k]!); delete players[+k] }
  const list = q('rec-list'); list.innerHTML = ''
  const items = recListStore.get().items
  if (items.length === 0) { const e = document.createElement('div'); e.id = 'rec-empty'; e.textContent = tr('rec.empty'); list.appendChild(e); return }
  list.appendChild(renderItem(items[0]!, 0, true))
  if (items.length > 1) {
    const oldWrap = document.createElement('div')
    const toggleBtn = document.createElement('button'); toggleBtn.className = 'rec-more'
    toggleBtn.textContent = tr('rec.showOlder', { n: items.length - 1 })
    let oldOpen = false
    const oldList = document.createElement('div'); oldList.className = 'rec-old'
    items.slice(1).forEach((it, i) => oldList.appendChild(renderItem(it, i + 1, false)))
    toggleBtn.onclick = () => {
      oldOpen = !oldOpen
      oldList.classList.toggle('open', oldOpen)
      toggleBtn.textContent = oldOpen ? tr('rec.hideOlder') : tr('rec.showOlder', { n: items.length - 1 })
    }
    oldWrap.appendChild(toggleBtn); oldWrap.appendChild(oldList); list.appendChild(oldWrap)
  }
}

export function mountRecList(openEditor: (item: RecItem) => void, beforeDelete: (item: RecItem) => void): void {
  const list = q('rec-list')
  on(list, 'click', (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-action]'); if (!t) return
    const idx = +t.dataset.idx!, item = recListStore.get().items[idx]
    switch (t.dataset.action) {
      case 'toggle': document.getElementById('rec-detail-' + idx)?.classList.toggle('open'); break
      case 'play': playPause(idx); break
      case 'edit': if (item) openEditor(item); break
      case 'keep': if (item) toggleKeep(item); break
      case 'delete': { // 확인 대신 실행 취소 토스트
        if (!item) break
        beforeDelete(item); stopPlayer(idx)
        void deleteRec(item).then(ok => {
          if (ok) toast(tr('rec.deleted') + tr('common.undoSuffix'), 5000, () => { void restoreDeleted(item, idx) })
          else toast(tr('rec.deleteFailed'))
        })
        break
      }
      case 'download': { e.preventDefault(); if (item) void downloadRec(item); break }
    }
  })
  on(list, 'input', (e: Event) => { const t = e.target as HTMLElement; if (t.dataset.action === 'seek') seek(+t.dataset.idx!) })
  recListStore.select(s => s.rev, render)
  onLangChange(render)
  settingsStore.select(s => s.autoDelete, () => { const st = recListStore.get(); recListStore.set({ rev: st.rev + 1 }) }) // 보관 설정이 바뀌면 예고문 갱신
  // patchRec(items 배열만 교체)에는 메타 줄만 제자리 갱신 — 전체 재렌더는 펼침 상태와 미니 플레이어를 리셋한다
  recListStore.select(s => s.items, items => {
    list.querySelectorAll<HTMLElement>('.rec-item[data-idx]').forEach(el => {
      const it = items[+el.dataset.idx!]; if (!it) return
      const m = el.querySelector('.rec-item-meta'); if (m) renderMeta(m, it, +el.dataset.idx!)
    })
  })
}
