"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { bootContent, sleep, track, closeAll } = require("./helpers");

test.afterEach(() => closeAll());
test.after(() => closeAll());

const HATCH_CARD = `
  <div class="dialog" id="card">
    <h2>Share 1 file with Hatch</h2>
    <div class="actions">
      <button id="deny">Deny</button>
      <button id="allow">Allow once</button>
    </div>
  </div>`;

const PUBLIC_CARD = `
  <div class="dialog" id="card">
    <h2>Upload and create a public link</h2>
    <div class="actions">
      <button id="deny">Deny</button>
      <button id="allow">Allow</button>
    </div>
  </div>`;

const ON = { hunaarEnabled: true, aiClickDelayMs: 0, aiAutoOffMinutes: 0 };

test("clicks Allow on a Hatch file-share card and records activity", async () => {
  const { win, store } = await bootContent(HATCH_CARD, ON);
  const allow = track(win, "#allow");
  await sleep(150);
  assert.strictEqual(allow.clicks, 1, "Allow should be clicked exactly once");
  assert.strictEqual(store.aiClickCount, 1);
  assert.strictEqual(store.aiClickHistory[0].type, "hatch");
  assert.ok(store.aiLastClick > 0);
});

test("does nothing while the main switch is OFF", async () => {
  const { win, store } = await bootContent(HATCH_CARD, { hunaarEnabled: false, aiClickDelayMs: 0 });
  const allow = track(win, "#allow");
  await sleep(250);
  assert.strictEqual(allow.clicks, 0);
  assert.strictEqual(store.aiClickCount, undefined);
});

test("public-link card waits for the second switch, then clicks", async () => {
  const { win, chrome, store } = await bootContent(PUBLIC_CARD, ON);
  const allow = track(win, "#allow");
  await sleep(250);
  assert.strictEqual(allow.clicks, 0, "public-link card must not be clicked while the gate is off");
  chrome.storage.local.set({ hunaarAllowPublicLinks: true });
  await sleep(250);
  assert.strictEqual(allow.clicks, 1, "public-link card should be clicked once the gate is on");
  assert.strictEqual(store.aiClickHistory[0].type, "public");
});

test("ignores a card that is not visible", async () => {
  const { win } = await bootContent(`<div style="display:none">${HATCH_CARD}</div>`, ON);
  const allow = track(win, "#allow");
  await sleep(250);
  assert.strictEqual(allow.clicks, 0);
});

test("ignores cards without an Allow button", async () => {
  const html = `<div class="dialog"><h2>Share 1 file with Hatch</h2><button id="deny">Deny</button><button id="other">Cancel</button></div>`;
  const { win } = await bootContent(html, ON);
  const other = track(win, "#other");
  await sleep(250);
  assert.strictEqual(other.clicks, 0);
});

test("finds a card rendered inside a shadow root added after load", async () => {
  const { win } = await bootContent(`<div id="app"></div>`, ON);
  await sleep(80); // settings loaded -> automation active -> inserted subtrees are walked
  const host = win.document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = HATCH_CARD;
  win.document.getElementById("app").appendChild(host);
  let clicks = 0;
  shadow.querySelector("#allow").addEventListener("click", () => { clicks++; });
  await sleep(600);
  assert.strictEqual(clicks, 1, "card inside a shadow root should still be allowed");
});

test("shadow rediscovery runs even when a light-DOM Allow button exists", async () => {
  /* A stray "Allow" button used to short-circuit the shadow-root rescan, so a
     root attached later to an existing host was never found. */
  const { win } = await bootContent(`<button id="stray">Allow</button><div id="host"></div>`, {
    hunaarEnabled: true, hunaarAllowPublicLinks: true, aiClickDelayMs: 0, aiAutoOffMinutes: 0
  });
  const stray = track(win, "#stray");
  await sleep(80);
  const host = win.document.getElementById("host");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = PUBLIC_CARD;
  let clicks = 0;
  shadow.querySelector("#allow").addEventListener("click", () => { clicks++; });
  await sleep(6000); // the rescan window is 5s
  assert.ok(clicks >= 1, "late shadow root must be discovered within the rescan window");
  assert.strictEqual(stray.clicks, 0, "the stray Allow button is not part of a card and must not be clicked");
});

test("scan() never sweeps the whole document", async () => {
  const { win, wideQueries } = await bootContent(HATCH_CARD, ON);
  await sleep(150);
  wideQueries.length = 0; // the one-time shadow-root discovery at boot is allowed
  for (let i = 0; i < 40; i++) {
    const d = win.document.createElement("div");
    d.textContent = "video " + i;
    win.document.body.appendChild(d);
  }
  await sleep(1400);
  const documentSweeps = wideQueries.filter(q => q.onDocument);
  assert.deepStrictEqual(documentSweeps, [], "no full-document sweep during scans " +
    "(walks of newly inserted nodes are expected, and the 5s shadow rescan is outside this window)");
});

