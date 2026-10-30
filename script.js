/* ==========================================================
   PHYSIO MIRROR  ·  script.js
   Pose tracking, rep counting, quality score, hold timer,
   voice, pain logger, progress chart and caregiver report.

   TABLE OF CONTENTS  (press Ctrl+F and search [number])
   [1] Exercise library: easiest → hardest, 3 intensities each
   [2] In-session difficulty ramp
   [3] Hold timer UI
   [4] Geometry
   [5] UI rendering
   [6] Sound & voice coach (speech out)
   [7] Voice commands (speech in)
   [8] Celebration particles (pastel)
   [9] History (localStorage)
   [10] Pain logger: button, voice, or "free hand raised" gesture
   [11] Progress chart
   [12] Caregiver report (printable one-pager)
   [13] Movement-quality score
   [14] Session summary, pain check-in, level-up
   [15] Rep state machine (with in-session ramp + hold)
   [16] MediaPipe setup & main camera loop
   [17] Contents menu (panel navigation)

   Tip: to add a new exercise, edit the EX array in section [1].
   ========================================================== */

import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

/* ===== [1] Exercise library: easiest → hardest, 3 intensities each =====
   mode "up": rest<low, target>high · mode "down": rest>high, target<low */
const LV=["Beginner","Intermediate","Advanced"],INT=["Gentle","Standard","Full"],PHASE=["Warm-up","Working","Challenge"];
const HOLD=[0,2,3,5];
const EX=[
 {name:"Seated Knee Extension",d:"Straighten your knee from a chair",ic:"knee",lv:0,ids:{R:[24,26,28],L:[23,25,27]},mode:"up",levels:[{low:120,high:140},{low:110,high:155},{low:105,high:165}]},
 {name:"Elbow Extension",d:"Bend, then straighten your arm",ic:"elbow",lv:0,ids:{R:[12,14,16],L:[11,13,15]},mode:"up",levels:[{low:100,high:135},{low:80,high:150},{low:70,high:160}]},
 {name:"Lateral Raise",d:"Lift your arm out to the side",ic:"lateral",lv:1,ids:{R:[24,12,14],L:[23,11,13]},mode:"up",levels:[{low:25,high:55},{low:30,high:70},{low:30,high:85}]},
 {name:"Standing Knee Raise",d:"Lift your knee toward your chest",ic:"kneeup",lv:1,ids:{R:[12,24,26],L:[11,23,25]},mode:"down",levels:[{low:135,high:150},{low:120,high:155},{low:100,high:160}]},
 {name:"Mini Squat",d:"Bend your knees, then stand tall",ic:"squat",lv:2,ids:{R:[24,26,28],L:[23,25,27]},mode:"down",levels:[{low:140,high:158},{low:125,high:160},{low:105,high:160}]},
 {name:"Overhead Reach",d:"Raise your arm up past your head",ic:"overhead",lv:2,ids:{R:[24,12,14],L:[23,11,13]},mode:"up",levels:[{low:40,high:110},{low:40,high:130},{low:40,high:150}]},
];
const TILT_OK=8,TILT_WARN=14;
let exI=0,side="R",reps=0,goal=5,inten=0,holdI=0,holdT0=0,lostT=0,lastTick=-1,finished=false,stage="idle",smooth=null,t0=0,tilt=0,startT=null,maxTilt=0,scores=[],marks=[];
const $=id=>document.getElementById(id),video=$("video"),cv=$("cv"),ctx=cv.getContext("2d"),fx=$("fx"),fctx=fx.getContext("2d");
const I=n=>`<svg class="ic"><use href="#i-${n}"/></svg>`;
const cur=()=>EX[exI].levels[inten];

/* ===== [2] In-session difficulty ramp =====
   First ~30% of reps = Warm-up (easier target), middle = Working (normal), last ~30% = Challenge (slightly deeper) */
const phaseIdx=()=>{const f=reps/goal;return f<.3?0:f>=.7?2:1;};
function thresholds(){
  const {low,high}=cur(),span=high-low,up=EX[exI].mode==="up",p=phaseIdx();let l=low,h=high;
  if(p===0){up?h=high-span*.3:l=low+span*.3;}
  else if(p===2){up?h=Math.min(178,high+span*.1):l=Math.max(20,low-span*.1);}
  return {low:l,high:h};
}

/* ===== [3] Hold timer UI ===== */
function showHold(el){
  const hs=HOLD[holdI],n=Math.ceil(Math.max(0,hs-el));
  $("hold").classList.add("show");$("holdN").textContent=n;
  $("holdArc").style.strokeDashoffset=414.7*(1-Math.min(el/hs,1));
  if(n!==lastTick){lastTick=n;if(n>0)tone(660,0,.15);}
}
function hideHold(){$("hold").classList.remove("show");lastTick=-1;}

/* ===== [4] Geometry ===== */
function calculateAngle(A,B,C){
  const r=Math.atan2(C.y-B.y,C.x-B.x)-Math.atan2(A.y-B.y,A.x-B.x);
  let a=Math.abs(r*180/Math.PI);return a>180?360-a:a;
}
function torsoTilt(lm){
  const sh={x:(lm[11].x+lm[12].x)/2,y:(lm[11].y+lm[12].y)/2},hp={x:(lm[23].x+lm[24].x)/2,y:(lm[23].y+lm[24].y)/2};
  return {deg:Math.abs(Math.atan2(sh.x-hp.x,hp.y-sh.y))*180/Math.PI,sh,hp};
}

