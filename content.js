(() => {
  /* TSun-MuseAi-Approvals v11.0.0 — approval helper for muse.ai.
     Legacy storage-key prefixes are kept on purpose so upgrades keep settings. */
  if (window.__tsunMuseAi) return;
  window.__tsunMuseAi = true;

  const BUTTONS = 'button,[role="button"],input[type="button"],input[type="submit"]';
  const DEFAULTS = {
    hunaarEnabled: false,
    hunaarAllowPublicLinks: false,
    aiClickDelayMs: 1000,
    aiAutoOffMinutes: 120,
    aiBadgePosition: "top-right",
    aiBadgeOffset: null
  };
  const MAX_ATTEMPTS = 3;
  const PER_CARD_COOLDOWN_MS = 1500;
  const GLOBAL_COOLDOWN_MS = 700;
  const SCAN_DEBOUNCE_MS = 120;
  const SHADOW_RESCAN_MS = 5000;
  const POLL_MS = 1000;
  const DRAG_THRESHOLD = 4;
  const NUDGE_PX = 8;
  const BADGE_MARGIN = 16;

  let active = false;
  let publicApproval = false;
  let stopped = false;
  let clickDelayMs = 1000;
  let autoOffMinutes = 120;
  let badgeVisible = true;
  let badgeAnchor = "top-right";
  let badgeOffset = null;
  let badgeBox = null;
  let badge = null;
  let drag = null;
  let suppressClick = false;
  let scanTimer = null;
  let pollTimer = null;
  let autoOffTimer = null;
  let autoOffFor = "";
  let observer = null;
  let lastClickAt = 0;
  let lastShadowScanAt = 0;
  let loadedOnce = false;

  const attempts = new WeakMap();
  const pending = new WeakMap();
  const loggedPublic = new WeakSet();
  const shadowHosts = new Set();
  const watchedShadows = new WeakSet();

  const log = (...args) => { try { console.log("[TSun-MuseAi:]", ...args); } catch (_) {} };
  const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : fallback; };

  function contextAlive() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local); }
    catch (_) { return false; }
  }
  function stop() {
    clearTimeout(scanTimer); scanTimer = null;
    clearInterval(pollTimer); pollTimer = null;
    clearTimeout(autoOffTimer); autoOffTimer = null;
    try { if (observer) observer.disconnect(); } catch (_) {}
    if (!stopped) { stopped = true; paintBadge(); }
  }
  function storeGet(defaults, cb) {
    if (!contextAlive()) { log("extension reloaded — reload this tab to reactivate."); stop(); return; }
    try {
      chrome.storage.local.get(defaults, s => {
        if (!contextAlive()) { stop(); return; }
        try { cb(s || {}); } catch (e) { log("settings failed:", e && e.message); }
      });
    } catch (e) { log("storage read failed:", e && e.message); }
  }
  function storeSet(values, cb) {
    if (!contextAlive()) { log("extension reloaded — reload this tab to reactivate."); stop(); return; }
    try {
      chrome.storage.local.set(values, () => {
        if (!contextAlive()) { stop(); return; }
        if (cb) { try { cb(); } catch (e) { log("storage write failed:", e && e.message); } }
      });
    } catch (e) { log("storage write failed:", e && e.message); }
  }

  const norm = s => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const isAllowLabel = label => /^allow(\s|$)/.test(label);
  const isDenyLabel = label => /^deny(\s|$)/.test(label);

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity || 1) > 0;
  }
  function isEnabled(el) {
    if (!el || el.disabled) return false;
    return !(el.getAttribute && el.getAttribute("aria-disabled") === "true");
  }
  function elementLabel(el) {
    return norm(el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.value || el.textContent);
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
    while (n && out.length < 512) {
      const p = n.parentElement || (n.parentNode && n.parentNode.host) || null;
      if (!p) break;
      out.push(p);
      n = p;
    }
    return out;
  }

  /* Shadow roots are discovered once, then incrementally for inserted nodes. */
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
  function observeKnownShadowRoots() {
    if (!observer) return;
    for (const host of shadowHosts) {
      if (watchedShadows.has(host) || !host.isConnected || !host.shadowRoot) continue;
      watchedShadows.add(host);
      try { observer.observe(host.shadowRoot, { childList: true, subtree: true, characterData: true }); } catch (_) {}
    }
  }
  function watchShadowRoots(node) {
    const before = shadowHosts.size;
    collectShadowHosts(node);
    if (shadowHosts.size !== before) observeKnownShadowRoots();
  }
  function deepButtons(root) {
    const out = [];
    const push = r => { try { for (const b of r.querySelectorAll(BUTTONS)) out.push(b); } catch (_) {} };
    push(root);
    for (const host of shadowHosts) {
      if (!host.isConnected || !host.shadowRoot) { shadowHosts.delete(host); continue; }
      if (root !== document && root !== document.documentElement && !containsDeep(root, host)) continue;
      push(host.shadowRoot);
    }
    return out;
  }
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
      if (!labelSources(b).some(l => l.includes("allow") || l.includes("deny"))) continue;
      if (!isVisible(b)) continue;
      out.push({ el: b, label: elementLabel(b) });
    }
    return out;
  }

  function cardType(el) {
    const t = norm(el.innerText || el.textContent);
    if (!t) return null;
    if (t.includes("public link") && (t.includes("upload") || t.includes("create"))) return "public";
    if (t.includes("share") && t.includes("file") && (t.includes("hatch") || t.includes("upload") || /share \d+ files?/.test(t))) return "hatch";
    if (t.includes("hatch") && t.includes("file")) return "hatch";
    if (t.includes("upload") && t.includes("file") && t.includes("allow")) return "hatch";
    return null;
  }

  /* A card is always an ancestor of its Allow button, so walk up from the
     buttons instead of sweeping the document for candidates. */
  function findCard() {
    let buttons = usableButtons(document);
    if (Date.now() - lastShadowScanAt >= SHADOW_RESCAN_MS) {
      lastShadowScanAt = Date.now();
      collectShadowHosts(document);
      buttons = usableButtons(document);
    }
    const allows = buttons.filter(x => isAllowLabel(x.label));
    if (!allows.length) return null;
    const denies = buttons.filter(x => isDenyLabel(x.label)).map(x => x.el);
    const seen = new Set();
    const candidates = [];
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

  function viewport() {
    return {
      w: window.innerWidth || document.documentElement.clientWidth || 1024,
      h: window.innerHeight || document.documentElement.clientHeight || 768
    };
  }
  function badgeSize() {
    if (!badgeBox && badge && badge.getBoundingClientRect) {
      const rect = badge.getBoundingClientRect();
      badgeBox = { w: Math.round(rect.width) || 168, h: Math.round(rect.height) || 32 };
    }
    return badgeBox || { w: 168, h: 32 };
  }
  /* Keeps the badge fully on screen, whatever the drag/resize did. */
  function clampOffset(offset) {
    const { w, h } = viewport(), size = badgeSize();
    const maxX = Math.max(0, w - size.w), maxY = Math.max(0, h - size.h);
    return {
      x: Math.min(Math.max(0, Math.round(Number(offset.x) || 0)), maxX),
      y: Math.min(Math.max(0, Math.round(Number(offset.y) || 0)), maxY)
    };
  }
  function anchorOffset() {
    const { w, h } = viewport(), size = badgeSize();
    const x = w - size.w - BADGE_MARGIN;
    return { x, y: badgeAnchor === "bottom-right" ? h - size.h - BADGE_MARGIN : 96 };
  }
  function applyBadgeLayout() {
    if (!badge) return;
    badge.classList.toggle("tsun-hidden", !badgeVisible);
    if (!badgeVisible) return;
    const pos = clampOffset(badgeOffset || anchorOffset());
    badge.style.left = pos.x + "px";
    badge.style.top = pos.y + "px";
  }
  function paintBadge() {
    if (!badge) return;
    const on = active && !stopped;
    badge.classList.toggle("tsun-on", on);
    badge.classList.toggle("tsun-stopped", stopped);
    badge.setAttribute("aria-pressed", on ? "true" : "false");
    const label = stopped
      ? "TSun MuseAi: stopped — reload this tab to reactivate"
      : on ? "TSun MuseAi: automation ON, click to turn OFF, drag to move"
           : "TSun MuseAi: automation OFF, click to turn ON, drag to move";
    badge.setAttribute("aria-label", label);
    badge.title = label;
    const state = badge.querySelector(".tsun-state-text");
    if (state) state.textContent = stopped ? "RELOAD" : on ? "ON" : "OFF";
    applyBadgeLayout();
  }
  function toggleFromBadge() {
    if (stopped) return;
    active = !active;
    paintBadge();
    storeSet({ hunaarEnabled: active }, () => {
      scheduleAutoOff(false);
      if (active) { lastShadowScanAt = 0; scheduleScan(0); }
    });
  }

  /* Drag anywhere; the position is saved and restored on every Muse page. */
  function onPointerDown(e) {
    if (stopped || (typeof e.button === "number" && e.button > 0)) return;
    suppressClick = false; // a fresh gesture always gets a fresh click
    const rect = badge.getBoundingClientRect();
    drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top, moved: false };
    try { if (badge.setPointerCapture) badge.setPointerCapture(e.pointerId); } catch (_) {}
    badge.classList.add("tsun-dragging");
  }
  function onPointerMove(e) {
    if (!drag) return;
    if (drag.id !== undefined && e.pointerId !== undefined && e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    if (e.cancelable) e.preventDefault();
    badgeOffset = clampOffset({ x: drag.originX + dx, y: drag.originY + dy });
    applyBadgeLayout();
  }
  function onPointerUp() {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    badge.classList.remove("tsun-dragging");
    if (moved) {
      suppressClick = true;
      storeSet({ aiBadgeOffset: badgeOffset });
    }
  }
  function nudge(dx, dy) {
    const current = badgeOffset || clampOffset(anchorOffset());
    badgeOffset = clampOffset({ x: current.x + dx, y: current.y + dy });
    applyBadgeLayout();
    storeSet({ aiBadgeOffset: badgeOffset });
  }
  function onBadgeKeydown(e) {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      if (!stopped) toggleFromBadge();
      return;
    }
    const step = e.shiftKey ? NUDGE_PX * 3 : NUDGE_PX;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (stopped || !moves[e.key]) return;
    e.preventDefault();
    nudge(moves[e.key][0], moves[e.key][1]);
  }
  function makeBadge() {
    if (window !== window.top || (badge && badge.isConnected) || !document.body) return;
    badge = document.createElement("div");
    badge.id = "tsun-museai-badge";
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    badge.setAttribute("aria-pressed", "false");
    badge.innerHTML = '<span class="tsun-mark">TS</span><span class="tsun-name">TSun <b>MuseAi</b></span><span class="tsun-state"><span class="tsun-dot"></span><span class="tsun-state-text">OFF</span></span>';
    badge.addEventListener("pointerdown", onPointerDown);
    badge.addEventListener("click", () => {
      if (suppressClick) { suppressClick = false; return; }
      toggleFromBadge();
    });
    badge.addEventListener("keydown", onBadgeKeydown);
    /* Moves are tracked on the window so a fast drag keeps working even when
       the pointer leaves the badge (pointer capture is best-effort). */
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    document.body.appendChild(badge);
    paintBadge();
  }

  function recordClick(type) {
    storeGet({ aiClickCount: 0, aiClickHistory: [] }, s => {
      const count = (s.aiClickCount || 0) + 1;
      const entry = { t: Date.now(), type: type || "card" };
      const history = [entry].concat(Array.isArray(s.aiClickHistory) ? s.aiClickHistory : []).slice(0, 8);
      storeSet({ aiClickCount: count, aiLastClick: entry.t, aiClickHistory: history });
    });
  }

  function scheduleAutoOff(force) {
    const key = active + "|" + autoOffMinutes;
    if (!force && autoOffFor === key) return;
    clearTimeout(autoOffTimer);
    autoOffTimer = null;
    autoOffFor = key;
    if (!active || !(autoOffMinutes > 0)) return;
    autoOffTimer = setTimeout(() => {
      log("auto-OFF after " + autoOffMinutes + " min.");
      storeSet({ hunaarEnabled: false });
    }, autoOffMinutes * 60000);
  }

  function scheduleScan(delay) {
    if (scanTimer) return;
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
        log("public-link card found, second switch is OFF — enable it in the popup.");
      }
      return;
    }
    const allow = allowButtonIn(card);
    if (!allow || pending.has(card)) return;
    const prev = attempts.get(card) || { count: 0, last: 0 };
    if (prev.count >= MAX_ATTEMPTS) return;
    if (Date.now() - lastClickAt < GLOBAL_COOLDOWN_MS) { scheduleScan(GLOBAL_COOLDOWN_MS); return; }
    const timer = setTimeout(() => {
      pending.delete(card);
      if (!contextAlive()) { stop(); return; }
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
      log("clicking Allow (" + (freshType || "card") + ", attempt " + (prev2.count + 1) + ")", elementLabel(freshAllow));
      freshAllow.click();
      recordClick(freshType);
    }, Math.max(0, clickDelayMs || 0));
    pending.set(card, timer);
  }

  function readOffset(value) {
    if (!value || typeof value !== "object") return null;
    const x = Number(value.x), y = Number(value.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }
  function load() {
    storeGet(DEFAULTS, s => {
      const wasActive = active;
      active = !!s.hunaarEnabled;
      publicApproval = !!s.hunaarAllowPublicLinks;
      clickDelayMs = num(s.aiClickDelayMs, 1000);
      autoOffMinutes = num(s.aiAutoOffMinutes, 120);
      badgeVisible = s.aiBadgePosition !== "hidden";
      badgeAnchor = s.aiBadgePosition === "bottom-right" ? "bottom-right" : "top-right";
      badgeOffset = readOffset(s.aiBadgeOffset);
      log("settings: main=" + active + ", publicLinks=" + publicApproval + ", delay=" + clickDelayMs + "ms, autoOff=" + autoOffMinutes + "min, badge=" + (badgeVisible ? (badgeOffset ? "custom" : badgeAnchor) : "hidden"));
      makeBadge();
      paintBadge();
      scheduleAutoOff(false);
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
      if (changes.hunaarEnabled || changes.hunaarAllowPublicLinks || changes.aiClickDelayMs || changes.aiAutoOffMinutes || changes.aiBadgePosition || changes.aiBadgeOffset) load();
    });
  } catch (e) { log("could not watch settings:", e && e.message); }

  observer = new MutationObserver(records => {
    let relevant = false;
    const mayWalk = active && !document.hidden;
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
    observeKnownShadowRoots();
  } else {
    log("documentElement missing — cannot watch for cards.");
  }

  window.addEventListener("resize", () => {
    badgeBox = null;
    if (badgeVisible) applyBadgeLayout();
  });
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

