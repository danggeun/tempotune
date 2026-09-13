// v2.0.3 ①: 메트로놈 클릭이 튜너에 음을 띄우나 — 앱과 같은 클릭·같은 분석기
// 사용: npx tsx scripts/metro-blip.mjs — 「v2.0.3 후보 (조사 완료)」 M1 의 근거
import { createSequencer, CLICK_DUR_S } from '../www/src/core/metro/sequencer.ts'
import { createAnalyzer } from '../www/src/core/pitch/analyzer.ts'
const SR=48000, WIN=4096, HOP=1024, REF=442
const KR=['도','도♯','레','레♯','미','파','파♯','솔','솔♯','라','라♯','시']
const name=m=>m<0?'—':KR[((m%12)+12)%12]+(Math.floor(m/12)-1)
/** 80 BPM 4/4 를 4초 렌더 (앱과 같은 시퀀서) */
function renderMetro(volume=1.0){
  const seq=createSequencer(SR,{bpm:80,timeSig:4,subDiv:1,volume,muted:false})
  seq.start(0)
  const total=Math.ceil(6*SR), buf=new Float32Array(total), out=new Float32Array(128), marks=[]
  for(let s=0;s<total;s+=128){ out.fill(0); for(const ev of seq.render(out,s)) marks.push(ev); buf.set(out.subarray(0,Math.min(128,total-s)),s) }
  return {buf,marks}
}
/** 폰 스피커 → 공기 → 마이크: 감쇠 + 지연 + 약한 잔향 */
function throughRoom(x, atten, delayS, rt=0.12){
  const d=Math.round(delayS*SR), y=new Float32Array(x.length)
  for(let i=0;i<x.length;i++) if(i>=d) y[i]=x[i-d]*atten
  // 아주 거친 잔향 (한 번의 반사 + 지수 꼬리)
  const tail=new Float32Array(y.length)
  for(let i=0;i<y.length;i++){ tail[i]=y[i]; if(i>0) tail[i]+=tail[i-1]*Math.exp(-1/(rt*SR)) }
  return tail
}
const rms=a=>{let e=0;for(const v of a)e+=v*v;return Math.sqrt(e/a.length)}
/** 앱 워커와 같은 규칙으로 프레임을 돌린다. muteOffsetMs = 지연 추정 오차 */
function run(sig, marks, rmsMin, muteOffsetMs, outLatS){
  const an=createAnalyzer({sampleRate:SR,windowSize:WIN}); an.setSettings({rmsMin,smoothing:.12,refHz:REF,tolCents:15})
  const ranges=marks.map(m=>({from:m.sample/SR+outLatS-0.01, until:m.sample/SR+outLatS+CLICK_DUR_S+0.06}))
  const w=new Float32Array(WIN), out=[]
  for(let s=0;s+WIN<=sig.length;s+=HOP){
    const t0=s/SR, t1=(s+WIN)/SR
    const off=muteOffsetMs/1000
    const muted=ranges.some(r=>t0<r.until+off && t1>r.from+off)
    w.set(sig.subarray(s,s+WIN))
    const f=an.process(w,muted)
    out.push({t:t0,midi:f.hz>0?f.midi:-1,muted,playing:f.playing,rms:f.rms})
  }
  return out
}
const {buf,marks}=renderMetro(1.0)
console.log(`클릭 ${marks.length}개 (80 BPM 4/4, 6초) · 클릭 구간 폭 ${((CLICK_DUR_S+0.07)*1000).toFixed(0)} ms`)
console.log('\n## 마이크로 들어온 클릭 세기별 — 음이 뜨나 (지연 추정이 정확할 때)')
console.log('| 스피커→마이크 감쇠 | 신호 RMS | v2.0.1 감도(.014) | v2.0.2 감도(.005) | v2.0.2 높음(.002) |')
console.log('|---|---|---|---|---|')
for(const [lbl,att] of [['가까움 (−12 dB)',.25],['보통 (−20 dB)',.1],['멀리 (−26 dB)',.05]]){
  const sig=throughRoom(buf,att,0.03)
  const cells=[.014,.005,.002].map(r=>{
    const fr=run(sig,marks,r,0,0.03); const shown=fr.filter(f=>f.midi>=0)
    return shown.length? `**${shown.length}프레임** ${[...new Set(shown.map(f=>name(f.midi)))].slice(0,3).join('/')}` : '없음'
  })
  console.log(`| ${lbl} | ${rms(sig).toFixed(4)} | ${cells.join(' | ')} |`)
}
console.log('\n## 지연 추정이 어긋났을 때 (감도 .005, −20 dB 기준)')
console.log('| 어긋난 양 | 음이 뜬 프레임 |')
console.log('|---|---|')
for(const off of [0,20,40,60,80,120,-40]){
  const sig=throughRoom(buf,.1,0.03)
  const fr=run(sig,marks,.005,off,0.03); const shown=fr.filter(f=>f.midi>=0)
  console.log(`| ${off>0?'+':''}${off} ms | ${shown.length?`**${shown.length}** (${[...new Set(shown.map(f=>name(f.midi)))].slice(0,3).join('/')})`:'없음'} |`)
}
console.log('\n## muted 프레임이 라벨을 만들 수 있나 (구조 확인)')
console.log('트래커 confMin=0.5 인데 muted 프레임은 신뢰도 ×0.25 → 통과하려면 원시 conf ≥ 2.0 (불가능)')
const sig=throughRoom(buf,.25,0.03)
const fr=run(sig,marks,.002,0,0.03)
console.log(`→ 실측: muted 로 표시된 프레임 ${fr.filter(f=>f.muted).length}개 중 음이 뜬 것 ${fr.filter(f=>f.muted&&f.midi>=0).length}개`)
console.log(`→ muted 가 아닌 프레임 중 음이 뜬 것 ${fr.filter(f=>!f.muted&&f.midi>=0).length}개`)
console.log(`→ 연주 감지(playing) 가 켜진 프레임 ${fr.filter(f=>f.playing).length} / ${fr.length}`)