/* ===== [5] UI rendering ===== */
function renderEx(){
  $("exs").innerHTML=EX.map((e,i)=>`<button class="ex ${i===exI?'sel':''}" data-i="${i}"><span class="exi">${I(e.ic)}</span><em class="bd b${e.lv}">${LV[e.lv]}</em><b>${e.name}</b><small>${e.d}</small></button>`).join("");
  document.querySelectorAll(".ex").forEach(b=>b.onclick=()=>goEx(+b.dataset.i));
  renderSeg();
}
function renderSeg(){
  $("seg").innerHTML=INT.map((n,i)=>`<button class="${i===inten?'sel':''}" data-i="${i}">${n}</button>`).join("");
  document.querySelectorAll("#seg button").forEach(b=>b.onclick=()=>{inten=+b.dataset.i;resetAll();renderSeg();});
  $("holdSeg").innerHTML=HOLD.map((h,i)=>`<button class="${i===holdI?'sel':''}" data-i="${i}">${h?h+" s":"Off"}</button>`).join("");
  document.querySelectorAll("#holdSeg button").forEach(b=>b.onclick=()=>{holdI=+b.dataset.i;resetAll();renderSeg();});
  $("intName").textContent=INT[inten];$("holdName").textContent=HOLD[holdI]?HOLD[holdI]+" s":"Off";
  renderRng();
}
function renderRng(){
  const {low,high}=thresholds(),l=Math.round(low),h=Math.round(high);
  $("rng").textContent=(EX[exI].mode==="up"?`This rep: start below ${l}°, then reach above ${h}°`:`This rep: start above ${h}°, then reach below ${l}°`)+(holdI?` · hold ${HOLD[holdI]} s`:"");
}
function renderReps(){
  $("reps").textContent=reps;$("goalT").textContent=goal;$("goalN").textContent=goal;
  $("arc").style.strokeDashoffset=326.7*(1-Math.min(reps/goal,1));
  $("phase").innerHTML=I("bolt")+PHASE[phaseIdx()];renderRng();
}
function resetAll(){hideHold();finished=false;reps=0;stage="idle";smooth=null;startT=null;maxTilt=0;scores=[];marks=[];$("lastS").textContent=$("avgS").textContent="--";setFb("Get ready");renderReps();}
function goEx(i){exI=Math.max(0,Math.min(EX.length-1,i));inten=0;holdI=0;resetAll();renderEx();}
function setSide(s){side=s;$("side").textContent=s==="R"?"Right":"Left";resetAll();}
function setFb(t,m){const f=$("fb");f.textContent=t;f.className="fb glass "+(m||"");}
$("reset").onclick=resetAll;
$("sideBtn").onclick=()=>setSide(side==="R"?"L":"R");
$("gp").onclick=()=>{goal=Math.min(50,goal+1);renderReps();};
$("gm").onclick=()=>{goal=Math.max(1,goal-1);renderReps();};

/* ===== [6] Sound & voice coach (speech out) ===== */
let ac;
function tone(f,t=0,d=.4){ac=ac||new AudioContext();const o=ac.createOscillator(),g=ac.createGain();o.frequency.value=f;o.connect(g);g.connect(ac.destination);
  const s=ac.currentTime+t;g.gain.setValueAtTime(.18,s);g.gain.exponentialRampToValueAtTime(.001,s+d);o.start(s);o.stop(s+d);}
const ding=()=>tone(784),fanfare=()=>[523,659,784,1047].forEach((f,i)=>tone(f,i*.13,.6));
let voiceOn=true,lastSpoke=0;
function speak(t,gap=0){
  if(!voiceOn||!window.speechSynthesis)return;const n=Date.now();if(n-lastSpoke<gap)return;lastSpoke=n;
  speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t);u.lang="en-US";u.rate=.95;speechSynthesis.speak(u);
}
const updVoice=()=>{$("voice").innerHTML=I("vol")+"Coach voice: "+(voiceOn?"On":"Off");$("voice").classList.toggle("act",voiceOn);};
$("voice").onclick=()=>{voiceOn=!voiceOn;updVoice();if(!voiceOn&&window.speechSynthesis)speechSynthesis.cancel();};

