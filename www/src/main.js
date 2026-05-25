import './style.css'
import { yin as _yinPure } from './core/yin.js'
import { bufToWav } from './core/wav.js'
import { fmt, fmtT } from './core/format.js'

const CFG={
  detect:{fftSize:4096,fftSmooth:.88,hzMin:80,hzMax:4800,noiseFloor:-44,peakMargin:8,harmonicDrop:35,harmonicMin:2,holdFrames:45},
  yamnet:{intervalMs:975,threshold:.50,sampleRate:16000,inputLen:15600,stringIdx:new Set([132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147])},
  tuner:{fftSize:4096,yinThreshold:.10,rmsMin:.010,lockFrames:3,smoothing:.22,histLen:360,tolCents:10},
  metro:{bpmMin:20,bpmMax:220,lookaheadS:.4,intervalMs:25,clickDurS:.05,muteTunerMs:70,swipePxPerBpm:2},
  inactiveMs:15*60*1000,refMin:432,refMax:448,refDefault:442,
};

const KR=['도','도♯','레','레♯','미','파','파♯','솔','솔♯','라','라♯','시'];
const ENHARMONIC={'도♯':'레♭','레♯':'미♭','파♯':'솔♭','솔♯':'라♭','라♯':'시♭'};
const KR_MIDI={'도':0,'도♯':1,'레':2,'레♯':3,'미':4,'파':5,'파♯':6,'솔':7,'솔♯':8,'라':9,'라♯':10,'시':11};

const S={micReady:false,running:false,strOK:false,detFreq:0,holdFrames:0,yamnetOK:false,lastYamnetMs:0,smoothFreq:-1,lockedMidi:-1,lockCount:0,lockedRms:0,histData:new Array(CFG.tuner.histLen).fill(null),bpm:80,timeSig:4,subDiv:1,metroPlaying:false,refHz:CFG.refDefault,elapsedSec:0,detectedSec:0,timerRunning:false,lastActivityMs:Date.now()};
const A={micStream:null,micAC:null,analyserFFT:null,analyserTD:null,fftBuf:null,tdBuf:null,binCount:0,sampleRate:44100,scriptProc:null,pcm16k:new Float32Array(31200),pcmPos:0,isClick:false,wakeLock:null,yamnet:null,yamnetReady:false,yamnetRunning:false,metroTimer:null,metroNext:0,metroTick:0,recorder:null,recChunks:[],recording:false,recStartTime:0,recTimerInt:null,refOsc:null,refGain:null,refOctave:4};
const recItems=[];
let _metroCollapsed=false;
let _wakeLockEnabled=true;
let _aiModeEnabled=true;

function _setAiStatus(state){const d=document.getElementById('ai-dot');if(d)d.className=state==='loading'?'loading':'';}
async function loadYamnet(){
  _setAiStatus('loading');
  try{
    let w=0;while(typeof tf==='undefined'&&w<10000){await new Promise(r=>setTimeout(r,200));w+=200;}
    A.yamnet=await tf.loadGraphModel('https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1',{fromTFHub:true});
    A.yamnetReady=true;_setAiStatus('ready');
  }catch(e){A.yamnetReady=true;_setAiStatus('ready');}
}
loadYamnet();
function _showTapHint(){
  const nEl=document.getElementById('tuner-note');
  nEl.textContent='탭하여 시작';nEl.className='empty';nEl.style.fontSize='28px';nEl.style.letterSpacing='.02em';
  const card=document.getElementById('tuner-card');
  const _start=async()=>{const ok=await openMic();if(ok){nEl.style.fontSize='';nEl.style.letterSpacing='';card.removeEventListener('click',_start);}};
  card.addEventListener('click',_start);
}
if(window.Capacitor){
  openMic().then(ok=>{if(!ok){_showTapHint();toast('마이크 권한을 허용해주세요');}});
}else{
  navigator.permissions?.query({name:'microphone'})
    .then(p=>{
      if(p.state==='granted')openMic().then(ok=>{if(!ok)_showTapHint();});
      else showMicPopup();
    })
    .catch(()=>showMicPopup());
}

// ── 설정 스텝 ──
function setCentsStep(v){
  CFG.tuner.tolCents=v;
  document.querySelectorAll('#cents-steps .step-btn').forEach(b=>b.classList.toggle('on',+b.dataset.v===v));
  saveSettings();
}
// [변경] RMS_LEVELS 전체 상향: 낮음.035 / 보통.025 / 높음.015
const RMS_LEVELS=[.022,.012,.006];
function setRmsStep(v){
  CFG.tuner.rmsMin=RMS_LEVELS[v-1];
  document.querySelectorAll('#rms-steps .step-btn').forEach(b=>b.classList.toggle('on',+b.dataset.v===v));
  saveSettings();
}
const SMOOTH_LEVELS=[.05,.10,.15];
function setSmoothStep(v){
  CFG.tuner.smoothing=SMOOTH_LEVELS[v-1];
  document.querySelectorAll('#smooth-steps .step-btn').forEach(b=>b.classList.toggle('on',+b.dataset.v===v));
  saveSettings();
}
function openSettings(){document.getElementById('settings-page').classList.add('open');}
function closeSettings(){document.getElementById('settings-page').classList.remove('open');}

// ── 팝업 ──
function showMicPopup(){document.getElementById('mic-popup-bg').classList.add('show');}
function closeMicPopup(){document.getElementById('mic-popup-bg').classList.remove('show');}
async function allowMic(){document.getElementById('mic-popup-btn').textContent='연결 중...';document.getElementById('mic-popup-btn').disabled=true;const ok=await openMic();if(ok){closeMicPopup();}else{document.getElementById('mic-popup-btn').textContent='다시 시도';document.getElementById('mic-popup-btn').disabled=false;}}

// ── 마이크 ──
let _micOpening=false;
async function openMic(){
  if(_micOpening)return false;_micOpening=true;
  try{
    A.micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1,sampleRate:44100}});
    A.micAC=new(window.AudioContext||window.webkitAudioContext)();A.sampleRate=A.micAC.sampleRate;
    A.analyserFFT=A.micAC.createAnalyser();A.analyserFFT.fftSize=CFG.detect.fftSize;A.analyserFFT.smoothingTimeConstant=CFG.detect.fftSmooth;A.binCount=A.analyserFFT.frequencyBinCount;A.fftBuf=new Float32Array(A.binCount);
    A.analyserTD=A.micAC.createAnalyser();A.analyserTD.fftSize=CFG.tuner.fftSize;A.analyserTD.smoothingTimeConstant=0;A.tdBuf=new Float32Array(CFG.tuner.fftSize);
    A.scriptProc=A.micAC.createScriptProcessor(4096,1,1);
    const ratio=A.sampleRate/16000;
    A.scriptProc.onaudioprocess=e=>{const inp=e.inputBuffer.getChannelData(0);for(let i=0;i<inp.length;i+=ratio){A.pcm16k[A.pcmPos%A.pcm16k.length]=inp[Math.floor(i)];A.pcmPos++;}};
    if(A.micAC.state==='suspended')await A.micAC.resume();
    const src=A.micAC.createMediaStreamSource(A.micStream);src.connect(A.analyserFFT);src.connect(A.analyserTD);src.connect(A.scriptProc);A.scriptProc.connect(A.micAC.destination);
    S.micReady=true;S.running=true;requestWakeLock();startRaf();_micOpening=false;
    const mb=document.getElementById('hdr-mic-btn');if(mb)mb.style.display='none';
    const rhb=document.getElementById('rec-hdr-btn');if(rhb)rhb.style.opacity='1';
    return true;
  }catch(e){toast('마이크 오류: '+e.message);_micOpening=false;return false;}
}
function closeMic(){
  S.running=false;S.micReady=false;S.strOK=false;
  if(S.metroPlaying)stopMetro();stopRefNote();if(A.recording)stopRec();
  A.micStream?.getTracks().forEach(t=>t.stop());A.scriptProc?.disconnect();A.micAC?.close();
  A.micStream=null;A.micAC=null;A.analyserFFT=null;A.analyserTD=null;A.scriptProc=null;A.pcmPos=0;
  A.wakeLock?.release();A.wakeLock=null;
  stopRaf();stopSessionTimer();
  const nEl=document.getElementById('tuner-note');nEl.textContent='--';nEl.className='empty';
  const accEl=document.getElementById('tuner-acc');if(accEl)accEl.textContent='';
  ['tuner-oct','tuner-cents','tuner-enharmonic'].forEach(id=>document.getElementById(id).textContent='');
  document.getElementById('tuner-card').classList.remove('in-tune');drawGauge(null);
  const mb=document.getElementById('hdr-mic-btn');if(mb)mb.style.display='flex';
  const rhb2=document.getElementById('rec-hdr-btn');if(rhb2)rhb2.style.opacity='.35';
}
async function requestWakeLock(){if(!_wakeLockEnabled)return;try{A.wakeLock=await navigator.wakeLock?.request('screen');}catch(e){}}
document.addEventListener('visibilitychange',async()=>{if(S.running&&document.visibilityState==='visible'){A.micAC?.resume();if(_wakeLockEnabled)try{A.wakeLock=await navigator.wakeLock?.request('screen');}catch(e){}}});

