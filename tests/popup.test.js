"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { POPUP_SRC, POPUP_HTML, closeAll } = require("./helpers");
const { JSDOM } = require("jsdom");

test.afterEach(() => closeAll());
test.after(() => closeAll());

function bootPopup(settings, tab) {
  const html = POPUP_HTML.replace(/<script src="popup.js"><\/script>/, "");
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "chrome-extension://test/popup.html" });
  const win = dom.window;
  const store = Object.assign({}, settings);
  const listeners = [];
  const chrome = {
    runtime: { id: "test-extension-id" },
    tabs: {
      query(opts, cb) { cb([{ id: 7, url: tab.url, active: true, currentWindow: true }]); }
    },
    storage: {
      local: {
        get(defaults, cb) {
          const out = {};
          Object.keys(defaults).forEach(k => { out[k] = store[k] === undefined ? defaults[k] : store[k]; });
          cb(out);
        },
        set(values, cb) {
          const changes = {};
          for (const k of Object.keys(values)) changes[k] = { oldValue: store[k], newValue: values[k] };
          Object.assign(store, values);
          listeners.forEach(fn => fn(changes, "local"));
          if (cb) cb();
        }
      },
      onChanged: { addListener(fn) { listeners.push(fn); } }
    }
  };
  win.chrome = chrome;
  win.eval(POPUP_SRC);
  return { win, store, doc: win.document };
}

test("shows muse.ai when the active tab is a Muse tab", async () => {
  const { doc, win } = bootPopup({ hunaarEnabled: true }, { url: "https://muse.ai/videos/abc" });
  win.dom = doc;
  assert.strictEqual(doc.getElementById("tabStatus").textContent, "muse.ai");
  assert.ok(!doc.getElementById("tabHint").classList.contains("warn"));
  assert.strictEqual(doc.getElementById("stateText").textContent, "Enabled");
  assert.strictEqual(doc.getElementById("statusPillText").textContent, "On");
  assert.ok(doc.body.classList.contains("is-enabled"));
});

test("warns when the active tab is not Muse", async () => {
  const { doc } = bootPopup({ hunaarEnabled: false }, { url: "https://example.com/whatever" });
  assert.strictEqual(doc.getElementById("tabStatus").textContent, "example.com");
  assert.ok(doc.getElementById("tabHint").classList.contains("warn"));
  assert.strictEqual(doc.getElementById("stateText").textContent, "Disabled");
});

test("mirrors the stored settings into the selects and the activity card", async () => {
  const { doc } = bootPopup({
    hunaarEnabled: true, hunaarAllowPublicLinks: true,
    aiClickDelayMs: 2000, aiAutoOffMinutes: 180, aiBadgePosition: "bottom-right",
    aiClickCount: 4, aiLastClick: Date.now(),
    aiClickHistory: [{ t: Date.now(), type: "hatch" }, { t: Date.now() - 1000, type: "public" }]
  }, { url: "https://muse.ai/" });
  assert.strictEqual(doc.getElementById("delaySelect").value, "2000");
  assert.strictEqual(doc.getElementById("autoOffSelect").value, "180");
  assert.strictEqual(doc.getElementById("badgePosSelect").value, "bottom-right");
  assert.strictEqual(doc.getElementById("clickCount").textContent, "4");
  assert.strictEqual(doc.getElementById("mode").textContent, "Auto-click enabled");
  const items = doc.querySelectorAll("#historyList li");
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].textContent.indexOf("Hatch file"), 0);
  assert.ok(items[1].textContent.indexOf("Public link") === 0);
  assert.strictEqual(doc.getElementById("historyEmpty").style.display, "none");
});

test("keeps a non-preset stored value visible instead of blanking the select", async () => {
  const { doc } = bootPopup({ aiClickDelayMs: 1500 }, { url: "https://muse.ai/" });
  const sel = doc.getElementById("delaySelect");
  assert.strictEqual(sel.value, "1500");
  assert.strictEqual(sel.selectedOptions[0].textContent, "1500");
});

test("switches and reset write the same storage keys as before", async () => {
  const { doc, store } = bootPopup({ hunaarEnabled: false }, { url: "https://muse.ai/" });
  const enabled = doc.getElementById("enabled");
  enabled.checked = true;
  enabled.dispatchEvent(new (doc.defaultView.Event)("change", { bubbles: true }));
  assert.strictEqual(store.hunaarEnabled, true);
  const pub = doc.getElementById("publicLinks");
  pub.checked = true;
  pub.dispatchEvent(new (doc.defaultView.Event)("change", { bubbles: true }));
  assert.strictEqual(store.hunaarAllowPublicLinks, true);
  doc.getElementById("resetHistory").dispatchEvent(new (doc.defaultView.Event)("click", { bubbles: true }));
  assert.strictEqual(store.aiClickCount, 0);
  assert.strictEqual(store.aiClickHistory.length, 0);
  assert.strictEqual(store.aiLastClick, null);
});
