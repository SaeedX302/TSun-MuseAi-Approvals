"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { POPUP_SRC, POPUP_HTML, closeAll, sleep } = require("./helpers");
const { JSDOM } = require("jsdom");

test.afterEach(() => closeAll());
test.after(() => closeAll());

/* The tab mock deliberately returns several tabs; it only applies the filters
   the popup actually asked for, so a dropped `active` or `currentWindow`
   filter shows up as the wrong tab winning. */
const TABS = [
  { id: 1, url: "https://example.com/other", active: false, currentWindow: true },
  { id: 2, url: "https://muse.ai/not-focused", active: true, currentWindow: false },
  { id: 3, url: "PLACEHOLDER", active: true, currentWindow: true }
];

function bootPopup(settings, opts) {
  const options = opts || {};
  const html = POPUP_HTML.replace(/<script src="popup.js"><\/script>/, "");
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "chrome-extension://test/popup.html" });
  const win = dom.window;
  const store = Object.assign({}, settings);
  const listeners = [];
  const queryCalls = [];

  const chrome = {
    runtime: { id: "test-extension-id", lastError: options.tabError || undefined },
    tabs: {
      query(query, cb) {
        queryCalls.push(query);
        if (options.tabError) { cb([]); return; }
        const tabs = TABS.map(t => Object.assign({}, t, { url: t.url === "PLACEHOLDER" ? options.tabUrl : t.url }))
          .filter(t => query.active === undefined || t.active === query.active)
          .filter(t => query.currentWindow === undefined || t.currentWindow === query.currentWindow);
        cb(tabs);
      }
    },
    storage: {
      local: {
        get(defaults, cb) {
          const out = {};
          Object.keys(defaults).forEach(k => { out[k] = store[k] === undefined ? defaults[k] : store[k]; });
          setTimeout(() => cb(out), 0);
        },
        set(values, cb) {
          const changes = {};
          for (const k of Object.keys(values)) changes[k] = { oldValue: store[k], newValue: values[k] };
          Object.assign(store, values);
          setTimeout(() => {
            listeners.forEach(fn => fn(changes, "local"));
            if (cb) cb();
          }, 0);
        }
      },
      onChanged: { addListener(fn) { listeners.push(fn); } }
    }
  };
  win.chrome = chrome;
  win.eval(POPUP_SRC);
  const { window } = dom;
  return { win, store, doc: win.document, queryCalls, dom, close: () => window.close() };
}

test("shows muse.ai when the active, current-window tab is a Muse tab", async () => {
  const { doc } = await bootPopup({ hunaarEnabled: true }, { tabUrl: "https://muse.ai/videos/abc" });
  await sleep(50);
  assert.strictEqual(doc.getElementById("tabStatus").textContent, "muse.ai");
  assert.ok(!doc.getElementById("tabHint").classList.contains("warn"));
  assert.strictEqual(doc.getElementById("stateText").textContent, "Enabled");
  assert.strictEqual(doc.getElementById("statusPillText").textContent, "On");
  assert.ok(doc.body.classList.contains("is-enabled"));
});

test("asks for the active tab of the current window", async () => {
  const { queryCalls } = await bootPopup({}, { tabUrl: "https://muse.ai/" });
  await sleep(50);
  assert.strictEqual(queryCalls.length, 1);
  assert.strictEqual(queryCalls[0].active, true);
  assert.strictEqual(queryCalls[0].currentWindow, true);
});

test("warns when the active tab is not Muse", async () => {
  const { doc } = await bootPopup({ hunaarEnabled: false }, { tabUrl: "https://example.com/whatever" });
  await sleep(50);
  assert.strictEqual(doc.getElementById("tabStatus").textContent, "example.com");
  assert.ok(doc.getElementById("tabHint").classList.contains("warn"));
  assert.strictEqual(doc.getElementById("stateText").textContent, "Disabled");
});

test("reports an unknown tab when chrome.tabs.query fails", async () => {
  const { doc } = await bootPopup({}, { tabError: { message: "Tabs cannot be queried right now" } });
  await sleep(50);
  assert.strictEqual(doc.getElementById("tabStatus").textContent, "Unknown");
  assert.ok(doc.getElementById("tabHint").classList.contains("warn"));
});