// ── 타이머 ──
let _sessInt=null;
function stopSessionTimer(){clearInterval(_sessInt);S.timerRunning=false;const tb=document.getElementById('timer-toggle-btn');if(tb){tb.textContent='시작';tb.classList.remove('active');}}
function toggleTimer(){
  S.timerRunning=!S.timerRunning;const btn=document.getElementById('timer-toggle-btn');
  if(S.timerRunning){
    clearInterval(_sessInt);
    _sessInt=setInterval(()=>{
      if(!S.timerRunning)return;
      S.elapsedSec++;if(S.strOK)S.detectedSec++;
      document.getElementById('timer-elapsed').textContent=fmt(S.elapsedSec);
      document.getElementById('timer-detected').textContent=fmt(S.detectedSec);
      if(Date.now()-S.lastActivityMs>CFG.inactiveMs){toast('비활성으로 마이크 자동 종료');closeMic();}
    },1000);
    btn.textContent='정지';btn.classList.add('active');
  }else{clearInterval(_sessInt);btn.textContent='시작';btn.classList.remove('active');}
}
function resetTimer(){
  clearInterval(_sessInt);
  S.timerRunning=false;S.elapsedSec=0;S.detectedSec=0;
  const tb=document.getElementById('timer-toggle-btn');
  if(tb){tb.textContent='시작';tb.classList.remove('active');}
  document.getElementById('timer-elapsed').textContent='00:00';
  document.getElementById('timer-detected').textContent='00:00';
}
// fmt imported from ./core/format.js

// ── REC 헤더 시간 ──
function startRecTimer(){
  clearInterval(A.recTimerInt);let s=0;
  const el=document.getElementById('hdr-rec-time');
  el.textContent=fmt(0);el.classList.add('show');
  A.recTimerInt=setInterval(()=>{s++;el.textContent=fmt(s);},1000);
}
function stopRecTimer(){clearInterval(A.recTimerInt);const el=document.getElementById('hdr-rec-time');el.classList.remove('show');el.textContent='0:00';}

// ── A= 드럼 피커 ──
const REF_IH=28,REF_MIN=CFG.refMin,REF_MAX=CFG.refMax;
let refDrumY=0,refDrumDrag=false,refSY=0,refSDY=0;
const refOuter=document.getElementById('ref-drum-outer'),refInner=document.getElementById('ref-drum-inner');
(function(){for(let hz=REF_MIN;hz<=REF_MAX;hz++){const el=document.createElement('div');el.className='ref-drum-item';el.textContent=hz+' Hz';refInner.appendChild(el);}})();
function refHzToY(hz){return-(hz-REF_MIN)*REF_IH;}
function refYToHz(y){return Math.round(-y/REF_IH)+REF_MIN;}
function setRefDrumY(y,anim=false){refDrumY=y;refInner.style.transition=anim?'transform .18s cubic-bezier(.25,.46,.45,.94)':'none';refInner.style.transform=`translateY(${y}px)`;const hz=Math.max(REF_MIN,Math.min(REF_MAX,refYToHz(y)));document.querySelectorAll('.ref-drum-item').forEach((el,i)=>el.classList.toggle('active',i+REF_MIN===hz));}
function snapRefDrum(){S.refHz=Math.max(REF_MIN,Math.min(REF_MAX,refYToHz(refDrumY)));setRefDrumY(refHzToY(S.refHz),true);}
refOuter.addEventListener('mousedown',e=>{refDrumDrag=true;refSY=e.clientY;refSDY=refDrumY;refInner.style.transition='none';e.preventDefault();});
window.addEventListener('mousemove',e=>{if(!refDrumDrag)return;setRefDrumY(Math.max(refHzToY(REF_MAX),Math.min(refHzToY(REF_MIN),refSDY+(e.clientY-refSY))));});
window.addEventListener('mouseup',()=>{if(refDrumDrag){refDrumDrag=false;snapRefDrum();}});
refOuter.addEventListener('touchstart',e=>{refDrumDrag=true;refSY=e.touches[0].clientY;refSDY=refDrumY;refInner.style.transition='none';},{passive:true});
window.addEventListener('touchmove',e=>{if(!refDrumDrag)return;setRefDrumY(Math.max(refHzToY(REF_MAX),Math.min(refHzToY(REF_MIN),refSDY+(e.touches[0].clientY-refSY))));},{passive:true});
window.addEventListener('touchend',()=>{if(refDrumDrag){refDrumDrag=false;snapRefDrum();}});
setRefDrumY(refHzToY(S.refHz));setTimeout(()=>setRefDrumY(refHzToY(S.refHz)),30);

// ── FFT / YAMNet / YIN ──
function fftDetect(){
  if(!A.analyserFFT)return false;
  A.analyserFFT.getFloatFrequencyData(A.fftBuf);
  const lo=Math.floor(CFG.detect.hzMin*A.binCount*2/A.sampleRate),hi=Math.min(Math.floor(CFG.detect.hzMax*A.binCount*2/A.sampleRate),A.binCount-1);
  let peak=-Infinity,pkB=0,sum=0,n=0;
  for(let i=lo;i<=hi;i++){if(A.fftBuf[i]>peak){peak=A.fftBuf[i];pkB=i;}if(A.fftBuf[i]>-90){sum+=A.fftBuf[i];n++;}}
  if(n===0)return false;
  // 적응형 플로어: max(설정값, 측정 주변 소음+10dB) — 방 소음 수준에 자동 적응
  const effectiveFloor=Math.max(CFG.detect.noiseFloor,_noiseEst+10);
  if(peak<effectiveFloor||peak-sum/n<CFG.detect.peakMargin){_noiseEst=_noiseEst*.997+peak*.003;return false;}
  let h=0;for(const m of[2,3,4,5]){const b=Math.round(pkB*m);if(b<A.binCount&&A.fftBuf[b]>peak-CFG.detect.harmonicDrop)h++;}
  if(h<CFG.detect.harmonicMin){_noiseEst=_noiseEst*.997+peak*.003;return false;}
  S.detFreq=Math.round(pkB*A.sampleRate/(A.binCount*2));return true;
}
async function runYamnet(){
  const Y=CFG.yamnet;if(!A.yamnet||A.yamnetRunning||A.pcmPos<Y.inputLen)return;A.yamnetRunning=true;let wf=null,res=null;
  try{const s=new Float32Array(Y.inputLen),st=A.pcmPos-Y.inputLen;for(let i=0;i<Y.inputLen;i++)s[i]=A.pcm16k[(st+i)%A.pcm16k.length];wf=tf.tensor1d(s);res=A.yamnet.predict(wf);const sc=Array.isArray(res)?res[0]:res;const arr=await sc.array(),flat=Array.isArray(arr[0])?arr[0]:arr;let mx=0;for(const idx of Y.stringIdx){if(flat[idx]>mx)mx=flat[idx];}S.yamnetOK=mx>=Y.threshold;}
  catch(e){S.yamnetOK=true;}
  finally{if(wf)wf.dispose();if(res){if(Array.isArray(res))res.forEach(t=>t.dispose());else res.dispose();}A.yamnetRunning=false;}
}
let _yf=0,_ly=-1,_lastRms=0,_noiseEst=-65;
function yin(buf,sr){
  if(++_yf%4!==0)return _ly;
  const N=buf.length;let rms=0;for(let i=0;i<N;i++)rms+=buf[i]*buf[i];_lastRms=Math.sqrt(rms/N);
  if(_lastRms<CFG.tuner.rmsMin)return _ly=-1;
  return _ly=_yinPure(buf,sr,CFG.tuner.yinThreshold);
}