test("respects the per-card cooldown and stops after three attempts", async () => {
  const { win } = await bootContent(HATCH_CARD, ON);
  const allow = track(win, "#allow");
  await sleep(1200);
  assert.strictEqual(allow.clicks, 1, "second click must wait for the 1.5s cooldown");
  await sleep(4200);
  assert.strictEqual(allow.clicks, 3, "at most three attempts per card");
});

test("badge is a keyboard accessible button and toggles the stored switch", async () => {
  const { win, store } = await bootContent("", { hunaarEnabled: false, aiClickDelayMs: 0 });
  await sleep(150);
  const badge = win.document.getElementById("tsun-museai-badge");
  assert.ok(badge, "badge should be rendered");
  assert.strictEqual(badge.getAttribute("role"), "button");
  assert.strictEqual(badge.getAttribute("tabindex"), "0");
  assert.strictEqual(badge.getAttribute("aria-pressed"), "false");
  assert.strictEqual(badge.getAttribute("aria-label").includes("TSun MuseAi"), true);
  badge.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await sleep(80);
  assert.strictEqual(store.hunaarEnabled, true, "Enter should turn automation ON");
  assert.strictEqual(badge.getAttribute("aria-pressed"), "true");
  assert.ok(badge.classList.contains("tsun-on"));
  assert.strictEqual(badge.querySelector(".tsun-state-text").textContent, "ON");
  badge.dispatchEvent(new win.KeyboardEvent("keydown", { key: " ", bubbles: true }));
  await sleep(80);
  assert.strictEqual(store.hunaarEnabled, false, "Space should turn automation OFF");
  assert.strictEqual(badge.querySelector(".tsun-state-text").textContent, "OFF");
});


test("auto-OFF timer survives unrelated setting changes but follows a new duration", async () => {
  const { chrome, liveTimers, liveLongTimers } = await bootContent("", {
    hunaarEnabled: true, aiAutoOffMinutes: 120, aiClickDelayMs: 1000
  });
  await sleep(80);
  assert.strictEqual(liveLongTimers(), 1, "one auto-OFF timer after boot");
  const before = [...liveTimers.entries()].find(([, d]) => d === 120 * 60000);
  assert.ok(before, "the 2h timer is live");

  chrome.storage.local.set({ aiClickDelayMs: 2000 });
  await sleep(80);
  assert.strictEqual(liveLongTimers(), 1, "changing the click delay must not add a timer");
  assert.ok(liveTimers.has(before[0]), "the original auto-OFF timer is still the live one");

  chrome.storage.local.set({ aiAutoOffMinutes: 30 });
  await sleep(80);
  assert.strictEqual(liveLongTimers(), 1, "rescheduling replaces the old timer instead of adding one");
  assert.ok(!liveTimers.has(before[0]), "the superseded 2h timer was cleared");
  assert.strictEqual([...liveTimers.values()].filter(d => d >= 60000)[0], 30 * 60000, "the new duration is applied");
});

test("stops quietly after the extension is reloaded (invalidated context)", async () => {
  const { win, chrome, harness, wideQueries } = await bootContent("", { hunaarEnabled: true, aiClickDelayMs: 0 });
  const errors = [];
  win.addEventListener("error", e => errors.push(e.message));
  await sleep(80);
  chrome.runtime.id = undefined; // "Extension context invalidated" in a pre-reload tab
  harness.options.invalidated = true;
  wideQueries.length = 0;
  const badge = win.document.getElementById("tsun-museai-badge");
  try { badge.dispatchEvent(new win.MouseEvent("click", { bubbles: true })); }
  catch (e) { errors.push(e.message); }
  await sleep(1500);
  assert.deepStrictEqual(errors, [], "must not raise errors after the extension was reloaded");
  assert.strictEqual(harness.reads.afterInvalidation, 0, "must not touch storage after invalidation");
  assert.strictEqual(badge.querySelector(".tsun-state-text").textContent, "RELOAD", "badge stops claiming ON");
  assert.strictEqual(badge.getAttribute("aria-pressed"), "false");
  assert.strictEqual(harness.store.hunaarEnabled, true, "the click was ignored, not saved");
});

test("a delayed click cannot fire after the extension is reloaded", async () => {
  const { win, chrome, harness, store } = await bootContent(HATCH_CARD, {
    hunaarEnabled: true, aiClickDelayMs: 800, aiAutoOffMinutes: 0
  });
  const allow = track(win, "#allow");
  await sleep(150); // scan has run, the card click is waiting out its delay
  assert.strictEqual(allow.clicks, 0, "the click delay has not elapsed yet");
  chrome.runtime.id = undefined;
  harness.options.invalidated = true;
  await sleep(1200);
  assert.strictEqual(allow.clicks, 0, "a pending click must not land after invalidation");
  assert.strictEqual(harness.reads.afterInvalidation, 0, "no storage traffic after invalidation");
  assert.strictEqual(store.aiClickCount, undefined, "activity was never recorded");
});

