(() => {
  // AI with Imran — v9.2 (v9.1 logic + counter/history, click delay,
  // auto-OFF timer, badge position. NO test button, as requested.)
  // Storage keys hunaarEnabled / hunaarAllowPublicLinks are kept so
  // settings survive upgrades. New keys: aiClickCount, aiLastClick,
  // aiClickHistory, aiClickDelayMs, aiAutoOffMinutes, aiBadgePosition.
  if (window.__aiWithImranV92 || window.__aiWithImranV91 || window.__hunaarAssistV9 || window.__hunaarAssistV5) return;
  window.__aiWithImranV92 = true;
  window.__aiWithImranV91 = true;
  window.__hunaarAssistV9 = true;
  window.__hunaarAssistV5 = true;
  let active = false, publicApproval = false, badge = null;
  let clickDelayMs = 1000, autoOffMinutes = 120, badgePosition = "top-right";
  let autoOffTimer = null;
  const attempts = new WeakMap(); // card -> {count, last}
  const pending = new WeakMap(); // card -> {timer}
  const loggedPublic = new WeakSet();
  const log = (...args) => { try { console.log("[AI with Imran:]", ...args); } catch (_) {} };

  const norm = s => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity || 1) > 0;
  }
  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    const a = el.getAttribute && el.getAttribute("aria-disabled");
    return a !== "true";
  }
  function elementLabel(el) {
    return norm(el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.value || el.textContent);
  }
  function allElements(root) {
    const found = [];
    const visit = r => {
      let nodes = [];
      try { nodes = r.querySelectorAll("*"); } catch (_) { return; }
      for (const el of nodes) {
        found.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(root);
    return found;
  }
  function buttonsWithin(el) {
    const list = allElements(el).filter(x => x.matches && x.matches('button,[role="button"],input[type="button"],input[type="submit"]') && isVisible(x) && isEnabled(x));
    list.sort((a, b) => (a.tagName === "BUTTON" ? 0 : 1) - (b.tagName === "BUTTON" ? 0 : 1));
    return list;
  }
  const isAllowLabel = label => /^allow(\s|$)/.test(label); // "allow", "allow once", "allow always..."
  const isDenyLabel = label => /^deny(\s|$)/.test(label);

  function cardType(el) {
    const t = norm(el.innerText || el.textContent);
    if (!t) return null;
    if (t.includes("public link") && (t.includes("upload") || t.includes("create"))) return "public";
    if (t.includes("share") && t.includes("file") && (t.includes("hatch") || t.includes("upload") || /share \d+ files?/.test(t))) return "hatch";
    if (t.includes("hatch") && t.includes("file")) return "hatch";
    if (t.includes("upload") && t.includes("file") && t.includes("allow")) return "hatch";
    return null;
  }
  function cardMatches(el) {
    const type = cardType(el);
    if (!type) return false;
    const labels = buttonsWithin(el).map(elementLabel);
    return labels.some(isAllowLabel);
  }
  function findCard() {
    const els = allElements(document);
    const candidates = els.filter(el => isVisible(el) && cardMatches(el));
    candidates.sort((a, b) => {
      const aDeny = buttonsWithin(a).some(x => isDenyLabel(elementLabel(x))) ? 0 : 1;
      const bDeny = buttonsWithin(b).some(x => isDenyLabel(elementLabel(x))) ? 0 : 1;
      if (aDeny !== bDeny) return aDeny - bDeny;
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return (ar.width * ar.height) - (br.width * br.height);
    });
    if (candidates.length) return candidates[0];
    for (const b of els.filter(el => el.matches && el.matches('button,[role="button"]') && isVisible(el) && isEnabled(el) && isAllowLabel(elementLabel(el)))) {
      let p = b.parentElement;
      for (let i = 0; p && i < 18; i++, p = p.parentElement) if (cardMatches(p)) return p;
    }
    return null;
  }
  function applyBadgePosition() {
    if (!badge) return;
    badge.classList.toggle("awi-bottom", badgePosition === "bottom-right");
    badge.classList.toggle("awi-hidden", badgePosition === "hidden");
  }
  function makeBadge() {
    if (window !== window.top || badge?.isConnected || !document.body) return;
    badge = document.createElement("div");
    badge.id = "ai-with-imran-floating";
    badge.innerHTML = '<span class="awi-mark">AI</span><span class="awi-name">AI with <b>Imran</b></span><span class="awi-state"><span class="awi-dot"></span><span class="awi-state-text">OFF</span></span>';
    badge.title = "AI with Imran — click to toggle";
    badge.addEventListener("click", () => {
      active = !active;
      chrome.storage.local.set({ hunaarEnabled: active }, () => { paintBadge(); scan(); });
    });
    document.body.appendChild(badge);
    paintBadge();
  }
  function paintBadge() {
    if (!badge) return;
    badge.classList.toggle("awi-on", active);
    const s = badge.querySelector(".awi-state-text");
    if (s) s.textContent = active ? "ON" : "OFF";
    badge.title = active ? "AI with Imran ON — click to turn OFF" : "AI with Imran OFF — click to turn ON";
    applyBadgePosition();
  }
  function recordClick(type) {
    chrome.storage.local.get({ aiClickCount: 0, aiClickHistory: [] }, s => {
      const count = (s.aiClickCount || 0) + 1;
      const entry = { t: Date.now(), type: type || "card" };
      const history = [entry].concat(Array.isArray(s.aiClickHistory) ? s.aiClickHistory : []).slice(0, 8);
      chrome.storage.local.set({ aiClickCount: count, aiLastClick: entry.t, aiClickHistory: history });
    });
  }
  function scheduleAutoOff() {
    if (autoOffTimer) { clearTimeout(autoOffTimer); autoOffTimer = null; }
    if (active && autoOffMinutes > 0) {
      autoOffTimer = setTimeout(() => {
        log("auto-OFF timer: turning OFF after " + autoOffMinutes + " min.");
        chrome.storage.local.set({ hunaarEnabled: false });
      }, autoOffMinutes * 60000);
    }
  }
  function scan() {
    if (!active || !document.body) return;
    const card = findCard();
    if (!card) return;
    const type = cardType(card);
    if (type === "public" && !publicApproval) {
      if (!loggedPublic.has(card)) {
        loggedPublic.add(card);
        log("public-link card found, second switch is OFF — waiting for you to enable it in the popup.");
      }
      return;
    }
    const allow = buttonsWithin(card).find(b => isAllowLabel(elementLabel(b)));
    if (!allow) return;
    if (pending.has(card)) return;
    const prev = attempts.get(card) || { count: 0, last: 0 };
    if (prev.count >= 3) return;
    const delay = Math.max(0, clickDelayMs || 0);
    const timer = setTimeout(() => {
      pending.delete(card);
      if (!active || !card.isConnected || !document.body) return;
      const freshType = cardType(card);
      if (freshType === "public" && !publicApproval) return;
      const freshAllow = buttonsWithin(card).find(b => isAllowLabel(elementLabel(b)));
      if (!freshAllow) return;
      const now = Date.now();
      const prev2 = attempts.get(card) || { count: 0, last: 0 };
      if (prev2.count >= 3) return;
      if (now - prev2.last < 1500) return;
      attempts.set(card, { count: prev2.count + 1, last: now });
      log("clicking Allow (" + (freshType || "card") + ", attempt " + (prev2.count + 1) + ") — button:", elementLabel(freshAllow));
      freshAllow.click();
      recordClick(freshType);
    }, delay);
    pending.set(card, { timer });
  }
  function load() {
    chrome.storage.local.get({ hunaarEnabled: false, hunaarAllowPublicLinks: false, aiClickDelayMs: 1000, aiAutoOffMinutes: 120, aiBadgePosition: "top-right" }, s => {
      active = !!s.hunaarEnabled; publicApproval = !!s.hunaarAllowPublicLinks;
      clickDelayMs = Number(s.aiClickDelayMs); if (!Number.isFinite(clickDelayMs) || clickDelayMs < 0) clickDelayMs = 1000;
      autoOffMinutes = Number(s.aiAutoOffMinutes); if (!Number.isFinite(autoOffMinutes) || autoOffMinutes < 0) autoOffMinutes = 120;
      badgePosition = s.aiBadgePosition || "top-right";
      log("settings loaded: main=" + active + ", publicLinks=" + publicApproval + ", delay=" + clickDelayMs + "ms, autoOff=" + autoOffMinutes + "min, badge=" + badgePosition);
      makeBadge(); paintBadge(); scheduleAutoOff(); scan();
    });
  }
  load();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.hunaarEnabled || changes.hunaarAllowPublicLinks || changes.aiClickDelayMs || changes.aiAutoOffMinutes || changes.aiBadgePosition)) load();
  });
  const observer = new MutationObserver(() => { makeBadge(); scan(); });
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-hidden", "class", "style", "role"] });
  }
  setInterval(scan, 500);
})();