// ── 튜너 UI ──
function updateTunerUI(raw){
  const nEl=document.getElementById('tuner-note'),oEl=document.getElementById('tuner-oct'),cEl=document.getElementById('tuner-cents'),eEl=document.getElementById('tuner-enharmonic');
  if(raw===-1){
    S.smoothFreq=-1;S.lockedMidi=-1;S.lockCount=0;S.lockedRms=0;
    nEl.textContent='--';nEl.className='empty';oEl.textContent='';cEl.textContent='';eEl.textContent='';
    // [변경] 빈 화면일 때 acc(샾 표시) 도 초기화
    const accEl2=document.getElementById('tuner-acc');if(accEl2)accEl2.textContent='';
    document.getElementById('tuner-card').classList.remove('in-tune');
    S.histData.push(null);S.histData.shift();drawGauge(null);drawHistory();return;
  }
  S.lastActivityMs=Date.now();
  const corrMidi=Math.round(12*Math.log2(raw/440))+69;
  if(corrMidi===S.lockedMidi){
    S.smoothFreq=S.smoothFreq===-1?raw:S.smoothFreq+(raw-S.smoothFreq)*CFG.tuner.smoothing;
    S.lockedRms=_lastRms;
  }else{
    // 진폭 기반 락: 현재 락된 음보다 훨씬 작은 신호(= 멀리서 나는 소리)는 더 많은 프레임 필요
    const needed=(_lastRms<S.lockedRms*.5&&S.lockedMidi!==-1)?CFG.tuner.lockFrames*2:CFG.tuner.lockFrames;
    S.lockCount++;
    if(S.lockCount>=needed){S.lockedMidi=corrMidi;S.lockCount=0;S.smoothFreq=raw;S.lockedRms=_lastRms;}
    else if(S.smoothFreq===-1)S.smoothFreq=raw;
  }
  const freq=S.smoothFreq,midi=Math.round(12*Math.log2(freq/440))+69;
  const refAdjusted=440*Math.pow(2,(midi-69)/12)*(S.refHz/440);
  const cents=Math.round(1200*Math.log2(freq/refAdjusted));
  const noteIdx=((midi%12)+12)%12,octave=Math.floor(midi/12)-1;
  const inTune=Math.abs(cents)<=CFG.tuner.tolCents;
  const noteName=KR[noteIdx];

  // [변경] 음이름과 샾 분리: 베이스(도/레/미...)는 고정 중앙, ♯은 별도 span
  const noteBase=noteName.replace('♯','');
  const noteAcc=noteName.includes('♯')?'♯':'';
  nEl.textContent=noteBase;
  nEl.className=inTune?'tune':'';
  const accEl=document.getElementById('tuner-acc');
  if(accEl){accEl.textContent=noteAcc;accEl.style.color=inTune?'#22c55e':'#ffffff';}

  oEl.textContent=octave;
  eEl.textContent=ENHARMONIC[noteName]||'';
  document.getElementById('tuner-card').classList.toggle('in-tune',inTune);
  cEl.textContent=(cents>0?'+':'')+cents+' ¢';
  S.histData.push(cents);S.histData.shift();drawGauge(cents);drawHistory();
}

function drawGauge(cents){
  const needle=document.getElementById('gauge-needle'),zone=document.getElementById('gauge-zone'),wrap=document.getElementById('gauge-wrap');
  const W=wrap.offsetWidth||300,ppc=(W/2)/50,tol=CFG.tuner.tolCents;
  zone.style.left=(W/2-tol*ppc)+'px';zone.style.width=(tol*2*ppc)+'px';
  if(cents===null){needle.style.left='50%';needle.className='';return;}
  needle.style.left=(W/2+Math.max(-50,Math.min(50,cents))*ppc)+'px';
  needle.className=Math.abs(cents)<=tol?'tune':cents>0?'sharp':'flat';
}

function drawHistory(){
  const canvas=document.getElementById('tuner-history');if(!canvas||!canvas.offsetWidth)return;
  const W=canvas.offsetWidth,H=Math.max(80,canvas.offsetHeight||100),dpr=devicePixelRatio||1;
  if(canvas.width!==Math.round(W*dpr)||canvas.height!==Math.round(H*dpr)){canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);canvas.style.width=W+'px';canvas.style.height=H+'px';}
  const c=canvas.getContext('2d');c.save();c.scale(dpr,dpr);
  c.fillStyle='#000';c.fillRect(0,0,W,H);
  const inTune=document.getElementById('tuner-card').classList.contains('in-tune');
  if(inTune){c.fillStyle='rgba(34,197,94,.07)';c.fillRect(0,0,W,H);}
  const ppc=(W/2)/50,tol=CFG.tuner.tolCents,N=S.histData.length,rH=H/N;
  c.fillStyle='rgba(34,197,94,.65)';
  c.fillRect(W/2-tol*ppc,0,tol*2*ppc,H);
  c.strokeStyle='rgba(255,255,255,.28)';c.lineWidth=1;
  c.beginPath();c.moveTo(W/2,0);c.lineTo(W/2,H);c.stroke();
  c.lineWidth=2.5;c.lineCap='round';
  for(let i=0;i<N-1;i++){
    const v0=S.histData[i],v1=S.histData[i+1];if(v0===null||v1===null)continue;
    const y0=(i+.5)*rH,y1=(i+1.5)*rH;
    const x0=W/2+Math.max(-50,Math.min(50,v0))*ppc;
    const x1=W/2+Math.max(-50,Math.min(50,v1))*ppc;
    const alpha=.22+(i/(N-1))*.78;
    c.globalAlpha=alpha;
    c.strokeStyle=Math.abs(v0)<=tol?'#4ade80':'#ffffff';
    c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke();
  }
  c.globalAlpha=1;c.restore();
}

// ── 메트로놈 ──
let _metroVol=0.7,_bpmDebounce=null;
(function(){
  function attachDrag(el){
    let sy=0,sb=0,sw=false;
    el.addEventListener('mousedown',e=>{sw=true;sy=e.clientY;sb=S.bpm;e.preventDefault();});
    window.addEventListener('mousemove',e=>{if(!sw)return;setBPM(sb+Math.round((sy-e.clientY)/CFG.metro.swipePxPerBpm));});
    window.addEventListener('mouseup',()=>{sw=false;});
    el.addEventListener('touchstart',e=>{sw=true;sy=e.touches[0].clientY;sb=S.bpm;},{passive:true});
    window.addEventListener('touchmove',e=>{if(!sw)return;setBPM(sb+Math.round((sy-e.touches[0].clientY)/CFG.metro.swipePxPerBpm));},{passive:true});
    window.addEventListener('touchend',()=>{sw=false;});
  }
  attachDrag(document.getElementById('metro-bpm-wrap'));
  attachDrag(document.getElementById('metro-hdr-label'));
})();