/* ===== [7] Voice commands (speech in) ===== */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
let rec=null,cmdOn=false;
const updMic=()=>{$("mic").innerHTML=I("mic")+"Commands: "+(cmdOn?"On":"Off");$("mic").classList.toggle("act",cmdOn);$("heard").style.display=cmdOn?"flex":"none";};
function handleCmd(raw){
  const t=raw.toLowerCase().trim();let a=null;
  if(/\bnext\b/.test(t)){goEx(exI+1);a="Next exercise";}
  else if(/(previous|go back|\bback\b)/.test(t)){goEx(exI-1);a="Previous exercise";}
  else if(/\bleft\b/.test(t)){setSide("L");a="Left side";}
  else if(/\bright\b/.test(t)){setSide("R");a="Right side";}
  else if(/(switch|other side)/.test(t)){setSide(side==="R"?"L":"R");a="Switched side";}
  else if(/(harder|increase|more)/.test(t)){inten=Math.min(2,inten+1);resetAll();renderSeg();a="Harder";}
  else if(/(easier|gentler|less)/.test(t)){inten=Math.max(0,inten-1);resetAll();renderSeg();a="Easier";}
  else if(/\bhold\b/.test(t)){holdI=(holdI+1)%4;resetAll();renderSeg();a="Hold "+(HOLD[holdI]?HOLD[holdI]+" s":"off");}
  else if(/(pain|ouch|hurt)/.test(t)){markPain();a="Pain marked";}
  else if(/(reset|start over)/.test(t)){resetAll();a="Reset";}
  else if(/report/.test(t)){openReport();a="Report";}
  else if(/progress/.test(t)){renderProgress();$("modal").classList.add("open");a="Progress";}
  else if(/close/.test(t)){["modal","repModal","sum"].forEach(i=>$(i).classList.remove("open"));a="Closed";}
  $("heardT").textContent=a?`“${raw.trim()}” → ${a}`:`“${raw.trim()}” (not a command)`;
}
function makeRec(){
  const r=new SR();r.continuous=true;r.interimResults=false;r.lang="en-US";
  r.onresult=e=>{if(window.speechSynthesis&&speechSynthesis.speaking)return;
    for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)handleCmd(e.results[i][0].transcript);};
  r.onend=()=>{if(cmdOn)try{r.start()}catch{}};
  r.onerror=e=>{if(e.error==="not-allowed"||e.error==="service-not-allowed"){cmdOn=false;updMic();}};
  return r;
}
$("mic").onclick=()=>{
  if(!SR){alert("Voice commands need Chrome or Edge.");return;}
  cmdOn=!cmdOn;updMic();
  if(cmdOn){rec=rec||makeRec();try{rec.start()}catch{}}else if(rec)rec.stop();
};

/* ===== [8] Celebration particles (pastel) ===== */
let parts=[];
function burst(x,y,n=60){
  const hues=[150,18,350,205];
  for(let i=0;i<n;i++){const a=Math.random()*6.283,s=1.5+Math.random()*4.5;
    parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-1,life:1,h:hues[Math.random()*4|0]+Math.random()*12});}
}
function fxLoop(){
  fctx.clearRect(0,0,fx.width,fx.height);parts=parts.filter(p=>p.life>0);
  for(const p of parts){p.x+=p.vx;p.y+=p.vy;p.vy+=.07;p.vx*=.98;p.life-=.014;
    fctx.fillStyle=`hsla(${p.h},75%,68%,${p.life})`;fctx.beginPath();fctx.arc(p.x,p.y,3,0,6.283);fctx.fill();}
  requestAnimationFrame(fxLoop);
}
const sizeFx=()=>{fx.width=fx.clientWidth;fx.height=fx.clientHeight};addEventListener("resize",sizeFx);

