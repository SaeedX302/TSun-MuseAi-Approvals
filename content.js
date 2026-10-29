(() => {
  /* AI with Imran — v9.4.0
     Same features as v9.3.1 (Hatch auto-allow, public-link gate, click
     delay, auto-OFF timer, badge position, activity history) rebuilt as a
     performance + reliability pass:

     1. PERF: scan() no longer walks *every* element of the page. It looks
        only at buttons (plus shadow roots discovered once) and walks up
        from the "Allow" button to find its card. The old version did two
        full-document sweeps twice a second, each reading innerText and
        getComputedStyle of thousands of nodes.
     2. PERF: MutationObserver bursts are coalesced into one debounced
        scan instead of one scan per mutation.
     3. PERF: no scanning while the tab is in the background.
     4. ROBUST: every chrome.storage call is guarded, so reloading the
        extension no longer throws "Extension context invalidated" in old
        tabs; the script just stops quietly.
     5. ROBUST: a global 700 ms cooldown prevents double-clicking two
        overlapping cards, and the auto-OFF timer no longer restarts when
        you only change an unrelated setting.
     6. A11Y: the floating badge is a real button (role, tabindex,
        aria-pressed, Enter/Space, focus ring).

     Storage keys are unchanged (hunaarEnabled / hunaarAllowPublicLinks /
     aiClickDelayMs / aiAutoOffMinutes / aiBadgePosition / aiClickCount /
     aiLastClick / aiClickHistory), so settings survive the upgrade. */
  if (window.__aiWithImranV94 || window.__aiWithImranV92 || window.__aiWithImranV91 || window.__hunaarAssistV9 || window.__hunaarAssistV5) return;
  window.__aiWithImranV94 = true;
  window.__aiWithImranV92 = true;
  window.__aiWithImranV91 = true;
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
  const MAX_CARD_DEPTH = 25;

  let active = false, publicApproval = false, badge = null;
  let clickDelayMs = 1000, autoOffMinutes = 120, badgePosition = "top-right";
  let autoOffTimer = null, autoOffForActive = null, autoOffForMinutes = null;
  let scanTimer = null, pollTimer = null, observer = null, lastClickAt = 0;
  let lastShadowScanAt = 0;

  const attempts = new WeakMap(); // card -> {count, last}
  const pending = new WeakMap(); // card -> timer id
  const loggedPublic = new WeakSet();
  const shadowHosts = new Set(); // shadow roots, discovered once + refreshed incrementally
  const watchedShadows = new WeakSet();

  const log = (...args) => { try { console.log("[AI with Imran:]", ...args); } catch (_) {} };
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
  /* Newly found shadow roots get their own observer, so a card rendered inside
     them is noticed immediately instead of waiting for the rescan window. */
  function watchShadowRoots(node) {
    const before = shadowHosts.size;
    collectShadowHosts(node);
    if (shadowHosts.size === before || !observer) return;
    for (const host of shadowHosts) {
      if (watchedShadows.has(host) || !host.shadowRoot) continue;
      watchedShadows.add(host);
      try { observer.observe(host.shadowRoot, { childList: true, subtree: true, characterData: true }); } catch (_) {}
    }
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
  function ancestors(node, max) {
    const out = [];
    let n = node;
    for (let i = 0; i < max; i++) {
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
      if (!labelSources(b).some(l => isAllowLabel(l) || isDenyLabel(l))) continue;
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
    let allows = buttons.filter(x => isAllowLabel(x.label));
    if (!allows.length) {
      /* Nothing in the light DOM: a card may live in a shadow root that was
         attached after we started. Re-discover hosts, but at most every
         SHADOW_RESCAN_MS so idle scanning stays cheap. */
      if (Date.now() - lastShadowScanAt < SHADOW_RESCAN_MS) return null;
      lastShadowScanAt = Date.now();
      collectShadowHosts(document);
      buttons = labelledButtons();
      allows = buttons.filter(x => isAllowLabel(x.label));
      if (!allows.length) return null;
    }
    const denies = buttons.filter(x => isDenyLabel(x.label)).map(x => x.el);
    const seen = new Set(), candidates = [];
    for (const allow of allows) {
      for (const anc of ancestors(allow.el, MAX_CARD_DEPTH)) {
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
    badge.classList.toggle("awi-bottom", badgePosition === "bottom-right");
    badge.classList.toggle("awi-hidden", badgePosition === "hidden");
  }
  function paintBadge() {
    if (!badge) return;
    badge.classList.toggle("awi-on", active);
    badge.setAttribute("aria-pressed", active ? "true" : "false");
    badge.setAttribute("aria-label", active ? "AI with Imran: automation ON, click to turn OFF" : "AI with Imran: automation OFF, click to turn ON");
    const s = badge.querySelector(".awi-state-text");
    if (s) s.textContent = active ? "ON" : "OFF";
    badge.title = active ? "AI with Imran ON — click to turn OFF" : "AI with Imran OFF — click to turn ON";
    applyBadgePosition();
  }
  function toggleFromBadge() {
    active = !active;
    paintBadge();
    storeSet({ hunaarEnabled: active }, () => { scheduleAutoOff(false); if (active) scheduleScan(0); });
  }
  function makeBadge() {
    if (window !== window.top || (badge && badge.isConnected) || !document.body) return;
    badge = document.createElement("div");
    badge.id = "ai-with-imran-floating";
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    badge.setAttribute("aria-pressed", "false");
    badge.innerHTML = '<span class="awi-mark">AI</span><span class="awi-name">AI with <b>Imran</b></span><span class="awi-state"><span class="awi-dot"></span><span class="awi-state-text">OFF</span></span>';
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
      active = !!s.hunaarEnabled;
      publicApproval = !!s.hunaarAllowPublicLinks;
      clickDelayMs = num(s.aiClickDelayMs, 1000);
      autoOffMinutes = num(s.aiAutoOffMinutes, 120);
      badgePosition = BADGE_POSITIONS.includes(s.aiBadgePosition) ? s.aiBadgePosition : "top-right";
      log("settings loaded: main=" + active + ", publicLinks=" + publicApproval + ", delay=" + clickDelayMs + "ms, autoOff=" + autoOffMinutes + "min, badge=" + badgePosition);
      makeBadge();
      paintBadge();
      scheduleAutoOff(false);
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
    for (const r of records) {
      if (r.type === "childList") {
        for (const n of r.addedNodes) {
          if (n.nodeType === 1) { watchShadowRoots(n); relevant = true; }
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
  } else {
    log("documentElement missing — cannot watch the page for cards.");
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden && active) scheduleScan(0); });
  pollTimer = setInterval(() => {
    if (!contextAlive()) { stop(); return; }
    if (active && !document.hidden) scan();
  }, POLL_MS);
})();