function setMetroVol(v){_metroVol=v;}
function getTickInterval(){const b=60/S.bpm;if(S.timeSig===6)return b/2;if(S.subDiv==='d')return A.metroTick%2===0?b*3/4:b*1/4;return b/S.subDiv;}
function getTotalTicks(){return S.subDiv==='d'?S.timeSig*2:S.timeSig*S.subDiv;}
function scheduleClick(time,tick){
  if(!A.micAC)return;
  const dl=Math.max(0,(time-A.micAC.currentTime)*1000);
  setTimeout(()=>{litBeat(tick);flashBeat(tick);},dl);
  if(A.recording){
    setTimeout(()=>{A.isClick=false;},dl+CFG.metro.muteTunerMs);
    return;
  }
  const osc=A.micAC.createOscillator(),gain=A.micAC.createGain();osc.connect(gain);gain.connect(A.micAC.destination);
  let freq,vol;
  if(S.subDiv==='d'){const b1=tick===0,bs=tick%2===0;freq=b1?1800:bs?1100:750;vol=b1?.75:bs?.42:.18;}
  else{const b1=tick===0,ib=tick%S.subDiv===0;freq=b1?1800:ib?1100:750;vol=b1?.75:ib?.42:.18;}
  vol=Math.min(1,vol*(_metroVol/.7));osc.type='triangle';
  gain.gain.setValueAtTime(vol,time);gain.gain.exponentialRampToValueAtTime(.001,time+CFG.metro.clickDurS);
  osc.frequency.value=freq;osc.onended=()=>{osc.disconnect();gain.disconnect();};osc.start(time);osc.stop(time+CFG.metro.clickDurS);
  setTimeout(()=>{A.isClick=true;},dl-5);setTimeout(()=>{A.isClick=false;},dl+CFG.metro.muteTunerMs);
}
function metroSched(){while(A.metroNext<A.micAC.currentTime+CFG.metro.lookaheadS){scheduleClick(A.metroNext,A.metroTick);A.metroNext+=getTickInterval();A.metroTick=(A.metroTick+1)%getTotalTicks();}A.metroTimer=setTimeout(metroSched,CFG.metro.intervalMs);}
function startMetro(){
  if(!A.micAC){toast('마이크를 먼저 켜주세요');return;}
  S.metroPlaying=true;A.metroTick=0;A.metroNext=A.micAC.currentTime+.05;metroSched();
  if(window.innerWidth<700){
    document.getElementById('metro-body').classList.add('collapsed');
    document.getElementById('metro-play-hdr-btn').style.display='flex';
    document.getElementById('metro-collapse-btn').style.display='none';
  }
  document.getElementById('metro-play-btn').textContent='■';
  document.getElementById('metro-play-btn').style.borderColor='var(--red)';
  buildBeatVis();
}
function stopMetro(){
  S.metroPlaying=false;clearTimeout(A.metroTimer);
  if(window.innerWidth<700){
    if(!_metroCollapsed)document.getElementById('metro-body').classList.remove('collapsed');
    document.getElementById('metro-play-hdr-btn').style.display='none';
    document.getElementById('metro-collapse-btn').style.display='flex';
  }
  document.getElementById('metro-play-btn').textContent='▶';
  document.getElementById('metro-play-btn').style.borderColor='var(--border)';
  document.querySelectorAll('.bd').forEach(d=>d.classList.remove('lit-a','lit-b','lit-s'));
}
function toggleMetro(){S.metroPlaying?stopMetro():startMetro();}
function toggleMetroCollapse(){
  _metroCollapsed=!_metroCollapsed;
  const body=document.getElementById('metro-body'),btn=document.getElementById('metro-collapse-btn');
  body.classList.toggle('collapsed',_metroCollapsed);
  btn.textContent=_metroCollapsed?'▲':'▼';
  if(_metroCollapsed){document.querySelectorAll('.bd').forEach(d=>d.classList.remove('lit-a','lit-b','lit-s'));}
}
function setBPM(v){
  S.bpm=Math.max(CFG.metro.bpmMin,Math.min(CFG.metro.bpmMax,v));
  document.getElementById('metro-bpm').textContent=S.bpm;
  document.getElementById('metro-hdr-label').textContent='♩ '+S.bpm;
  clearTimeout(_bpmDebounce);
  if(S.metroPlaying){_bpmDebounce=setTimeout(()=>{stopMetro();startMetro();saveSettings();},300);}
  else{_bpmDebounce=setTimeout(saveSettings,400);}
}
function adjBPM(d){setBPM(S.bpm+d);}
function setTS(v){S.timeSig=v;document.querySelectorAll('[data-ts]').forEach(b=>b.classList.toggle('on',+b.dataset.ts===v));const is68=v===6;document.getElementById('sd-grid').style.opacity=is68?'.3':'1';document.getElementById('sd-grid').style.pointerEvents=is68?'none':'auto';document.querySelectorAll('[data-sd="1"]').forEach(b=>b.textContent=is68?'♪':'♩');if(is68){S.subDiv=1;document.querySelectorAll('[data-sd]').forEach(b=>b.classList.toggle('on',b.dataset.sd==='1'));}buildBeatVis();if(S.metroPlaying){stopMetro();startMetro();}saveSettings();}
function setSD(v){S.subDiv=v;document.querySelectorAll('[data-sd]').forEach(b=>b.classList.toggle('on',b.dataset.sd===String(v)));buildBeatVis();if(S.metroPlaying){stopMetro();startMetro();}saveSettings();}
function buildBeatVis(){const wrap=document.getElementById('beat-vis');wrap.innerHTML='';const total=getTotalTicks();for(let i=0;i<total;i++){const dot=document.createElement('div');dot.className='bd '+(S.subDiv==='d'?(i%2===0?'beat':'subdiv'):(i%S.subDiv===0?'beat':'subdiv'));dot.dataset.tick=i;wrap.appendChild(dot);}}
buildBeatVis();
function litBeat(tick){
  if(!S.metroPlaying)return;
  document.querySelectorAll('.bd').forEach(d=>{d.classList.remove('lit-a','lit-b','lit-s');if(+d.dataset.tick!==tick)return;if(tick===0)d.classList.add('lit-a');else d.classList.add((S.subDiv==='d'?tick%2===0:tick%S.subDiv===0)?'lit-b':'lit-s');});
}
function flashBeat(tick){
  if(!S.metroPlaying)return;
  const card=document.getElementById('metro-card');
  card.classList.remove('flash-strong','lit-weak');
  if(window.innerWidth<700){
    const th=document.getElementById('tuner-hdr');
    th.classList.remove('beat-flash','beat-flash-weak');void th.offsetWidth;
    if(tick===0){th.classList.add('beat-flash');}
    else{th.classList.add('beat-flash-weak');}
  }
  if(tick===0){void card.offsetWidth;card.classList.add('flash-strong');}
  else{card.classList.add('lit-weak');clearTimeout(card._ft);card._ft=setTimeout(()=>card.classList.remove('lit-weak'),100);}
}

// ── 기준음 ──
function closeRefAll(){document.getElementById('ref-panel').classList.remove('open');stopRefNote();}
function adjRefOct(d){
  A.refOctave=Math.max(2,Math.min(6,A.refOctave+d));
  document.querySelectorAll('#ref-oct-num-ext,#ref-oct-num-menu').forEach(el=>{if(el)el.textContent=A.refOctave;});
  const on=document.querySelector('.ref-note-btn.on');
  if(on){const note=on.dataset.note;if(note==='도2')playRefHigh();else if(note)playRef(note);}
}
function playRefHigh(){
  const alreadyOn=document.querySelector('.ref-note-btn[data-note="도2"].on');
  if(alreadyOn){stopRefNote();return;}
  stopRefNote();if(!A.micAC)return;const midi=0+(A.refOctave+2)*12,freq=S.refHz*Math.pow(2,(midi-69)/12);A.refOsc=A.micAC.createOscillator();A.refGain=A.micAC.createGain();A.refOsc.type='triangle';A.refOsc.frequency.value=freq;A.refOsc.connect(A.refGain);A.refGain.connect(A.micAC.destination);A.refGain.gain.setValueAtTime(.22,A.micAC.currentTime);A.refOsc.start();document.querySelectorAll('.ref-note-btn').forEach(b=>b.classList.remove('on'));document.querySelectorAll('.ref-note-btn[data-note="도2"]').forEach(b=>b.classList.add('on'));
}
function playRef(name){
  const alreadyOn=document.querySelector('.ref-note-btn[data-note="'+name+'"].on');
  if(alreadyOn){stopRefNote();return;}
  stopRefNote();if(!A.micAC)return;const semi=KR_MIDI[name];if(semi===undefined)return;document.querySelectorAll('.ref-note-btn').forEach(b=>b.classList.remove('on'));document.querySelectorAll('.ref-note-btn[data-note="'+name+'"]').forEach(b=>b.classList.add('on'));const midi=semi+(A.refOctave+1)*12,freq=S.refHz*Math.pow(2,(midi-69)/12);A.refOsc=A.micAC.createOscillator();A.refGain=A.micAC.createGain();A.refOsc.type='triangle';A.refOsc.frequency.value=freq;A.refOsc.connect(A.refGain);A.refGain.connect(A.micAC.destination);A.refGain.gain.setValueAtTime(.22,A.micAC.currentTime);A.refOsc.start();
}

function stopRefNote(){document.querySelectorAll('.ref-note-btn').forEach(b=>b.classList.remove('on'));if(A.refOsc&&A.refGain&&A.micAC){try{A.refGain.gain.cancelScheduledValues(A.micAC.currentTime);A.refGain.gain.setValueAtTime(A.refGain.gain.value,A.micAC.currentTime);A.refGain.gain.exponentialRampToValueAtTime(.001,A.micAC.currentTime+.05);A.refOsc.stop(A.micAC.currentTime+.05);}catch(e){}A.refOsc=null;A.refGain=null;}}