test("announces the tab result to assistive technology", async () => {
  const { doc } = await bootPopup({}, { tabUrl: "https://muse.ai/" });
  await sleep(50);
  assert.strictEqual(doc.getElementById("tabStatus").getAttribute("role"), "status");
});

test("mirrors the stored settings into the selects and the activity card", async () => {
  const { doc } = await bootPopup({
    hunaarEnabled: true, hunaarAllowPublicLinks: true,
    aiClickDelayMs: 2000, aiAutoOffMinutes: 180, aiBadgePosition: "bottom-right",
    aiClickCount: 4, aiLastClick: Date.now(),
    aiClickHistory: [{ t: Date.now(), type: "hatch" }, { t: Date.now() - 1000, type: "public" }]
  }, { tabUrl: "https://muse.ai/" });
  await sleep(50);
  assert.strictEqual(doc.getElementById("delaySelect").value, "2000");
  assert.strictEqual(doc.getElementById("autoOffSelect").value, "180");
  assert.strictEqual(doc.getElementById("badgeVisible").checked, true);
  assert.strictEqual(doc.getElementById("clickCount").textContent, "4");
  assert.strictEqual(doc.getElementById("mode").textContent, "Auto-click enabled");
  const items = doc.querySelectorAll("#historyList li");
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].textContent.indexOf("Hatch file"), 0);
  assert.ok(items[1].textContent.indexOf("Public link") === 0);
  assert.strictEqual(doc.getElementById("historyEmpty").style.display, "none");
});

test("keeps non-preset stored values visible in the selects", async () => {
  const { doc } = await bootPopup({ aiClickDelayMs: 1500, aiAutoOffMinutes: 90 }, { tabUrl: "https://muse.ai/" });
  await sleep(50);
  for (const [id, value] of [["delaySelect", "1500"], ["autoOffSelect", "90"]]) {
    const sel = doc.getElementById(id);
    assert.strictEqual(sel.value, value, id + " keeps the stored value");
    assert.strictEqual(sel.selectedOptions[0].textContent, value, id + " shows the stored value");
  }
});

test("badge switch hides the badge and reset restores the default spot", async () => {
  const { doc, store } = await bootPopup({ hunaarEnabled: true, aiBadgePosition: "top-right", aiBadgeOffset: { x: 40, y: 40 } },
    { tabUrl: "https://muse.ai/" });
  await sleep(50);
  const badgeVisible = doc.getElementById("badgeVisible");
  assert.strictEqual(badgeVisible.checked, true);
  badgeVisible.checked = false;
  badgeVisible.dispatchEvent(new (doc.defaultView.Event)("change", { bubbles: true }));
  await sleep(40);
  assert.strictEqual(store.aiBadgePosition, "hidden");
  doc.getElementById("resetBadge").dispatchEvent(new (doc.defaultView.Event)("click", { bubbles: true }));
  await sleep(40);
  assert.strictEqual(store.aiBadgeOffset, null, "reset clears the saved position");
  assert.strictEqual(store.aiBadgePosition, "top-right");
});

test("switches and reset write the same storage keys as before", async () => {
  const { doc, store } = await bootPopup({ hunaarEnabled: false }, { tabUrl: "https://muse.ai/" });
  await sleep(50);
  const enabled = doc.getElementById("enabled");
  enabled.checked = true;
  enabled.dispatchEvent(new (doc.defaultView.Event)("change", { bubbles: true }));
  await sleep(30);
  assert.strictEqual(store.hunaarEnabled, true);
  const pub = doc.getElementById("publicLinks");
  pub.checked = true;
  pub.dispatchEvent(new (doc.defaultView.Event)("change", { bubbles: true }));
  await sleep(30);
  assert.strictEqual(store.hunaarAllowPublicLinks, true);
  doc.getElementById("resetHistory").dispatchEvent(new (doc.defaultView.Event)("click", { bubbles: true }));
  await sleep(30);
  assert.strictEqual(store.aiClickCount, 0);
  assert.strictEqual(store.aiClickHistory.length, 0);
  assert.strictEqual(store.aiLastClick, null);
});

