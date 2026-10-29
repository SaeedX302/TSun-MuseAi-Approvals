const enabled=document.getElementById("enabled"), pub=document.getElementById("publicLinks");
const state=document.getElementById("stateText"), footer=document.getElementById("footerText"), mode=document.getElementById("mode"), pillText=document.getElementById("statusPillText");
const countEl=document.getElementById("clickCount"), lastEl=document.getElementById("lastClick"), historyList=document.getElementById("historyList"), historyEmpty=document.getElementById("historyEmpty"), resetBtn=document.getElementById("resetHistory");
const delaySelect=document.getElementById("delaySelect"), autoOffSelect=document.getElementById("autoOffSelect"), badgePosSelect=document.getElementById("badgePosSelect");
function fmtTime(ts){ if(!ts) return "—"; try { return new Date(ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"}); } catch(_) { return "—"; } }
function renderHistory(history){
  historyList.innerHTML="";
  const items=Array.isArray(history)?history:[];
  historyEmpty.style.display=items.length?"none":"block";
  items.slice(0,5).forEach(h=>{
    const li=document.createElement("li");
    const type=document.createElement("strong"); type.textContent=h.type==="public"?"Public link":"Hatch file";
    const time=document.createElement("span"); time.textContent=fmtTime(h.t);
    li.appendChild(type); li.appendChild(time); historyList.appendChild(li);
  });
}
function refresh(){chrome.storage.local.get({hunaarEnabled:false,hunaarAllowPublicLinks:false,aiClickCount:0,aiLastClick:null,aiClickHistory:[],aiClickDelayMs:1000,aiAutoOffMinutes:120,aiBadgePosition:"top-right"},s=>{
  enabled.checked=!!s.hunaarEnabled; pub.checked=!!s.hunaarAllowPublicLinks;
  document.body.classList.toggle("is-enabled",!!s.hunaarEnabled);
  state.textContent=s.hunaarEnabled?"Enabled":"Disabled";
  footer.textContent=s.hunaarEnabled?"Automation is active":"Automation is off";
  pillText.textContent=s.hunaarEnabled?"On":"Off";
  mode.textContent=s.hunaarEnabled&&s.hunaarAllowPublicLinks?"Auto-click enabled":"Manual approval";
  countEl.textContent=s.aiClickCount||0;
  lastEl.textContent=fmtTime(s.aiLastClick);
  renderHistory(s.aiClickHistory);
  delaySelect.value=String(s.aiClickDelayMs);
  autoOffSelect.value=String(s.aiAutoOffMinutes);
  badgePosSelect.value=s.aiBadgePosition||"top-right";
});}
function save(key,value){chrome.storage.local.set({[key]:value},refresh);}
enabled.addEventListener("change",()=>save("hunaarEnabled",enabled.checked));
pub.addEventListener("change",()=>save("hunaarAllowPublicLinks",pub.checked));
delaySelect.addEventListener("change",()=>save("aiClickDelayMs",Number(delaySelect.value)));
autoOffSelect.addEventListener("change",()=>save("aiAutoOffMinutes",Number(autoOffSelect.value)));
badgePosSelect.addEventListener("change",()=>save("aiBadgePosition",badgePosSelect.value));
resetBtn.addEventListener("click",()=>{chrome.storage.local.set({aiClickCount:0,aiLastClick:null,aiClickHistory:[]},refresh);});
chrome.storage.onChanged.addListener((changes,area)=>{ if(area==="local") refresh(); });
refresh();