// ── 녹음 ──
function tbRec(){if(!S.micReady){toast('마이크를 먼저 켜주세요');return;}if(A.recording)stopRec();else startRec();}
function startRec(){
  if(!A.micStream)return;A.recChunks=[];A.recStartTime=Date.now();
  const _mimes=['audio/webm;codecs=opus','audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/webm',''];
  const _mime=_mimes.find(m=>!m||MediaRecorder.isTypeSupported(m))||'';
  const _recOpts={audioBitsPerSecond:256000};if(_mime)_recOpts.mimeType=_mime;
  A.recorder=new MediaRecorder(A.micStream,_recOpts);
  A.recorder.ondataavailable=e=>{if(e.data.size>0)A.recChunks.push(e.data);};
  A.recorder.onstop=()=>{
    const blob=new Blob(A.recChunks,{type:A.recorder.mimeType||'audio/webm'});
    const url=URL.createObjectURL(blob);
    const dur=Math.round((Date.now()-A.recStartTime)/1000);
    const n=new Date(A.recStartTime);
    const name=`${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}_${String(n.getHours()).padStart(2,'0')}${String(n.getMinutes()).padStart(2,'0')}`;
    recItems.unshift({url,name,dur,blob,mime:A.recorder.mimeType});renderRecList();
  };
  A.recorder.start();A.recording=true;
  const rb=document.getElementById('rec-hdr-btn');if(rb)rb.classList.add('rec-on');
  const rh=document.getElementById('rec-hdr-dot');if(rh){rh.style.background='var(--red)';rh.style.animation='pulse 1s infinite';}
  const tb=document.getElementById('rec-toggle-btn');
  tb.innerHTML='<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red);margin-right:7px;vertical-align:middle;animation:pulse 1s infinite;flex-shrink:0;"></span>REC 중지';
  tb.classList.add('rec-active');
  startRecTimer();toast('녹음 시작');
}
function stopRec(){
  A.recorder?.stop();A.recording=false;
  const rb=document.getElementById('rec-hdr-btn');if(rb)rb.classList.remove('rec-on');
  const rh=document.getElementById('rec-hdr-dot');if(rh){rh.style.background='var(--muted)';rh.style.animation='none';}
  const tb=document.getElementById('rec-toggle-btn');tb.innerHTML='녹음 시작';tb.classList.remove('rec-active');
  stopRecTimer();toast('녹음 완료');
}
// fmtT imported from ./core/format.js
const _recPlayers={};
function getRecPlayer(idx){if(!_recPlayers[idx]){const a=new Audio(recItems[idx].url);a.ontimeupdate=()=>{const sk=document.getElementById('rec-seek-'+idx),tm=document.getElementById('rec-time-'+idx);if(sk&&a.duration){sk.max=a.duration;sk.value=a.currentTime;}if(tm)tm.textContent=fmtT(a.currentTime);};a.onended=()=>{const btn=document.getElementById('rec-pb-'+idx);if(btn)btn.textContent='▶';const sk=document.getElementById('rec-seek-'+idx);if(sk)sk.value=0;const tm=document.getElementById('rec-time-'+idx);if(tm)tm.textContent='0:00';a.currentTime=0;};_recPlayers[idx]=a;}return _recPlayers[idx];}
function recPlayPause(idx){const a=getRecPlayer(idx),btn=document.getElementById('rec-pb-'+idx);Object.keys(_recPlayers).forEach(i=>{if(+i!==idx&&!_recPlayers[i].paused){_recPlayers[i].pause();const b=document.getElementById('rec-pb-'+i);if(b)b.textContent='▶';}});if(a.paused){a.play();if(btn)btn.textContent='■';}else{a.pause();if(btn)btn.textContent='▶';}}
function recSeek(idx){const sk=document.getElementById('rec-seek-'+idx),a=getRecPlayer(idx);if(sk&&a.duration)a.currentTime=+sk.value;}
function renderRecList(){
  Object.keys(_recPlayers).forEach(i=>{_recPlayers[i].pause();delete _recPlayers[i];});
  const list=document.getElementById('rec-list');list.innerHTML='';
  if(recItems.length===0)return;
  const renderItem=(item,idx,defaultOpen)=>{
    const div=document.createElement('div');div.className='rec-item';
    const m=Math.floor(item.dur/60),s=String(item.dur%60).padStart(2,'0');
    const _ext=item.mime&&item.mime.includes('mp4')?'m4a':'webm';
    div.innerHTML=`
      <div data-action="toggle" data-idx="${idx}" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
        <span class="rec-item-name" style="font-family:'DM Mono',monospace;font-size:13px;color:var(--text);font-weight:500;"></span>
        <span style="font-size:13px;color:var(--muted);">${m}:${s}</span>
      </div>
      <div class="rec-item-detail${defaultOpen?' open':''}" id="rec-detail-${idx}">
        <div class="rec-player">
          <div class="rec-player-top">
            <button class="rec-play-btn" id="rec-pb-${idx}" data-action="play" data-idx="${idx}">▶</button>
            <input type="range" class="rec-seek" id="rec-seek-${idx}" value="0" min="0" step="0.01" data-action="seek" data-idx="${idx}">
            <span class="rec-time" id="rec-time-${idx}">00:00</span>
          </div>
          <div class="rec-item-btns">
            <button class="rec-item-btn" data-action="edit" data-idx="${idx}" style="font-size:12px;font-weight:700;letter-spacing:.04em;">편집</button>
            <a class="rec-item-btn rec-dl-link" href="${item.url}" style="font-size:12px;font-weight:700;letter-spacing:.04em;">다운로드</a>
            <button class="rec-item-btn del" data-action="delete" data-idx="${idx}">🗑</button>
          </div>
        </div>
      </div>`;
    div.querySelector('.rec-item-name').textContent=item.name;
    const dlLink=div.querySelector('.rec-dl-link');
    dlLink.download='gopractice_'+item.name+'.'+_ext;
    return div;
  };
  list.appendChild(renderItem(recItems[0],0,true));
  if(recItems.length>1){
    const oldWrap=document.createElement('div');
    const toggleBtn=document.createElement('button');
    toggleBtn.style.cssText='width:100%;padding:10px;background:transparent;border:1.5px solid var(--border);border-radius:9px;color:var(--muted);font-size:13px;font-weight:700;cursor:pointer;text-align:center;margin-top:4px;';
    toggleBtn.textContent=`이전 녹음 ${recItems.length-1}개 보기`;
    let oldOpen=false;
    const oldList=document.createElement('div');oldList.style.display='none';
    recItems.slice(1).forEach((_,i)=>oldList.appendChild(renderItem(recItems[i+1],i+1,false)));
    toggleBtn.onclick=()=>{
      oldOpen=!oldOpen;
      oldList.style.display=oldOpen?'flex':'none';
      oldList.style.flexDirection='column';oldList.style.gap='6px';
      toggleBtn.textContent=oldOpen?`이전 녹음 접기`:`이전 녹음 ${recItems.length-1}개 보기`;
    };
    oldWrap.appendChild(toggleBtn);oldWrap.appendChild(oldList);
    list.appendChild(oldWrap);
  }
}
function toggleRecItem(idx){document.getElementById('rec-detail-'+idx)?.classList.toggle('open');}
function deleteRec(idx){if(_ed.idx===idx)closeEditor();if(_recPlayers[idx]){try{_recPlayers[idx].pause();}catch(e){}delete _recPlayers[idx];}URL.revokeObjectURL(recItems[idx].url);recItems.splice(idx,1);renderRecList();}

// ══════════════════════════════════
// 편집 페이지
// ══════════════════════════════════
const _ed={idx:-1,item:null,audio:null,ptA:null,ptB:null,looping:false,bookmarks:[],dragging:null};

function openEditor(idx){
  const item=recItems[idx];if(!item)return;
  if(_ed.audio){_ed.audio.pause();_ed.audio=null;}
  _ed.idx=idx;_ed.item=item;
  _ed.ptA=null;_ed.ptB=null;_ed.looping=false;_ed.bookmarks=[];_ed.dragging=null;
  const audio=new Audio(item.url);
  audio.preservesPitch=true;audio.playbackRate=1.0;audio.preload='auto';
  _ed.audio=audio;
  const updateDur=()=>{
    const d=isFinite(audio.duration)&&audio.duration>0
      ? Math.max(item.dur||0, Math.round(audio.duration))
      : (item.dur||0);
    document.getElementById('ed-dur').textContent=fmtT(d);
  };
  audio.addEventListener('loadedmetadata',updateDur);
  audio.addEventListener('durationchange',updateDur);
  if(audio.readyState>=1&&isFinite(audio.duration)&&audio.duration>0){updateDur();}
  const edReadyHandler=()=>{
    const btn=document.getElementById('ed-play-btn');
    if(btn){btn.textContent='▶';btn.style.opacity='1';btn.disabled=false;}
    clearTimeout(_ed._readyTimeout);
  };
  _ed._readyTimeout=setTimeout(edReadyHandler,3000);
  audio.addEventListener('canplaythrough',edReadyHandler,{once:true});
  const _ext=item.mime&&item.mime.includes('mp4')?'m4a':'webm';
  const _dlA=document.getElementById('ed-dl-btn');
  if(_dlA){_dlA.href=item.url;_dlA.download='gopractice_'+item.name+'.'+_ext;}
  audio.addEventListener('timeupdate',edOnTimeUpdate);
  audio.addEventListener('ended',()=>{
    document.getElementById('ed-play-btn').textContent='▶';
    if(_ed.looping&&_ed.ptA!==null&&_ed.ptB!==null){audio.currentTime=_ed.ptA;audio.play();document.getElementById('ed-play-btn').textContent='■';}
  });
  audio.load();
  document.getElementById('editor-title-display').textContent=item.name;
  document.getElementById('ed-cur').textContent='00:00';
  document.getElementById('ed-dur').textContent=item.dur?fmtT(item.dur):'--:--';
  const _pb=document.getElementById('ed-play-btn');
  _pb.textContent='▶';_pb.style.opacity='.4';_pb.disabled=true;
  if(audio.readyState>=3){_pb.style.opacity='1';_pb.disabled=false;}
  document.getElementById('ed-speed').value=1.0;
  document.getElementById('ed-speed-val').textContent='1.0×';
  document.getElementById('ed-progress').style.width='0%';
  document.getElementById('ed-pos-handle').style.left='0%';
  document.getElementById('ed-ab-range').style.display='none';
  document.getElementById('ed-a-handle').style.display='none';
  document.getElementById('ed-b-handle').style.display='none';
  document.getElementById('ed-ab-times').style.display='none';
  document.getElementById('ed-bm-ticks').innerHTML='';
  document.getElementById('ed-bookmarks').innerHTML='<span id="ed-bm-empty" style="font-size:12px;color:var(--dim);">재생 중 추가 버튼을 누르면 현재 위치가 저장돼요</span>';
  edResetABtn();edResetBBtn();edResetLoopBtn();
  document.getElementById('ed-export-btn').style.color='var(--dim)';
  document.getElementById('ed-export-btn').style.borderColor='var(--border)';
  document.getElementById('editor-page').style.display='flex';
  edInitDrag();
}

