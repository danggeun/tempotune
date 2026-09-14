#!/usr/bin/env node
// 디자인 후보 전후 렌더 — 실제 앱·실제 화면에 CSS 후보를 덧입혀 나란히 찍는다.
// 사용: CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/render-design.mjs   (출력: /tmp/dshots)
// 왜: "취향이면 그림으로 보고 정하자". 색·대비 후보를 말로 논쟁하지 않고 같은 화면에서 비교한다.
//     v2.0.3 의 D1~D5 판단이 이 스크립트로 나왔다 (「v2.0.3 계획 (확정안)」 §4).
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'
const ROOT='/tmp/claude-0/-home-claude/5d3bca13-78f2-5bd4-a9ff-0446b5427b7f/scratchpad/go_practice'
const OUT='/tmp/dshots'; mkdirSync(OUT,{recursive:true})
execSync('npx vite build --base=/',{cwd:ROOT,stdio:'ignore'})
const PORT=4179
const server=spawn('npx',['-y','serve','-s','-l',String(PORT),ROOT+'/dist'],{stdio:'ignore',detached:true})
await new Promise(r=>setTimeout(r,2500))
const SIG=ROOT+'/test-assets/signals/silence_lowfloor.wav'
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${SIG}%noloop`,'--autoplay-policy=no-user-gesture-required']})
const BTN='.compact-btn,#metro-collapse-btn,.m-adj,.m-seg,.menu-btn-sm,.rec-item-btn,.rec-more,.menu-action,.step-row,.ed-ab-btn,#ed-dl-btn,#ed-export-btn,.m-adj-pad'
const V={
  '0_현재':'',
  '1_D1D2_보조글자':':root{--text-3:#8a8a8a;--tuner-text-3:#7a7a7a}',
  '2_D3_버튼테두리':`${BTN}{border-color:#6a6a6a!important}`,
  '3_D4_음이름덜희게':'#tuner-note,#tuner-acc{color:#ededed!important} #tuner-note.tune,#tuner-acc.tune{color:var(--ok)!important}',
  '4_D5_바탕한톤위':':root{--bg:#121212}',
  '5_전부':`:root{--text-3:#8a8a8a;--tuner-text-3:#7a7a7a;--bg:#121212} ${BTN}{border-color:#6a6a6a!important} #tuner-note,#tuner-acc{color:#ededed!important} #tuner-note.tune,#tuner-acc.tune{color:var(--ok)!important}`,
}
for(const [name,css] of Object.entries(V)){
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,colorScheme:'dark',permissions:['microphone']})
  const p=await ctx.newPage(); await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(1600)
  await p.evaluate(()=>window.__gp.closeMic()); await p.waitForTimeout(200)
  await p.addStyleTag({content:'*,*::before,*::after{animation-play-state:paused!important;transition:none!important}'+css})
  // 도♯5 −22 ¢ (틀린 상태: 흰 음이름이 보이게) — D4 판단용. 이명(레♭·D♭)도 뜬다 — D2 판단용
  await p.evaluate(()=>window.__gp.tuner.inject(Array(6).fill({cents:-22,midi:73})))
  await p.waitForTimeout(250)
  await p.screenshot({path:`${OUT}/${name}.png`,fullPage:false})
  await ctx.close(); console.log(name)
}
await browser.close(); try{process.kill(-server.pid)}catch{}
