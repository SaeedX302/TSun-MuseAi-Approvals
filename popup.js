/* TSun-MuseAi-Approvals — popup v11.0.0 */

const enabled=document.getElementById("enabled"), pub=document.getElementById("publicLinks");
const state=document.getElementById("stateText"), footer=document.getElementById("footerText"), mode=document.getElementById("mode"), pillText=document.getElementById("statusPillText");
const countEl=document.getElementById("clickCount"), lastEl=document.getElementById("lastClick"), historyList=document.getElementById("historyList"), historyEmpty=document.getElementById("historyEmpty"), resetBtn=document.getElementById("resetHistory");
const delaySelect=document.getElementById("delaySelect"), autoOffSelect=document.getElementById("autoOffSelect"), badgeVisible=document.getElementById("badgeVisible"), resetBadge=document.getElementById("resetBadge");
const tabStatus=document.getElementById("tabStatus"), tabHint=document.getElementById("tabHint");

const MUSE_URL=/^https?:\/\/([a-z0-9-]+\.)*muse\.ai(?:[\/:?#]|$)/i;

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

/* Keep the real stored value visible even when it is not a preset. */
function setSelect(sel,value){
  const v=String(value);
  const match=Array.prototype.filter.call(sel.options,o=>o.value===v)[0];
  let custom=sel.querySelector("option[data-custom]");
  if(match){ if(custom) custom.remove(); sel.value=v; return; }
  if(!custom){ custom=document.createElement("option"); custom.dataset.custom="1"; sel.appendChild(custom); }
  custom.value=v; custom.textContent=v;
  sel.value=v;
}

function tabUnknown(){
  tabStatus.textContent="Unknown";
  tabHint.textContent="Tab information unavailable — settings are still saved.";
  tabHint.classList.add("warn");
}

function checkTab(){
  try{
    chrome.tabs.query({active:true,currentWindow:true},tabs=>{
      if(chrome.runtime.lastError){ tabUnknown(); return; }
      const tab=tabs&&tabs[0];
      const url=tab&&tab.url?tab.url:"";
      const onMuse=MUSE_URL.test(url);
      let label="Not a Muse tab";
      if(onMuse) label="muse.ai";
      else if(url){ try { label=new URL(url).hostname; } catch(_) { label="Not a Muse tab"; } }
      tabStatus.textContent=label;
      tabHint.textContent=onMuse
        ? "Muse tab detected — changes apply to it immediately."
        : "No muse.ai tab is focused. Settings are saved; reload the Muse tab to see them.";
      tabHint.classList.toggle("warn",!onMuse);
    });
  }catch(_){
    tabUnknown();
  }
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
  setSelect(delaySelect,s.aiClickDelayMs);
  setSelect(autoOffSelect,s.aiAutoOffMinutes);
  badgeVisible.checked=s.aiBadgePosition!=="hidden";
});}

function save(key,value){chrome.storage.local.set({[key]:value},refresh);}

enabled.addEventListener("change",()=>save("hunaarEnabled",enabled.checked));
pub.addEventListener("change",()=>save("hunaarAllowPublicLinks",pub.checked));
delaySelect.addEventListener("change",()=>save("aiClickDelayMs",Number(delaySelect.value)));
autoOffSelect.addEventListener("change",()=>save("aiAutoOffMinutes",Number(autoOffSelect.value)));
badgeVisible.addEventListener("change",()=>save("aiBadgePosition",badgeVisible.checked?"top-right":"hidden"));
resetBadge.addEventListener("click",()=>{chrome.storage.local.set({aiBadgeOffset:null,aiBadgePosition:"top-right"},refresh);});
resetBtn.addEventListener("click",()=>{chrome.storage.local.set({aiClickCount:0,aiLastClick:null,aiClickHistory:[]},refresh);});
chrome.storage.onChanged.addListener((changes,area)=>{ if(area==="local") refresh(); });

refresh();
checkTab();