function closeEditor(){
  if(_ed.audio){_ed.audio.pause();_ed.audio=null;}
  clearTimeout(_ed._readyTimeout);
  if(_ed._mmHandler)window.removeEventListener('mousemove',_ed._mmHandler);
  if(_ed._muHandler)window.removeEventListener('mouseup',_ed._muHandler);
  if(_ed._tmHandler)window.removeEventListener('touchmove',_ed._tmHandler);
  if(_ed._teHandler)window.removeEventListener('touchend',_ed._teHandler);
  _ed._mmHandler=_ed._muHandler=_ed._tmHandler=_ed._teHandler=null;
  document.getElementById('editor-page').style.display='none';
}

function edEditTitle(){
  const display=document.getElementById('editor-title-display');
  const current=_ed.item?_ed.item.name:'';
  const newName=prompt('파일 이름 수정', current);
  if(newName&&newName.trim()&&_ed.idx>=0&&recItems[_ed.idx]){
    recItems[_ed.idx].name=newName.trim();
    display.textContent=newName.trim();
    renderRecList();
  }
}

function edOnTimeUpdate(){
  if(_ed.dragging)return;
  const a=_ed.audio;if(!a||!isFinite(a.duration)||a.duration===0)return;
  const t=a.currentTime,d=a.duration,pct=(t/d*100).toFixed(3)+'%';
  document.getElementById('ed-cur').textContent=fmtT(t);
  document.getElementById('ed-pos-handle').style.left=pct;
  document.getElementById('ed-progress').style.width=pct;
  if(_ed.looping&&_ed.ptA!==null&&_ed.ptB!==null&&t>=_ed.ptB){a.currentTime=_ed.ptA;}
}

function edPctFromClient(clientX){
  const track=document.getElementById('ed-track');
  const rect=track.getBoundingClientRect();
  return Math.max(0,Math.min(1,(clientX-rect.left)/rect.width));
}

function edInitDrag(){
  if(_ed._mmHandler)window.removeEventListener('mousemove',_ed._mmHandler);
  if(_ed._muHandler)window.removeEventListener('mouseup',_ed._muHandler);
  if(_ed._tmHandler)window.removeEventListener('touchmove',_ed._tmHandler);
  if(_ed._teHandler)window.removeEventListener('touchend',_ed._teHandler);
  const posH=document.getElementById('ed-pos-handle');
  const aH=document.getElementById('ed-a-handle');
  const bH=document.getElementById('ed-b-handle');
  const track=document.getElementById('ed-track');
  track.addEventListener('click',e=>{
    if(_ed.dragging)return;
    if(e.target.closest('#ed-pos-handle,#ed-a-handle,#ed-b-handle'))return;
    if(_ed.audio&&isFinite(_ed.audio.duration)){
      const t=edPctFromClient(e.clientX)*_ed.audio.duration;
      _ed.audio.currentTime=t;
      const pct=(t/_ed.audio.duration*100).toFixed(3)+'%';
      document.getElementById('ed-pos-handle').style.left=pct;
      document.getElementById('ed-progress').style.width=pct;
      document.getElementById('ed-cur').textContent=fmtT(t);
    }
  });
  const startDrag=(which)=>{_ed.dragging=which;};
  const edUpdatePosUI=(t)=>{
    if(!_ed.audio||!isFinite(_ed.audio.duration))return;
    const pct=(t/_ed.audio.duration*100).toFixed(3)+'%';
    document.getElementById('ed-pos-handle').style.left=pct;
    document.getElementById('ed-progress').style.width=pct;
    document.getElementById('ed-cur').textContent=fmtT(t);
  };
  const moveDrag=(clientX)=>{
    if(!_ed.dragging||!_ed.audio||!isFinite(_ed.audio.duration))return;
    const t=edPctFromClient(clientX)*_ed.audio.duration;
    if(_ed.dragging==='pos'){const clamped=Math.max(0,Math.min(_ed.audio.duration,t));_ed.audio.currentTime=clamped;edUpdatePosUI(clamped);}
    else if(_ed.dragging==='a'){_ed.ptA=Math.max(0,Math.min(_ed.ptB!==null?_ed.ptB-0.1:_ed.audio.duration,t));edUpdateHandles();edUpdateABtn();edCheckExportBtn();}
    else if(_ed.dragging==='b'){_ed.ptB=Math.max(_ed.ptA!==null?_ed.ptA+0.1:0,Math.min(_ed.audio.duration,t));edUpdateHandles();edUpdateBBtn();edCheckExportBtn();}
  };
  const endDrag=()=>{_ed.dragging=null;if(_ed.audio&&isFinite(_ed.audio.duration))edUpdatePosUI(_ed.audio.currentTime);};
  posH.addEventListener('mousedown',e=>{e.stopPropagation();startDrag('pos');});
  aH.addEventListener('mousedown',e=>{e.stopPropagation();startDrag('a');});
  bH.addEventListener('mousedown',e=>{e.stopPropagation();startDrag('b');});
  posH.addEventListener('touchstart',e=>{e.stopPropagation();startDrag('pos');},{passive:true});
  aH.addEventListener('touchstart',e=>{e.stopPropagation();startDrag('a');},{passive:true});
  bH.addEventListener('touchstart',e=>{e.stopPropagation();startDrag('b');},{passive:true});
  _ed._mmHandler=e=>moveDrag(e.clientX);
  _ed._muHandler=endDrag;
  _ed._tmHandler=e=>{if(_ed.dragging)moveDrag(e.touches[0].clientX);};
  _ed._teHandler=endDrag;
  window.addEventListener('mousemove',_ed._mmHandler);
  window.addEventListener('mouseup',_ed._muHandler);
  window.addEventListener('touchmove',_ed._tmHandler,{passive:true});
  window.addEventListener('touchend',_ed._teHandler);
}

function edUpdateHandles(){
  if(!_ed.audio||!isFinite(_ed.audio.duration))return;
  const d=_ed.audio.duration;
  if(_ed.ptA!==null){
    const pA=(_ed.ptA/d*100).toFixed(3)+'%';
    const aH=document.getElementById('ed-a-handle');
    aH.style.display='block';aH.style.left=pA;
    const abTimes=document.getElementById('ed-ab-times');
    abTimes.style.display='flex';
    document.getElementById('ed-a-time').textContent='A '+fmtT(_ed.ptA);
  }
  if(_ed.ptB!==null){
    const pB=(_ed.ptB/d*100).toFixed(3)+'%';
    const bH=document.getElementById('ed-b-handle');
    bH.style.display='block';bH.style.left=pB;
    document.getElementById('ed-b-time').textContent='B '+fmtT(_ed.ptB);
  }
  if(_ed.ptA!==null&&_ed.ptB!==null){
    const r=document.getElementById('ed-ab-range');
    r.style.display='block';
    r.style.left=(_ed.ptA/d*100).toFixed(3)+'%';
    r.style.width=((_ed.ptB-_ed.ptA)/d*100).toFixed(3)+'%';
  }
}

function edTogglePlay(){
  if(!_ed.audio)return;
  const btn=document.getElementById('ed-play-btn');
  if(_ed.audio.paused){
    if(_ed.ptA!==null&&_ed.audio.currentTime<_ed.ptA){_ed.audio.currentTime=_ed.ptA;}
    btn.textContent='■';
    const tryPlay=()=>{
      const p=_ed.audio&&_ed.audio.play();
      if(p&&p.catch)p.catch(()=>{setTimeout(()=>{if(_ed.audio&&_ed.audio.paused){const p2=_ed.audio.play();if(p2&&p2.catch)p2.catch(()=>{btn.textContent='▶';});}},50);});
    };
    if(_ed.audio.readyState<2){_ed.audio.addEventListener('canplay',tryPlay,{once:true});}
    else{tryPlay();}
  }else{_ed.audio.pause();btn.textContent='▶';}
}