/* ===== [9] History (localStorage) ===== */
const KEY="physio-mirror-log";
const dkey=d=>{const x=new Date(d);return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0")};
function loadLog(){try{return JSON.parse(localStorage.getItem(KEY))||{}}catch{return{}}}
function saveLog(l){try{localStorage.setItem(KEY,JSON.stringify(l))}catch{}}
function today(f){const l=loadLog(),k=dkey(Date.now()),r=l[k]||{reps:0,ss:0,sn:0};f(r);l[k]=r;saveLog(l);}
const logRep=s=>today(r=>{r.reps++;r.ss+=s;r.sn++;r.hs=(r.hs||0)+HOLD[holdI];
  r.ex=r.ex||{};const n=EX[exI].name,o=r.ex[n]||{reps:0,ss:0,mx:0};o.reps++;o.ss+=s;o.mx=Math.max(o.mx,inten);r.ex[n]=o;});
const logPain=p=>today(r=>{r.ps=(r.ps||0)+p;r.pn=(r.pn||0)+1;});
const logMark=m=>today(r=>{r.marks=(r.marks||[]).concat(m).slice(-40);});

/* ===== [10] Pain logger: button, voice, or "free hand raised" gesture ===== */
let lastMark=0,handT=0;
function markPain(){
  const n=Date.now();if(n-lastMark<3000)return;lastMark=n;
  const ang=smooth==null?0:Math.round(smooth),m={ex:EX[exI].name,angle:ang};
  marks.push(m);logMark(m);speak("Pain noted. Ease off, and rest if you need to.");
  $("tScore").textContent=ang+"°";$("tScore").style.color="var(--w)";$("tMsg").textContent="Pain marked · ease off if you need to";
  const t=$("toast");t.classList.add("show");clearTimeout(showToast.h);showToast.h=setTimeout(()=>t.classList.remove("show"),2600);
  const b=$("painBtn");b.classList.add("pulse");setTimeout(()=>b.classList.remove("pulse"),500);
}
$("painBtn").onclick=markPain;

/* ===== [11] Progress chart ===== */
function renderProgress(){
  const l=loadLog(),days=[];for(let i=6;i>=0;i--)days.push(dkey(Date.now()-i*864e5));
  const data=days.map(k=>l[k]||{reps:0,ss:0,sn:0});
  const sum=f=>data.reduce((a,b)=>a+(f(b)||0),0),total=sum(d=>d.reps),ss=sum(d=>d.ss),sn=sum(d=>d.sn),ps=sum(d=>d.ps),pn=sum(d=>d.pn);
  let streak=0;for(let i=6;i>=0;i--){if(data[i].reps>0)streak++;else if(i<6)break;}
  $("mStreak").textContent=streak+" d";$("mReps").textContent=total;$("mAvg").textContent=sn?Math.round(ss/sn):"--";$("mPain").textContent=pn?(ps/pn).toFixed(1):"--";
  const W=620,H=250,pl=34,pr=34,pt=26,pb=30,iw=W-pl-pr,ih=H-pt-pb,step=iw/7,bw=step*.5,mx=Math.max(10,...data.map(d=>d.reps));
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%">`;
  for(let i=0;i<=4;i++){const y=pt+ih*i/4;s+=`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="#ebe5dd"/><text x="${pl-8}" y="${y+4}" text-anchor="end">${Math.round(mx*(1-i/4))}</text><text x="${W-pr+8}" y="${y+4}">${100-i*25}</text>`;}
  let pts=[],list=[];
  data.forEach((d,i)=>{const x=pl+step*i+(step-bw)/2,h=ih*d.reps/mx,cx=x+bw/2;
    s+=`<rect class="bar1 ${i===6?'today':''}" x="${x}" y="${pt+ih-h}" width="${bw}" height="${h}" rx="7"/>`;
    s+=`<text x="${cx}" y="${H-10}" text-anchor="middle">${new Date(days[i]+"T00:00").toLocaleDateString("en",{weekday:"short"})}</text>`;
    if(d.sn)pts.push([cx,pt+ih*(1-d.ss/d.sn/100)]);
    const mk=d.marks||[];if(mk.length){const cy=Math.max(pt-4,pt+ih-h-16);s+=`<circle class="pm" cx="${cx}" cy="${cy}" r="10"/><text class="pmt" x="${cx}" y="${cy+4}" text-anchor="middle">${mk.length}</text>`;
      mk.forEach(m=>list.push(`${new Date(days[i]+"T00:00").toLocaleDateString("en",{weekday:"short"})}: ${m.ex} at <b>${m.angle}°</b>`));}});
  if(pts.length>1)s+=`<polyline class="ln" points="${pts.map(p=>p.join(",")).join(" ")}"/>`;
  pts.forEach(p=>s+=`<circle class="pt" cx="${p[0]}" cy="${p[1]}" r="4"/>`);
  $("chart").innerHTML=s+"</svg>";
  $("pmList").innerHTML=list.length?"<b>Pain marked</b> — "+list.slice(-6).join(" · "):"No pain marked this week.";
}
$("prog").onclick=()=>{renderProgress();$("modal").classList.add("open");};
$("close").onclick=()=>$("modal").classList.remove("open");
$("clear").onclick=()=>{saveLog({});renderProgress();};
$("demo").onclick=()=>{const l=loadLog(),names=["Lateral Raise","Seated Knee Extension","Elbow Extension"];
  for(let i=6;i>=1;i--){const n=Math.random()<.15?0:6+Math.random()*8|0,sc=68+(7-i)*2+Math.random()*10,pa=Math.max(1,Math.round((6-(6-i)*.6+Math.random())*10)/10);
    const mk=(i===5||i===3||i===2)?Array.from({length:i>3?1:i>2?2:1},()=>({ex:names[Math.random()*3|0],angle:60+Math.random()*80|0})):[];
    let exm={};if(n){const k=Math.min(4,1+((7-i)/2|0)),mxl=Math.min(2,(7-i)/3|0);for(let j=0;j<n;j++){const nm=EX[Math.random()*k|0].name,o=exm[nm]||{reps:0,ss:0,mx:0};o.reps++;o.ss+=Math.round(sc);o.mx=Math.max(o.mx,mxl);exm[nm]=o;}}
    l[dkey(Date.now()-i*864e5)]=n?{reps:n,ss:Math.round(sc*n),sn:n,ps:pa,pn:1,marks:mk,ex:exm,hs:(7-i)>3?n*2:0}:{reps:0,ss:0,sn:0};}
  saveLog(l);renderProgress();};

/* ===== [12] Caregiver report (printable one-pager) ===== */
const esc=t=>String(t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmtD=(k,o)=>new Date(k+"T00:00").toLocaleDateString("en",o);
const lsGet=k=>{try{return localStorage.getItem(k)||""}catch{return""}},lsSet=(k,v)=>{try{localStorage.setItem(k,v)}catch{}};
function trendOf(arr,thr){if(arr.length<2)return 0;const h=arr.length/2|0,m=x=>x.reduce((p,c)=>p+c,0)/x.length,d=m(arr.slice(h))-m(arr.slice(0,h));return Math.abs(d)<thr?0:d>0?1:-1;}
function reportData(){
  const l=loadLog(),days=[];for(let i=6;i>=0;i--)days.push(dkey(Date.now()-i*864e5));
  const data=days.map(k=>l[k]||{reps:0,ss:0,sn:0}),sum=f=>data.reduce((a,d)=>a+(f(d)||0),0);
  const total=sum(d=>d.reps),sn=sum(d=>d.sn),ss=sum(d=>d.ss),pn=sum(d=>d.pn),ps=sum(d=>d.ps),hs=sum(d=>d.hs);
  const act=data.filter(d=>d.reps>0).length;let streak=0;for(let i=6;i>=0;i--){if(data[i].reps>0)streak++;else if(i<6)break;}
  const pains=data.filter(d=>d.pn).map(d=>d.ps/d.pn),quals=data.filter(d=>d.sn).map(d=>d.ss/d.sn);
  const exAgg={};data.forEach(d=>Object.entries(d.ex||{}).forEach(([n,o])=>{const a=exAgg[n]||(exAgg[n]={reps:0,ss:0,mx:0});a.reps+=o.reps;a.ss+=o.ss;a.mx=Math.max(a.mx,o.mx);}));
  const mk=[];data.forEach((d,i)=>(d.marks||[]).forEach(m=>mk.push({day:days[i],...m})));
  return {days,total,act,streak,hs,avgQ:sn?Math.round(ss/sn):null,avgP:pn?ps/pn:null,tq:trendOf(quals,3),tp:trendOf(pains,.7),exAgg,mk};
}
function observations(r){
  if(!r.total)return ["No sessions have been recorded this week yet."];
  const o=[],byEx={};r.mk.forEach(m=>byEx[m.ex]=(byEx[m.ex]||0)+1);const top=Object.entries(byEx).sort((a,b)=>b[1]-a[1])[0];
  o.push(`Completed ${r.total} repetitions on ${r.act} of 7 days${r.streak>=3?` (current streak: ${r.streak} days)`:""}.`);
  if(r.avgQ!==null)o.push(`Movement quality averaged ${r.avgQ}/100${r.tq>0?", improving through the week":r.tq<0?", lower later in the week — consider slowing down":", staying steady"}.`);
  if(r.avgP!==null)o.push(`Self-reported pain averaged ${r.avgP.toFixed(1)}/10${r.tp<0?" and is trending down":r.tp>0?" and is trending up — worth discussing with the therapist":", with no clear trend"}.`);
  o.push(r.mk.length?`Pain was marked ${r.mk.length} time${r.mk.length>1?"s":""}, most often during ${top[0]}.`:"No pain events were marked this week.");
  if(r.hs)o.push(`Total time spent holding the end position: ${r.hs} seconds.`);
  return o;
}
const needsCheck=r=>r.total&&((r.avgP!==null&&r.avgP>=6)||r.mk.length>=3||(r.tp>0&&r.avgP>=4));
function openReport(){
  renderProgress();const r=reportData(),d=r.days,chart=$("chart").innerHTML,legend=document.querySelector("#modal .legend").outerHTML;
  const range=`${fmtD(d[0],{month:"short",day:"numeric"})} – ${fmtD(d[6],{month:"short",day:"numeric",year:"numeric"})}`;
  const rows=EX.filter(e=>r.exAgg[e.name]).map(e=>{const a=r.exAgg[e.name];return `<tr><td>${e.name}</td><td>${a.reps}</td><td>${Math.round(a.ss/a.reps)}</td><td>${INT[a.mx]}</td></tr>`}).join("");
  const pl=r.mk.length?r.mk.map(m=>`<li>${fmtD(m.day,{weekday:"short"})} — ${esc(m.ex)} at ${m.angle}°</li>`).join(""):"<li>None recorded.</li>";
  const arrow=r.tp<0?"↓ trending down":r.tp>0?"↑ trending up":"→ stable";
  $("sheet").innerHTML=`
   <div class="sh-head"><div><h2>Weekly Progress Report</h2><div class="sub">Physio Mirror · ${range}</div></div><div class="logo">${I("pulse")}</div></div>
   <h4>Patient</h4><input id="rName" placeholder="Patient name" value="${esc(lsGet("pm-name"))}">
   <h4>Notes for family / therapist</h4><textarea id="rNote" rows="3" placeholder="e.g. type of injury, surgery date, therapist's instructions">${esc(lsGet("pm-note"))}</textarea>
   <div class="stats">
    <div class="tile"><div class="lbl">Active days</div><div class="v">${r.act}/7</div></div>
    <div class="tile"><div class="lbl">Total reps</div><div class="v">${r.total}</div></div>
    <div class="tile"><div class="lbl">Avg quality</div><div class="v">${r.avgQ??"--"}</div></div>
    <div class="tile"><div class="lbl">Avg pain</div><div class="v">${r.avgP!==null?r.avgP.toFixed(1):"--"}</div>${r.avgP!==null?`<div class="hint">${arrow}</div>`:""}</div>
   </div>
   <h4>Daily activity</h4>${chart}${legend}
   <h4>Exercises this week</h4>${rows?`<table><tr><th>Exercise</th><th>Reps</th><th>Avg quality</th><th>Highest intensity</th></tr>${rows}</table>`:"<div class='hint'>No exercise data yet.</div>"}
   <h4>Pain events</h4><ul>${pl}</ul>
   <h4>Observations</h4><ul>${observations(r).map(x=>`<li>${x}</li>`).join("")}${needsCheck(r)?"<li class='att'>Attention: please check in with the physiotherapist before increasing difficulty.</li>":""}</ul>
   <div class="fine">Generated by Physio Mirror (made by CELESTINA) on ${new Date().toLocaleDateString("en",{year:"numeric",month:"long",day:"numeric"})}. This report is for self-tracking and sharing with a physiotherapist or caregiver. It is not a medical diagnosis. Joint angles are estimated from a single camera and may vary with camera position.</div>`;
  $("repModal").classList.add("open");
}
$("sheet").addEventListener("input",e=>{if(e.target.id==="rName")lsSet("pm-name",e.target.value);if(e.target.id==="rNote")lsSet("pm-note",e.target.value);});
$("rep").onclick=openReport;
$("rClose").onclick=()=>$("repModal").classList.remove("open");
$("rPrint").onclick=()=>window.print();
$("rCopy").onclick=async()=>{
  const r=reportData(),n=lsGet("pm-name"),d=r.days;
  const txt=[`Physio Mirror weekly report${n?" for "+n:""} (${fmtD(d[0],{month:"short",day:"numeric"})} – ${fmtD(d[6],{month:"short",day:"numeric"})})`,
    `Active days: ${r.act}/7 · Total reps: ${r.total} · Avg quality: ${r.avgQ??"--"} · Avg pain: ${r.avgP!==null?r.avgP.toFixed(1):"--"}`,
    ...observations(r).map(x=>"- "+x),...(needsCheck(r)?["- Attention: please check in with the physiotherapist before increasing difficulty."]:[])].join("\n");
  try{await navigator.clipboard.writeText(txt);$("rCopy").lastChild.textContent="Copied!";setTimeout(()=>$("rCopy").lastChild.textContent="Copy summary",1500);}catch{prompt("Copy this summary:",txt);}
};

/* ===== [13] Movement-quality score ===== */
function scoreRep(){
  const dur=(performance.now()-startT)/1000;
  const tp=Math.min(45,Math.max(0,maxTilt-TILT_OK)*3.5),sp=dur<1.2?Math.min(25,(1.2-dur)*40):0;
  const score=Math.round(Math.max(0,100-tp-sp));
  const msg=tp>=10?`Torso leaned ${Math.round(maxTilt)}° — stay tall`:sp>=8?"A little fast — slow and steady":"Smooth and controlled";
  return {score,label:score>=90?"Excellent":score>=75?"Good":"Needs care",msg};
}
function showToast(r){
  $("tScore").textContent=r.score;$("tScore").style.color=r.score>=90?"var(--a)":r.score>=75?"#d98c63":"var(--w)";
  $("tMsg").textContent=r.label+" · "+r.msg;const t=$("toast");t.classList.add("show");clearTimeout(showToast.h);showToast.h=setTimeout(()=>t.classList.remove("show"),2200);
}

/* ===== [14] Session summary, pain check-in, level-up ===== */
let pain=null;
const avgScore=()=>scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0;
function nextStep(){
  const avg=avgScore();
  if(pain!==null&&pain>=7)return{msg:"Your pain level is high. Please rest today and check in with your physiotherapist.",next:null};
  if(marks.length)return{msg:"You marked pain during this set. Let's repeat gently, or rest and check with your physiotherapist.",next:null};
  if(avg<75||(pain!==null&&pain>=5))return{msg:"Let's repeat this level to build control and comfort before progressing.",next:null};
  if(inten<2)return{msg:`Great form! You're ready to try ${INT[inten+1]} intensity.`,label:`Try ${INT[inten+1]}`,next:()=>{inten++;}};
  if(holdI<3)return{msg:`Strong at full range! Now build endurance with a ${HOLD[holdI+1]} s hold.`,label:`Add ${HOLD[holdI+1]} s hold`,next:()=>{holdI++;}};
  if(exI<EX.length-1)return{msg:`Excellent work! Next up: ${EX[exI+1].name}.`,label:"Next exercise",next:()=>{exI++;inten=0;holdI=0;}};
  return{msg:"You've completed every level. Fantastic work!",next:null};
}
function renderPain(){
  $("pain").innerHTML=Array.from({length:11},(_,i)=>`<button class="${i===pain?'sel':''}" data-i="${i}">${i}</button>`).join("");
  document.querySelectorAll("#pain button").forEach(b=>b.onclick=()=>{pain=+b.dataset.i;renderPain();renderRec();});
}
function renderRec(){
  const n=nextStep(),b=$("sNext");
  if(pain===null){$("rec").textContent="Please rate your pain to see your recommendation.";b.style.display="none";return;}
  $("rec").textContent=n.msg;b.style.display=n.next?"":"none";b.textContent=n.label||"Level up";
}
function openSummary(){
  $("sReps").textContent=reps;$("sAvg").textContent=avgScore();$("sMarks").textContent=marks.length;
  const s=(Date.now()-t0)/1000|0;$("sTime").textContent=(s/60|0)+":"+String(s%60).padStart(2,"0");
  pain=null;renderPain();renderRec();$("sum").classList.add("open");
}
const closeSum=()=>{if(pain!==null)logPain(pain);$("sum").classList.remove("open");};
$("sRepeat").onclick=()=>{closeSum();resetAll();};
$("sNext").onclick=()=>{const n=nextStep();closeSum();if(n.next)n.next();resetAll();renderEx();};
$("sClose").onclick=closeSum;

function finishRep(){
  const r=scoreRep();stage="return";reps=Math.min(reps+1,goal);scores.push(r.score);
  renderReps();ding();logRep(r.score);showToast(r);
  $("lastS").textContent=r.score;$("avgS").textContent=avgScore();return true;
}
/* ===== [15] Rep state machine (with in-session ramp + hold) ===== */
function update(angle){
  const e=EX[exI],{low,high}=thresholds(),up=e.mode==="up";
  const rest=up?angle<low:angle>high,target=up?angle>high:angle<low;
  let pct=up?(angle-low)/(high-low):(high-angle)/(high-low);
  pct=Math.max(0,Math.min(1,pct));$("pbar").style.width=pct*100+"%";
  if(rest){stage="ready";startT=null;maxTilt=0;hideHold();}
  else if(stage==="ready"&&!startT)startT=performance.now();
  if(startT)maxTilt=Math.max(maxTilt,tilt);
  const hs=HOLD[holdI];
  if(target&&stage==="ready"&&startT&&!finished){
    if(hs>0){stage="holding";holdT0=performance.now();lostT=0;speak("Hold");}
    else return finishRep();
  }
  if(stage==="holding"){
    const tol=(high-low)*.12,now=performance.now(),inT=up?angle>high-tol:angle<low+tol;
    if(inT){lostT=0;const el=(now-holdT0)/1000;if(el>=hs){hideHold();return finishRep();}showHold(el);setFb("Hold it… "+Math.ceil(hs-el),"ok");}
    else if(!lostT)lostT=now;
    else if(now-lostT>400){stage="ready";hideHold();setFb("Released early — reach the target and hold again","warn");speak("A little longer next time",3000);}
    return false;
  }
  if(startT&&tilt>TILT_WARN){setFb("Keep your torso upright","warn");speak("Keep your torso upright",4000);}
  else if(stage==="return")setFb("Lovely. Return to start","ok");
  else if(stage==="idle")setFb("Move into the starting position");
  else setFb(pct<.3?"Begin the movement":pct<.85?"Keep going…":"Almost there!");
  return false;
}

/* ===== [16] MediaPipe setup & main camera loop ===== */
let pose,last=-1;
async function init(){
  const fs=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  pose=await PoseLandmarker.createFromOptions(fs,{baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",delegate:"GPU"},runningMode:"VIDEO",numPoses:1});
}
$("start").onclick=async()=>{
  try{
    $("stat").textContent="Loading AI…";$("start").disabled=true;ac=ac||new AudioContext();
    await init();
    video.srcObject=await navigator.mediaDevices.getUserMedia({video:{width:1280,height:720}});
    video.onloadeddata=()=>{cv.width=video.videoWidth;cv.height=video.videoHeight;sizeFx();$("ov").style.display="none";
      $("chipL").classList.add("on");$("stat").textContent="AI camera active";t0=Date.now();speak("Let's begin. Move into the starting position.");loop();};
  }catch(e){$("stat").textContent="Error";$("start").disabled=false;alert("Camera/AI error: "+e.message);}
};

const CONN=PoseLandmarker.POSE_CONNECTIONS.filter(c=>c.start>10&&c.end>10);
function loop(){
  if(video.currentTime!==last){
    last=video.currentTime;
    const res=pose.detectForVideo(video,performance.now()),W=cv.width,H=cv.height;
    ctx.clearRect(0,0,W,H);
    if(res.landmarks.length){
      const lm=res.landmarks[0];
      ctx.lineCap="round";ctx.strokeStyle="rgba(255,255,255,.92)";ctx.lineWidth=3.5;ctx.shadowColor="rgba(0,0,0,.35)";ctx.shadowBlur=6;
      for(const c of CONN){const a=lm[c.start],b=lm[c.end];ctx.beginPath();ctx.moveTo(a.x*W,a.y*H);ctx.lineTo(b.x*W,b.y*H);ctx.stroke();}
      ctx.fillStyle="#fff";ctx.strokeStyle="#6f9c82";ctx.lineWidth=2.5;
      lm.forEach((p,i)=>{if(i>10){ctx.beginPath();ctx.arc(p.x*W,p.y*H,5,0,6.283);ctx.fill();ctx.stroke();}});
      if([11,12,23,24].every(i=>(lm[i].visibility??1)>.5)){
        const t=torsoTilt(lm);tilt=tilt*.7+t.deg*.3;
        const col=tilt<TILT_OK?"#8fe3b4":tilt<TILT_WARN?"#ffd08a":"#ff7b6e";
        ctx.strokeStyle=col;ctx.lineWidth=3.5;ctx.setLineDash([8,8]);
        ctx.beginPath();ctx.moveTo(t.hp.x*W,t.hp.y*H);ctx.lineTo(t.sh.x*W,t.sh.y*H);ctx.stroke();ctx.setLineDash([]);
        $("tilt").textContent=Math.round(tilt)+"°";$("tilt").style.color=tilt<TILT_OK?"var(--a)":tilt<TILT_WARN?"#d98c63":"var(--w)";
      }
      // pain gesture: the free (non-tracked) hand held above the nose for 1.2 s
      const fh=lm[side==="R"?15:16],nose=lm[0];
      if((fh.visibility??1)>.5&&fh.y<nose.y-.02){if(!handT)handT=Date.now();else if(Date.now()-handT>1200){markPain();handT=0;}}else handT=0;
      const [a,b,c]=EX[exI].ids[side].map(i=>lm[i]);
      if([a,b,c].every(p=>(p.visibility??1)>.5)){
        const raw=calculateAngle(a,b,c);smooth=smooth===null?raw:smooth*.6+raw*.4;
        ctx.strokeStyle="#ffb08a";ctx.shadowColor="rgba(229,100,90,.5)";ctx.shadowBlur=10;ctx.lineWidth=7;
        ctx.beginPath();ctx.moveTo(a.x*W,a.y*H);ctx.lineTo(b.x*W,b.y*H);ctx.lineTo(c.x*W,c.y*H);ctx.stroke();
        ctx.fillStyle="#ffb08a";[a,b,c].forEach(p=>{ctx.beginPath();ctx.arc(p.x*W,p.y*H,8.5,0,6.283);ctx.fill();});
        ctx.save();ctx.translate(b.x*W+16,b.y*H-14);ctx.scale(-1,1);ctx.shadowColor="rgba(0,0,0,.55)";ctx.shadowBlur=8;
        ctx.font="700 26px 'DM Sans',sans-serif";ctx.fillStyle="#fff";ctx.textAlign="right";ctx.fillText(Math.round(smooth)+"°",0,0);ctx.restore();
        $("angle").textContent=Math.round(smooth)+"°";
        if(update(smooth)){
          burst((1-b.x)*fx.width,b.y*fx.height,55);
          const ls=scores[scores.length-1];
          if(reps<goal)speak((ls>=90?"Excellent. ":ls>=75?"Good. ":"Slow down. ")+reps+" of "+goal);
          if(reps>=goal){finished=true;fanfare();speak("Goal complete. Well done!");setTimeout(openSummary,2400);setFb("Goal complete — well done!","ok");
            for(let i=1;i<=5;i++)setTimeout(()=>burst(fx.width*(.15+Math.random()*.7),fx.height*(.15+Math.random()*.4),80),i*260);}
        }
      }else setFb("Step back so the whole limb is visible");
    }else setFb("No person detected");
  }
  const s=(Date.now()-t0)/1000|0;$("chipR").textContent=String(s/60|0).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
  requestAnimationFrame(loop);
}
/* ===== [17] Contents menu (panel navigation) =====
   Tabs: Exercise (pick + intensity + hold) · Live (angle + quality) · Goal · Tools */
const SECS=["sec-ex","sec-live","sec-goal","sec-tools"],tocLinks=[...document.querySelectorAll("#toc a")],panelEl=document.querySelector(".panel"),sp=$("tocSpacer");
let tocLock=0;
const setCur=id=>tocLinks.forEach(a=>a.classList.toggle("cur",a.dataset.t===id));
// Adds blank scroll room at the bottom so "Live" and "Goal" can really reach the top of the panel
function fitSpacer(){
  sp.style.display="none";
  const relGoal=$("sec-goal").getBoundingClientRect().top-panelEl.getBoundingClientRect().top+panelEl.scrollTop;
  const h=panelEl.clientHeight-56-(panelEl.scrollHeight-relGoal)-18;
  if(h>0){sp.style.height=h+"px";sp.style.display="block";}
}
const contentMax=()=>panelEl.scrollHeight-(sp.style.display==="block"?sp.offsetHeight+18:0)-panelEl.clientHeight;
tocLinks.forEach(a=>a.onclick=()=>{
  const id=a.dataset.t,t=$(id);if(!t)return;
  setCur(id);tocLock=Date.now()+900;                       // highlight right away
  if(id==="sec-tools")panelEl.scrollTo({top:Math.max(0,contentMax()),behavior:"smooth"});   // bottom of the real content
  else t.scrollIntoView({behavior:"smooth",block:"start"}); // section starts right under the menu
});
function tocSpy(){
  if(Date.now()<tocLock)return;
  const line=$("toc").getBoundingClientRect().bottom+16;let cur=SECS[0];
  SECS.forEach(id=>{if($(id).getBoundingClientRect().top<=line)cur=id;});
  if(panelEl.scrollTop>0&&Math.abs(panelEl.scrollTop-contentMax())<=8)cur="sec-tools";
  setCur(cur);
}
panelEl.addEventListener("scroll",tocSpy,{passive:true});addEventListener("scroll",tocSpy,{passive:true});
addEventListener("resize",fitSpacer);addEventListener("load",fitSpacer);if(document.fonts)document.fonts.ready.then(fitSpacer);
fitSpacer();setCur(SECS[0]);

updVoice();updMic();renderEx();renderReps();fxLoop();

/* ==========================================================
   Made by CELESTINA
   ========================================================== */
