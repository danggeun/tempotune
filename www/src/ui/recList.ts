/** 메뉴의 녹음 목록 — 최신 1개 펼침 + 이전 N개 접힘, 항목별 미니 플레이어 */
import { recListStore, type RecItem } from '../state/index.ts'
import { fmtT } from '../core/format.ts'
import { deleteRec, restoreDeleted, recFileName, REC_TTL } from '../audio/recorder.ts'
import { saveFile } from '../platform/index.ts'
import { toast } from './toast.ts'
import { q, on } from './dom.ts'

/** 자동 이름(YYYYMMDD_HHMM)은 저장명으로 두고 표시는 읽히는 형태로: '9/5 10:50'. 사용자가 바꾼 이름은 그대로 */
export function displayName(item: RecItem): string {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/.exec(item.name)
  return m ? `${+m[2]!}/${+m[3]!} ${m[4]}:${m[5]}` : item.name
}
const players: Record<number, HTMLAudioElement> = {}
function getPlayer(idx: number): HTMLAudioElement {
  let a = players[idx]
  if (!a) {
    a = new Audio(recListStore.get().items[idx]!.url)
    a.ontimeupdate = () => {
      const sk = document.getElementById('rec-seek-' + idx) as HTMLInputElement | null, tm = document.getElementById('rec-time-' + idx)
      if (sk && a!.duration) { sk.max = String(a!.duration); sk.value = String(a!.currentTime) }
      if (tm) tm.textContent = fmtT(a!.currentTime)
    }
    a.onended = () => {
      const btn = document.getElementById('rec-pb-' + idx); if (btn) btn.textContent = '▶'
      const sk = document.getElementById('rec-seek-' + idx) as HTMLInputElement | null; if (sk) sk.value = '0'
      const tm = document.getElementById('rec-time-' + idx); if (tm) tm.textContent = '0:00'
      a!.currentTime = 0
    }
    players[idx] = a
  }
  return a
}
function playPause(idx: number): void {
  const a = getPlayer(idx), btn = document.getElementById('rec-pb-' + idx)
  for (const k of Object.keys(players)) { const i = +k; if (i !== idx && !players[i]!.paused) { players[i]!.pause(); const b = document.getElementById('rec-pb-' + i); if (b) b.textContent = '▶' } }
  if (a.paused) { a.play(); if (btn) btn.textContent = '■' } else { a.pause(); if (btn) btn.textContent = '▶' }
}
function seek(idx: number): void { const sk = document.getElementById('rec-seek-' + idx) as HTMLInputElement | null, a = getPlayer(idx); if (sk && a.duration) a.currentTime = +sk.value }
export function stopPlayer(idx: number): void { const a = players[idx]; if (a) { try { a.pause() } catch { /* */ } delete players[idx] } }

/** 목록 메타 한 줄: 편집 흔적(북마크 n · A-B)과 삭제 예고 — 열어 보기 전에 '어느 녹음인지' 알 수 있게 (UX 감사 B4). 없으면 줄 자체가 없다 */
export function itemMeta(item: RecItem, now = Date.now()): string {
  const parts: string[] = []
  if (item.bookmarks.length) parts.push(`북마크 ${item.bookmarks.length}`)
  if (item.ab) parts.push('A-B')
  const daysLeft = Math.max(0, Math.ceil((item.ts + REC_TTL - now) / 86400000))
  if (daysLeft <= 7) parts.push(daysLeft === 0 ? '오늘 삭제' : `${daysLeft}일 후 삭제`) // 30일 자동 삭제 예고는 마지막 7일만 (정보는 있는 것만)
  return parts.join(' · ')
}

function renderItem(item: RecItem, idx: number, defaultOpen: boolean): HTMLElement {
  const div = document.createElement('div'); div.className = 'rec-item'
  const m = Math.floor(item.dur / 60), s = String(item.dur % 60).padStart(2, '0')
  div.innerHTML = `
      <div class="rec-item-head" data-action="toggle" data-idx="${idx}">
        <div><span class="rec-item-name"></span><div class="rec-item-meta"></div></div>
        <span class="rec-item-dur">${m}:${s}</span>
      </div>
      <div class="rec-item-detail${defaultOpen ? ' open' : ''}" id="rec-detail-${idx}">
        <div class="rec-player">
          <div class="rec-player-top">
            <button class="rec-play-btn" id="rec-pb-${idx}" data-action="play" data-idx="${idx}">▶</button>
            <input type="range" class="rec-seek" id="rec-seek-${idx}" value="0" min="0" step="0.01" data-action="seek" data-idx="${idx}">
            <span class="rec-time" id="rec-time-${idx}">00:00</span>
          </div>
          <div class="rec-item-btns">
            <button class="rec-item-btn" data-action="edit" data-idx="${idx}">편집</button>
            <a class="rec-item-btn rec-dl-link" href="${item.url}" data-action="download" data-idx="${idx}">다운로드</a>
            <button class="rec-item-btn del" data-action="delete" data-idx="${idx}">삭제</button>
          </div>
        </div>
      </div>`
  div.querySelector('.rec-item-name')!.textContent = displayName(item) // 사용자 데이터는 textContent 로만 (인젝션 방지)
  div.querySelector('.rec-item-meta')!.textContent = itemMeta(item)
  ;(div.querySelector('.rec-dl-link') as HTMLAnchorElement).download = recFileName(item)
  return div
}

function render(): void {
  for (const k of Object.keys(players)) { players[+k]!.pause(); delete players[+k] }
  const list = q('rec-list'); list.innerHTML = ''
  const items = recListStore.get().items
  if (items.length === 0) return
  list.appendChild(renderItem(items[0]!, 0, true))
  if (items.length > 1) {
    const oldWrap = document.createElement('div')
    const toggleBtn = document.createElement('button'); toggleBtn.className = 'rec-more'
    toggleBtn.textContent = `이전 녹음 ${items.length - 1}개 보기`
    let oldOpen = false
    const oldList = document.createElement('div'); oldList.className = 'rec-old'
    items.slice(1).forEach((it, i) => oldList.appendChild(renderItem(it, i + 1, false)))
    toggleBtn.onclick = () => {
      oldOpen = !oldOpen
      oldList.classList.toggle('open', oldOpen)
      toggleBtn.textContent = oldOpen ? '이전 녹음 접기' : `이전 녹음 ${items.length - 1}개 보기`
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
      case 'delete': { // 확인 대신 실행 취소 (텍스트 버튼 언어, 5 s 토스트)
        if (!item) break
        beforeDelete(item); stopPlayer(idx); deleteRec(item)
        toast('삭제됨 · 실행 취소', 5000, () => { void restoreDeleted(item, idx) })
        break
      }
      case 'download': { e.preventDefault(); if (item) saveFile(item.blob, recFileName(item)).then(r => { if (!r.ok) toast('저장 실패: ' + r.error) }); break }
    }
  })
  on(list, 'input', (e: Event) => { const t = e.target as HTMLElement; if (t.dataset.action === 'seek') seek(+t.dataset.idx!) })
  recListStore.select(s => s.rev, render)
}