function edSetSpeed(v){
  const disp=Number.isInteger(v*10)?v.toFixed(1):v.toFixed(2);
  document.getElementById('ed-speed-val').textContent=disp+'×';
  if(_ed.audio){_ed.audio.playbackRate=v;_ed.audio.preservesPitch=true;}
}

function edToggleA(){
  if(_ed.ptA!==null){
    _ed.ptA=null;_ed.ptB=null;_ed.looping=false;
    document.getElementById('ed-a-handle').style.display='none';
    document.getElementById('ed-b-handle').style.display='none';
    document.getElementById('ed-ab-range').style.display='none';
    document.getElementById('ed-ab-times').style.display='none';
    edResetABtn();edResetBBtn();edResetLoopBtn();edCheckExportBtn();
  }else{
    if(!_ed.audio||!isFinite(_ed.audio.duration))return;
    _ed.ptA=_ed.audio.currentTime;
    edUpdateHandles();edUpdateABtn();
    document.getElementById('ed-b-btn').style.opacity='1';
    edCheckExportBtn();
  }
}

function edToggleB(){
  if(_ed.ptA===null){toast('먼저 A 지점을 설정해주세요');return;}
  if(_ed.ptB!==null){
    _ed.ptB=null;_ed.looping=false;
    document.getElementById('ed-b-handle').style.display='none';
    document.getElementById('ed-ab-range').style.display='none';
    document.getElementById('ed-b-time').textContent='B —';
    edResetBBtn();edResetLoopBtn();edCheckExportBtn();
  }else{
    if(!_ed.audio||!isFinite(_ed.audio.duration))return;
    const t=_ed.audio.currentTime;
    if(t<=_ed.ptA){toast('B는 A보다 뒤여야 해요');return;}
    _ed.ptB=t;
    edUpdateHandles();edUpdateBBtn();
    document.getElementById('ed-loop-btn').style.opacity='1';
    edCheckExportBtn();
  }
}

function edToggleLoop(){
  if(_ed.ptA===null||_ed.ptB===null){toast('A, B 지점을 먼저 설정해주세요');return;}
  _ed.looping=!_ed.looping;
  const btn=document.getElementById('ed-loop-btn');
  if(_ed.looping){
    btn.style.borderColor='var(--red)';btn.style.color='var(--red)';
    btn.querySelector('span').textContent='켜짐';
    _ed.audio.currentTime=_ed.ptA;
    if(_ed.audio.paused){_ed.audio.play();document.getElementById('ed-play-btn').textContent='■';}
  }else{
    btn.style.borderColor='var(--border)';btn.style.color='var(--muted)';
    btn.querySelector('span').textContent='꺼짐';
  }
}

function edUpdateABtn(){const btn=document.getElementById('ed-a-btn');btn.style.borderColor='var(--red)';btn.style.color='var(--red)';btn.querySelector('span').textContent=fmtT(_ed.ptA);}
function edUpdateBBtn(){const btn=document.getElementById('ed-b-btn');btn.style.borderColor='var(--red)';btn.style.color='var(--red)';btn.querySelector('span').textContent=fmtT(_ed.ptB);}
function edResetABtn(){const btn=document.getElementById('ed-a-btn');btn.style.borderColor='';btn.style.color='var(--muted)';btn.querySelector('span').textContent='설정';}
function edResetBBtn(){const btn=document.getElementById('ed-b-btn');btn.style.borderColor='';btn.style.color='var(--muted)';btn.style.opacity='0.4';btn.querySelector('span').textContent='설정';}
function edResetLoopBtn(){const btn=document.getElementById('ed-loop-btn');btn.style.borderColor='';btn.style.color='var(--muted)';btn.style.opacity='0.4';btn.querySelector('span').textContent='꺼짐';}
function edCheckExportBtn(){const btn=document.getElementById('ed-export-btn');const active=_ed.ptA!==null&&_ed.ptB!==null;btn.style.color=active?'var(--text)':'var(--dim)';}

function edAddBookmark(){
  if(!_ed.audio||!isFinite(_ed.audio.duration))return;
  const t=_ed.audio.currentTime;
  if(_ed.bookmarks.some(b=>Math.abs(b-t)<0.3)){toast('이미 근처에 북마크가 있어요');return;}
  _ed.bookmarks.push(t);_ed.bookmarks.sort((a,b)=>a-b);
  edRenderBmTicks();edRenderBmList();
}
function edRenderBmTicks(){
  const wrap=document.getElementById('ed-bm-ticks');wrap.innerHTML='';
  if(!_ed.audio||!isFinite(_ed.audio.duration))return;
  _ed.bookmarks.forEach((t)=>{
    const tick=document.createElement('div');
    tick.style.cssText=`position:absolute;top:50%;left:${(t/_ed.audio.duration*100).toFixed(3)}%;width:2px;height:22px;background:#f59e0b;border-radius:1px;transform:translate(-50%,-50%);z-index:2;pointer-events:none;`;
    wrap.appendChild(tick);
  });
}
function edRenderBmList(){
  const wrap=document.getElementById('ed-bookmarks');wrap.innerHTML='';
  if(_ed.bookmarks.length===0){
    wrap.innerHTML='<span id="ed-bm-empty" style="font-size:12px;color:var(--dim);">재생 중 추가 버튼을 누르면 현재 위치가 저장돼요</span>';
    return;
  }
  _ed.bookmarks.forEach((t,i)=>{
    const pill=document.createElement('div');
    pill.style.cssText='display:flex;align-items:center;gap:0;background:var(--surface);border:1.5px solid #f59e0b66;border-radius:8px;overflow:hidden;cursor:pointer;';
    const lbl=document.createElement('button');
    lbl.textContent=fmtT(t);
    lbl.style.cssText='background:none;border:none;padding:6px 10px;font-family:\'DM Mono\',monospace;font-size:12px;color:#f59e0b;font-weight:700;cursor:pointer;';
    lbl.onclick=()=>{if(_ed.audio)_ed.audio.currentTime=t;};
    const del=document.createElement('button');
    del.textContent='✕';
    del.style.cssText='background:none;border:none;border-left:1px solid #f59e0b33;color:#888;font-size:11px;cursor:pointer;padding:6px 8px;line-height:1;';
    del.onclick=(e)=>{e.stopPropagation();_ed.bookmarks.splice(i,1);edRenderBmTicks();edRenderBmList();};
    pill.appendChild(lbl);pill.appendChild(del);
    wrap.appendChild(pill);
  });
}

async function edExportAB(){
  if(_ed.ptA===null||_ed.ptB===null){toast('A, B 지점을 먼저 설정해주세요');return;}
  try{
    const resp=await fetch(_ed.item.url);
    const arrayBuf=await resp.arrayBuffer();
    const tmpAC=new AudioContext();
    const decoded=await tmpAC.decodeAudioData(arrayBuf);
    await tmpAC.close();
    const sr=decoded.sampleRate,ch=decoded.numberOfChannels;
    const s0=Math.floor(_ed.ptA*sr),s1=Math.floor(_ed.ptB*sr),len=s1-s0;
    if(len<=0){toast('구간이 너무 짧아요');return;}
    const offAC=new OfflineAudioContext(ch,len,sr);
    const buf=offAC.createBuffer(ch,len,sr);
    for(let c=0;c<ch;c++)buf.copyToChannel(decoded.getChannelData(c).slice(s0,s1),c);
    const src=offAC.createBufferSource();src.buffer=buf;src.connect(offAC.destination);src.start();
    const rendered=await offAC.startRendering();
    const wav=bufToWav(rendered);
    const blob=new Blob([wav],{type:'audio/wav'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download='gopractice_'+_ed.item.name+'_cut.wav';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  }catch(e){toast('저장 실패: '+e.message);}
}
// _bufToWav → bufToWav imported from ./core/wav.js

// ── 메뉴 ──
function toggleMenu(){
  const overlay=document.getElementById('menu-overlay');
  const isOpen=overlay.classList.toggle('open');
  if(isOpen){document.getElementById('ref-panel').classList.remove('open');}
}

// ── rAF ──
let _rafId=null;
function startRaf(){if(!_rafId){_rafId=requestAnimationFrame(frame);}}
function stopRaf(){if(_rafId){cancelAnimationFrame(_rafId);_rafId=null;}}
function frame(){
  if(S.running&&A.analyserFFT){
    const fftPass=fftDetect();
    if(fftPass&&_aiModeEnabled&&Date.now()-S.lastYamnetMs>CFG.yamnet.intervalMs&&A.yamnet){S.lastYamnetMs=Date.now();runYamnet();}
    if(!fftPass)S.yamnetOK=false;
    const detected=fftPass&&(S.yamnetOK||!A.yamnet);
    S.holdFrames=detected?CFG.detect.holdFrames:Math.max(0,S.holdFrames-1);S.strOK=S.holdFrames>0;
  }
  if(S.running&&A.analyserTD&&!A.isClick){A.analyserTD.getFloatTimeDomainData(A.tdBuf);updateTunerUI(yin(A.tdBuf,A.sampleRate));}
  if(S.running)_rafId=requestAnimationFrame(frame);else _rafId=null;
}

function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2500);}

