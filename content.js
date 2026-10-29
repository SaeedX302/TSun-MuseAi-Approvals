(() => {
  /* TSun-MuseAi-Approvals — v10.0.0
     Monochrome, minimal approval helper for muse.ai.

     Behaviour is the v9.4.0 behaviour (Hatch auto-allow, public-link gate,
     click delay, auto-OFF timer, badge position, activity history) plus the
     review fixes:

     1. A shadow root attached later to an existing host is rediscovered on a
        timer that runs independently of the light-DOM search.
     2. A delayed click re-checks the extension context first, so reloading
        the extension can never click a stale card.
     3. When the script stops (extension reloaded), the badge repaints to
        RELOAD instead of lying about being ON.
     4. Shadow roots present at startup are observed immediately, and new
        ones only while the tab is active and visible.

     Storage keys are unchanged (hunaarEnabled / hunaarAllowPublicLinks /
     aiClickDelayMs / aiAutoOffMinutes / aiBadgePosition / aiClickCount /
     aiLastClick / aiClickHistory), so existing settings survive the rebrand. */
  /* Legacy guard flags of earlier builds are still checked so a page that
     somehow still runs one of them never gets a second injector. */
  if (window.__tsunMuseAiV10 || window.__aiWithImranV94 || window.__aiWithImranV92 || window.__hunaarAssistV9 || window.__hunaarAssistV5) return;
  window.__tsunMuseAiV10 = true;
  window.__aiWithImranV94 = true;
  window.__aiWithImranV92 = true;
  window.__hunaarAssistV9 = true;
  window.__hunaarAssistV5 = true;

  const BUTTON_SELECTOR = 'button,[role="button"],input[type="button"],input[type="submit"]';
  const DEFAULTS = { hunaarEnabled: false, hunaarAllowPublicLinks: false, aiClickDelayMs: 1000, aiAutoOffMinutes: 120, aiBadgePosition: "top-right" };
  const BADGE_POSITIONS = ["top-right", "bottom-right", "hidden"];
  const MAX_ATTEMPTS = 3;
  const PER_CARD_COOLDOWN_MS = 1500;
  const GLOBAL_COOLDOWN_MS = 700;
  const SCAN_DEBOUNCE_MS = 120;
  const SHADOW_RESCAN_MS = 5000;
  const POLL_MS = 1000;

  let active = false, publicApproval = false, badge = null, stopped = false;
  let clickDelayMs = 1000, autoOffMinutes = 120, badgePosition = "top-right";
  let autoOffTimer = null, autoOffForActive = null, autoOffForMinutes = null;
  let scanTimer = null, pollTimer = null, observer = null, lastClickAt = 0;
  let lastShadowScanAt = 0, loadedOnce = false;

  const attempts = new WeakMap(); // card -> {count, last}
  const pending = new WeakMap(); // card -> timer id
  const loggedPublic = new WeakSet();
  const shadowHosts = new Set(); // shadow roots, discovered once + refreshed incrementally
  const watchedShadows = new WeakSet();

  const log = (...args) => { try { console.log("[TSun-MuseAi:]", ...args); } catch (_) {} };
  const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : fallback; };


  // ---------------------------------------------------------------- context
  function contextAlive() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local); }
    catch (_) { return false; }
  }
  function stop() {
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (autoOffTimer) { clearTimeout(autoOffTimer); autoOffTimer = null; }
    try { if (observer) observer.disconnect(); } catch (_) {}
    if (!stopped) { stopped = true; paintBadge(); } // badge must not keep claiming ON
  }
  function storeGet(defaults, cb) {
    if (!contextAlive()) { log("extension context is invalidated — reload the Muse tab to re-activate."); stop(); return; }
    try {
      chrome.storage.local.get(defaults, s => {
        if (!contextAlive()) { stop(); return; }
        try { cb(s || {}); } catch (e) { log("settings callback failed:", e && e.message); }
      });
    } catch (e) { log("storage read failed:", e && e.message); }
  }
  function storeSet(values, cb) {
    if (!contextAlive()) { log("extension context is invalidated — reload the Muse tab to re-activate."); stop(); return; }
    try {
      chrome.storage.local.set(values, () => {
        if (!contextAlive()) { stop(); return; }
        if (cb) { try { cb(); } catch (e) { log("storage write callback failed:", e && e.message); } }
      });
    } catch (e) { log("storage write failed:", e && e.message); }
  }


  // ------------------------------------------------------------------ dom
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
  const isAllowLabel = label => /^allow(\s|$)/.test(label); // "allow", "allow once", "allow always..."
  const isDenyLabel = label => /^deny(\s|$)/.test(label);

  /* Shadow roots are discovered once (and incrementally for new nodes)
     instead of being re-walked on every scan. */
  function collectShadowHosts(node) {
    if (!node || (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11)) return;
    const root = node.nodeType === 9 ? node.documentElement : node;
    if (!root || typeof root.querySelectorAll !== "function") return;
    const check = el => {
      if (!el || el.nodeType !== 1 || !el.shadowRoot || shadowHosts.has(el)) return;
      shadowHosts.add(el);
      collectShadowHosts(el.shadowRoot);
    };
    check(root);
    let nodes = [];
    try { nodes = root.querySelectorAll("*"); } catch (_) { return; }
    for (const el of nodes) if (el.shadowRoot) check(el);
  }
  /* Observe every shadow root we already know about (called once, right after
     the main observer is attached, and again whenever discovery grows). */
  function observeKnownShadowRoots() {
    if (!observer) return;
    for (const host of shadowHosts) {
      if (watchedShadows.has(host) || !host.isConnected || !host.shadowRoot) continue;
      watchedShadows.add(host);
      try { observer.observe(host.shadowRoot, { childList: true, subtree: true, characterData: true }); } catch (_) {}
    }
  }
  /* Newly found shadow roots get their own observer, so a card rendered inside
     them is noticed immediately instead of waiting for the rescan window. */
  function watchShadowRoots(node) {
    const before = shadowHosts.size;
    collectShadowHosts(node);
    if (shadowHosts.size === before) return;
    observeKnownShadowRoots();
  }
  function containsDeep(el, node) {
    let n = node;
    while (n) {
      if (n === el || (el.contains && el.contains(n))) return true;
      const root = n.getRootNode ? n.getRootNode() : null;
      if (!root || !root.host) return false;
      n = root.host;
    }
    return false;
  }
  function ancestors(node) {
    const out = [];
    let n = node;
    while (n && out.length < 512) { // 512 is a safety net, not a functional cap
      const p = n.parentElement || (n.parentNode && n.parentNode.host) || null;
      if (!p) break;
      out.push(p);
      n = p;
    }
    return out;
  }
  function deepButtons(root) {
    const out = [];
    const push = r => { try { for (const b of r.querySelectorAll(BUTTON_SELECTOR)) out.push(b); } catch (_) {} };
    push(root);
    for (const host of shadowHosts) {
      if (!host.isConnected || !host.shadowRoot) { shadowHosts.delete(host); continue; }
      if (root !== document && root !== document.documentElement && !containsDeep(root, host)) continue;
      push(host.shadowRoot);
    }
    return out;
  }
  /* Cheap text sources of a button. Compared before any visibility check,
     because getBoundingClientRect/getComputedStyle are the expensive part and
     a busy page can hold hundreds of buttons. */
  function labelSources(el) {
    const out = [];
    const add = v => { const n = norm(v); if (n) out.push(n); };
    add(el.textContent);
    add(el.value);
    if (el.getAttribute) { add(el.getAttribute("aria-label")); add(el.getAttribute("title")); }
    return out;
  }
  function usableButtons(root) {
    const out = [];
    for (const b of deepButtons(root)) {
      if (!isEnabled(b)) continue;
      /* coarse substring test first (no layout), exact label test after */
      if (!labelSources(b).some(l => l.includes("allow") || l.includes("deny"))) continue;
      if (!isVisible(b)) continue;
      out.push({ el: b, label: elementLabel(b) });
    }
    return out;
  }

  // ----------------------------------------------------------------- cards
  function cardType(el) {
    const t = norm(el.innerText || el.textContent);
    if (!t) return null;
    if (t.includes("public link") && (t.includes("upload") || t.includes("create"))) return "public";
    if (t.includes("share") && t.includes("file") && (t.includes("hatch") || t.includes("upload") || /share \d+ files?/.test(t))) return "hatch";
    if (t.includes("hatch") && t.includes("file")) return "hatch";
    if (t.includes("upload") && t.includes("file") && t.includes("allow")) return "hatch";
    return null;
  }
  /* A card is always an ancestor of its "Allow" button, so walk *up* from the
     allow buttons instead of sweeping the whole document for candidates. */
  function labelledButtons() {
    return usableButtons(document);
  }
  function findCard() {
    let buttons = labelledButtons();
    /* A shadow root can be attached to an existing host at any time, so the
       rate-limited rediscovery runs regardless of what the light DOM shows. */
    if (Date.now() - lastShadowScanAt >= SHADOW_RESCAN_MS) {
      lastShadowScanAt = Date.now();
      collectShadowHosts(document);
      buttons = labelledButtons();
    }
    const allows = buttons.filter(x => isAllowLabel(x.label));
    if (!allows.length) return null;
    const denies = buttons.filter(x => isDenyLabel(x.label)).map(x => x.el);
    const seen = new Set(), candidates = [];
    for (const allow of allows) {
      for (const anc of ancestors(allow.el)) {
        if (seen.has(anc)) continue;
        seen.add(anc);
        if (!isVisible(anc) || !cardType(anc)) continue;
        candidates.push({ el: anc, deny: denies.some(d => containsDeep(anc, d)) ? 0 : 1 });
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      if (a.deny !== b.deny) return a.deny - b.deny;
      const ar = a.el.getBoundingClientRect(), br = b.el.getBoundingClientRect();
      return (ar.width * ar.height) - (br.width * br.height);
    });
    return candidates[0].el;
  }
  function allowButtonIn(card) {
    const found = usableButtons(card).find(x => isAllowLabel(x.label));
    return found ? found.el : null;
  }

  // ---------------------------------------------------------------- badge
  function applyBadgePosition() {
    if (!badge) return;
    badge.classList.toggle("tsun-bottom", badgePosition === "bottom-right");
    badge.classList.toggle("tsun-hidden", badgePosition === "hidden");
  }
  function paintBadge() {
    if (!badge) return;
    const on = active && !stopped;
    badge.classList.toggle("tsun-on", on);
    badge.classList.toggle("tsun-stopped", stopped);
    badge.setAttribute("aria-pressed", on ? "true" : "false");
    const label = stopped
      ? "TSun MuseAi: stopped — reload this tab to reactivate"
      : on ? "TSun MuseAi: automation ON, click to turn OFF"
           : "TSun MuseAi: automation OFF, click to turn ON";
    badge.setAttribute("aria-label", label);
    badge.title = label;
    const s = badge.querySelector(".tsun-state-text");
    if (s) s.textContent = stopped ? "RELOAD" : on ? "ON" : "OFF";
    applyBadgePosition();
  }
  function toggleFromBadge() {
    if (stopped) return; // nothing can be saved any more; a reload is needed
    active = !active;
    paintBadge();
    storeSet({ hunaarEnabled: active }, () => { scheduleAutoOff(false); if (active) { lastShadowScanAt = 0; scheduleScan(0); } });
  }
  function makeBadge() {
    if (window !== window.top || (badge && badge.isConnected) || !document.body) return;
    badge = document.createElement("div");
    badge.id = "tsun-museai-badge";
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    badge.setAttribute("aria-pressed", "false");
    badge.innerHTML = '<span class="tsun-mark">TS</span><span class="tsun-name">TSun <b>MuseAi</b></span><span class="tsun-state"><span class="tsun-dot"></span><span class="tsun-state-text">OFF</span></span>';
    badge.addEventListener("click", toggleFromBadge);
    badge.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); toggleFromBadge(); }
    });
    document.body.appendChild(badge);
    paintBadge();
  }

  // ------------------------------------------------------------- activity
  function recordClick(type) {
    storeGet({ aiClickCount: 0, aiClickHistory: [] }, s => {
      const count = (s.aiClickCount || 0) + 1;
      const entry = { t: Date.now(), type: type || "card" };
      const history = [entry].concat(Array.isArray(s.aiClickHistory) ? s.aiClickHistory : []).slice(0, 8);
      storeSet({ aiClickCount: count, aiLastClick: entry.t, aiClickHistory: history });
    });
  }

  // ------------------------------------------------------------- auto-OFF
  /* Only reschedules when the switch or the chosen duration actually changed,
     so tweaking "click delay" no longer extends your auto-OFF window. */
  function scheduleAutoOff(force) {
    if (!force && autoOffForActive === active && autoOffForMinutes === autoOffMinutes) return;
    if (autoOffTimer) { clearTimeout(autoOffTimer); autoOffTimer = null; }
    autoOffForActive = active;
    autoOffForMinutes = autoOffMinutes;
    if (!active || !(autoOffMinutes > 0)) return;
    autoOffTimer = setTimeout(() => {
      log("auto-OFF timer: turning OFF after " + autoOffMinutes + " min.");
      storeSet({ hunaarEnabled: false });
    }, autoOffMinutes * 60000);
  }

  // ----------------------------------------------------------------- scan
  function scheduleScan(delay) {
    if (scanTimer) return; // coalesce bursts into one pending scan
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (!contextAlive()) { stop(); return; }
      scan();
    }, typeof delay === "number" ? delay : SCAN_DEBOUNCE_MS);
  }
  function scan() {
    if (!active || !document.body || document.hidden) return;
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
    const allow = allowButtonIn(card);
    if (!allow || pending.has(card)) return;
    const prev = attempts.get(card) || { count: 0, last: 0 };
    if (prev.count >= MAX_ATTEMPTS) return;
    if (Date.now() - lastClickAt < GLOBAL_COOLDOWN_MS) { scheduleScan(GLOBAL_COOLDOWN_MS); return; }
    const delay = Math.max(0, clickDelayMs || 0);
    const timer = setTimeout(() => {
      pending.delete(card);
      if (!contextAlive()) { stop(); return; } // extension was reloaded while waiting
      if (!active || !card.isConnected || !document.body || document.hidden) return;
      const freshType = cardType(card);
      if (freshType === "public" && !publicApproval) return;
      const freshAllow = allowButtonIn(card);
      if (!freshAllow) return;
      const now = Date.now();
      const prev2 = attempts.get(card) || { count: 0, last: 0 };
      if (prev2.count >= MAX_ATTEMPTS) return;
      if (now - prev2.last < PER_CARD_COOLDOWN_MS) return;
      if (now - lastClickAt < GLOBAL_COOLDOWN_MS) return;
      attempts.set(card, { count: prev2.count + 1, last: now });
      lastClickAt = now;
      log("clicking Allow (" + (freshType || "card") + ", attempt " + (prev2.count + 1) + ") — button:", elementLabel(freshAllow));
      freshAllow.click();
      recordClick(freshType);
    }, delay);
    pending.set(card, timer);
  }

  // ----------------------------------------------------------------- init
  function load() {
    storeGet(DEFAULTS, s => {
      const wasActive = active;
      active = !!s.hunaarEnabled;
      publicApproval = !!s.hunaarAllowPublicLinks;
      clickDelayMs = num(s.aiClickDelayMs, 1000);
      autoOffMinutes = num(s.aiAutoOffMinutes, 120);
      badgePosition = BADGE_POSITIONS.includes(s.aiBadgePosition) ? s.aiBadgePosition : "top-right";
      log("settings loaded: main=" + active + ", publicLinks=" + publicApproval + ", delay=" + clickDelayMs + "ms, autoOff=" + autoOffMinutes + "min, badge=" + badgePosition);
      makeBadge();
      paintBadge();
      scheduleAutoOff(false);
      /* Only a real switch-on needs a fresh look; the boot discovery already
         happened, so do not sweep the document again on first load. */
      if (loadedOnce && active && !wasActive) lastShadowScanAt = 0;
      loadedOnce = true;
      if (active) scheduleScan(0);
    });
  }

  collectShadowHosts(document);
  lastShadowScanAt = Date.now();
  load();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.hunaarEnabled || changes.hunaarAllowPublicLinks || changes.aiClickDelayMs || changes.aiAutoOffMinutes || changes.aiBadgePosition) load();
    });
  } catch (e) { log("could not watch settings:", e && e.message); }

  observer = new MutationObserver(records => {
    let relevant = false;
    const mayWalk = active && !document.hidden; // no subtree walks while idle/hidden
    for (const r of records) {
      if (r.type === "childList") {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          relevant = true;
          if (mayWalk) watchShadowRoots(n);
        }
        if (!relevant && r.removedNodes && r.removedNodes.length) relevant = true;
      } else {
        relevant = true;
      }
    }
    if (!relevant) return;
    makeBadge();
    if (active) scheduleScan();
  });
  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["aria-hidden", "class", "style", "role", "disabled", "aria-disabled"]
    });
    observeKnownShadowRoots(); // roots that already existed at document_idle
  } else {
    log("documentElement missing — cannot watch the page for cards.");
  }

  /* Coming back to the tab re-runs the shadow discovery, because roots added
     while we were inactive/hidden were deliberately not walked. */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !active) return;
    lastShadowScanAt = 0;
    scheduleScan(0);
  });
  pollTimer = setInterval(() => {
    if (!contextAlive()) { stop(); return; }
    if (active && !document.hidden) scan();
  }, POLL_MS);
})();