function toggleFullscreen(){
  if(window.Capacitor)return;
  if(!document.fullscreenElement&&!document.webkitFullscreenElement){
    const el=document.documentElement;
    if(el.requestFullscreen)el.requestFullscreen();
    else if(el.webkitRequestFullscreen)el.webkitRequestFullscreen();
    else toast('이 기기에서는 홈 화면에 추가하면 전체화면으로 사용할 수 있어요');
  }else{
    if(document.exitFullscreen)document.exitFullscreen();
    else if(document.webkitExitFullscreen)document.webkitExitFullscreen();
  }
}

function setWakeLock(v){
  _wakeLockEnabled=v===1;
  document.querySelectorAll('#wakelock-steps .step-btn').forEach(b=>b.classList.toggle('on',+b.dataset.v===v));
  if(_wakeLockEnabled){if(S.running)requestWakeLock();}
  else{A.wakeLock?.release();A.wakeLock=null;}
  saveSettings();
}
function setAiMode(v){
  _aiModeEnabled=v===1;
  if(!_aiModeEnabled){S.yamnetOK=false;S.holdFrames=0;S.strOK=false;}
  document.querySelectorAll('#aimode-steps .step-btn').forEach(b=>b.classList.toggle('on',+b.dataset.v===v));
  saveSettings();
}

const SETTINGS_KEY='gopractice_settings_v1';
function saveSettings(){
  const d={cents:CFG.tuner.tolCents,rms:CFG.tuner.rmsMin,smooth:CFG.tuner.smoothing,wakelock:_wakeLockEnabled,aimode:_aiModeEnabled,bpm:S.bpm,timeSig:S.timeSig,subDiv:S.subDiv,refHz:S.refHz};
  try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(d));}catch(e){}
}
function loadSettings(){
  try{
    const raw=localStorage.getItem(SETTINGS_KEY);
    if(!raw)return;
    const d=JSON.parse(raw);
    if(d.cents){setCentsStep(d.cents);}
    if(d.rms){
      const idx=RMS_LEVELS.findIndex(v=>Math.abs(v-d.rms)<.001);
      if(idx>=0)setRmsStep(idx+1);
    }
    if(d.smooth){
      const idx=SMOOTH_LEVELS.findIndex(v=>Math.abs(v-d.smooth)<.001);
      if(idx>=0)setSmoothStep(idx+1);
    }
    if(d.wakelock===false)setWakeLock(0);
    if(d.aimode===false)setAiMode(0);
    if(d.bpm!=null)setBPM(d.bpm);
    if(d.timeSig!=null)setTS(d.timeSig);
    if(d.subDiv!=null)setSD(d.subDiv);
    if(d.refHz!=null){S.refHz=d.refHz;setRefDrumY(refHzToY(d.refHz),false);}
  }catch(e){}
}
loadSettings();

setTimeout(()=>{drawGauge(null);drawHistory();},200);
document.getElementById('metro-body').style.maxHeight='420px';

// ── Event listeners (replacing all inline HTML handlers) ──

// Mic popup
document.getElementById('mic-popup-btn').addEventListener('click', allowMic);
document.getElementById('mic-popup-cancel').addEventListener('click', closeMicPopup);

// Header
document.getElementById('logo').addEventListener('click', toggleFullscreen);
document.getElementById('hdr-mic-btn').addEventListener('click', ()=>openMic().then(ok=>{if(ok)toast('마이크가 켜졌어요');}));
document.getElementById('rec-hdr-btn').addEventListener('click', tbRec);
document.getElementById('menu-btn').addEventListener('click', toggleMenu);

// Metronome
document.getElementById('metro-play-hdr-btn').addEventListener('click', toggleMetro);
document.getElementById('metro-collapse-btn').addEventListener('click', toggleMetroCollapse);
document.getElementById('metro-play-btn').addEventListener('click', toggleMetro);
document.querySelectorAll('.m-adj').forEach(b=>b.addEventListener('click', ()=>adjBPM(b.textContent==='−'?-1:1)));
document.querySelectorAll('.m-adj-pad').forEach(b=>b.addEventListener('click', ()=>adjBPM(b.textContent==='−'?-1:1)));
const _volMain=document.getElementById('metro-vol'),_volPad=document.getElementById('metro-vol-pad-input');
_volMain.addEventListener('input', ()=>{setMetroVol(+_volMain.value);_volPad.value=_volMain.value;});
_volPad.addEventListener('input', ()=>{setMetroVol(+_volPad.value);_volMain.value=_volPad.value;});
document.querySelectorAll('[data-ts]').forEach(b=>b.addEventListener('click', ()=>setTS(+b.dataset.ts)));
document.querySelectorAll('[data-sd]').forEach(b=>b.addEventListener('click', ()=>setSD(b.dataset.sd==='d'?'d':+b.dataset.sd)));

// Reference note panel
document.querySelector('#ref-panel .panel-close').addEventListener('click', closeRefAll);
document.querySelectorAll('#ref-panel .ref-oct-btn').forEach(b=>b.addEventListener('click', ()=>adjRefOct(b.textContent==='−'?-1:1)));
document.querySelectorAll('#ref-panel .ref-note-btn').forEach(b=>b.addEventListener('click', ()=>{
  if(b.dataset.note==='도2')playRefHigh();else playRef(b.dataset.note);
}));

// Menu overlay
document.querySelector('.menu-close-btn').addEventListener('click', toggleMenu);
document.getElementById('settings-open-btn').addEventListener('click', openSettings);
document.getElementById('rec-toggle-btn').addEventListener('click', tbRec);
document.querySelectorAll('#menu-overlay .ref-oct-btn').forEach(b=>b.addEventListener('click', ()=>adjRefOct(b.textContent==='−'?-1:1)));
document.querySelectorAll('#menu-overlay .ref-note-btn').forEach(b=>b.addEventListener('click', ()=>{
  if(b.dataset.note==='도2')playRefHigh();else playRef(b.dataset.note);
}));

// Timer
document.getElementById('timer-toggle-btn').addEventListener('click', toggleTimer);
document.getElementById('timer-reset-btn').addEventListener('click', resetTimer);

// Settings page
document.getElementById('settings-back-btn').addEventListener('click', closeSettings);
document.querySelectorAll('#cents-steps .step-btn').forEach(b=>b.addEventListener('click', ()=>setCentsStep(+b.dataset.v)));
document.querySelectorAll('#smooth-steps .step-btn').forEach(b=>b.addEventListener('click', ()=>setSmoothStep(+b.dataset.v)));
document.querySelectorAll('#rms-steps .step-btn').forEach(b=>b.addEventListener('click', ()=>setRmsStep(+b.dataset.v)));
document.querySelectorAll('#aimode-steps .step-btn').forEach(b=>b.addEventListener('click', ()=>setAiMode(+b.dataset.v)));
document.querySelectorAll('#wakelock-steps .step-btn').forEach(b=>b.addEventListener('click', ()=>setWakeLock(+b.dataset.v)));

// Recording list (event delegation)
const _recList=document.getElementById('rec-list');
_recList.addEventListener('click', e=>{
  const t=e.target.closest('[data-action]');if(!t)return;
  const idx=+t.dataset.idx;
  if(t.dataset.action==='toggle')toggleRecItem(idx);
  else if(t.dataset.action==='play')recPlayPause(idx);
  else if(t.dataset.action==='edit')openEditor(idx);
  else if(t.dataset.action==='delete')deleteRec(idx);
});
_recList.addEventListener('input', e=>{
  if(e.target.dataset.action==='seek')recSeek(+e.target.dataset.idx);
});

// Editor page
document.getElementById('ed-back-btn').addEventListener('click', closeEditor);
document.getElementById('ed-title-edit').addEventListener('click', edEditTitle);
document.getElementById('ed-play-btn').addEventListener('click', edTogglePlay);
document.getElementById('ed-speed').addEventListener('input', e=>edSetSpeed(+e.target.value));
document.getElementById('ed-a-btn').addEventListener('click', edToggleA);
document.getElementById('ed-b-btn').addEventListener('click', edToggleB);
document.getElementById('ed-loop-btn').addEventListener('click', edToggleLoop);
document.getElementById('ed-bm-add-btn').addEventListener('click', edAddBookmark);
document.getElementById('ed-export-btn').addEventListener('click', edExportAB);
document.addEventListener('keydown', e=>{
  if(e.code==='Space'&&e.target.tagName!=='INPUT'&&e.target.tagName!=='TEXTAREA'){
    e.preventDefault();toggleMetro();
  }
});