"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const CONTENT_FILE = process.env.AWI_CONTENT ? path.resolve(process.env.AWI_CONTENT) : path.join(ROOT, "content.js");
const CONTENT_SRC = fs.readFileSync(CONTENT_FILE, "utf8");
const POPUP_SRC = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
const POPUP_HTML = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");

const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeChrome(initial, opts) {
  const options = opts || {};
  const store = Object.assign({}, initial);
  const listeners = [];
  const reads = { afterInvalidation: 0, count: 0 };
  const chrome = {
    runtime: { id: "test-extension-id" },
    storage: {
      local: {
        get(defaults, cb) {
          reads.count++;
          if (options.invalidated) { reads.afterInvalidation++; throw new Error("Extension context invalidated."); }
          const out = {};
          if (typeof defaults === "string") out[defaults] = store[defaults];
          else if (Array.isArray(defaults)) defaults.forEach(k => { out[k] = store[k]; });
          else Object.keys(defaults).forEach(k => { out[k] = store[k] === undefined ? defaults[k] : store[k]; });
          cb(out);
        },
        set(values, cb) {
          if (options.invalidated) { reads.afterInvalidation++; throw new Error("Extension context invalidated."); }
          const changes = {};
          for (const k of Object.keys(values)) changes[k] = { oldValue: store[k], newValue: values[k] };
          Object.assign(store, values);
          listeners.forEach(fn => { try { fn(changes, "local"); } catch (e) { console.error(e); } });
          if (cb) cb();
        }
      },
      onChanged: { addListener(fn) { listeners.push(fn); } }
    }
  };
  return { chrome, store, listeners, reads, options };
}

/* jsdom has no layout engine: hand every element a box so isVisible() works.
   `data-box="0"` simulates a zero-sized element. */
function installLayout(win) {
  /* Faithful enough: an element has no box when it, or any ancestor, is
     display:none or visibility:hidden (jsdom does not propagate that itself). */
  win.Element.prototype.getBoundingClientRect = function () {
    let el = this, zero = false;
    while (el && el.nodeType === 1) {
      if (el.getAttribute("data-box") === "0") { zero = true; break; }
      const st = win.getComputedStyle(el);
      if (!st || st.display === "none" || st.visibility === "hidden") { zero = true; break; }
      el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
    }
    const w = zero ? 0 : 200, h = zero ? 0 : 60;
    return { width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} };
  };
}

const openWindows = [];
function closeAll() {
  for (const w of openWindows.splice(0)) { try { w.close(); } catch (_) {} }
}

function makeWindow(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://muse.ai/videos/abc"
  });
  const win = dom.window;
  openWindows.push(win);
  Object.defineProperty(win.document, "hidden", { value: false, configurable: true });
  Object.defineProperty(win.document, "visibilityState", { value: "visible", configurable: true });
  installLayout(win);
  return win;
}

async function bootContent(html, settings, opts) {
  const harness = makeChrome(settings, opts);
  const win = makeWindow(html);
  win.chrome = harness.chrome;
  const timeouts = [];
  const realSetTimeout = win.setTimeout.bind(win);
  win.setTimeout = function (fn, delay, ...rest) { timeouts.push(Number(delay) || 0); return realSetTimeout(fn, delay, ...rest); };
  const wideQueries = [];
  const realQS = win.Document.prototype.querySelectorAll;
  win.Document.prototype.querySelectorAll = function (sel) {
    if (sel === "*") wideQueries.push(sel);
    return realQS.call(this, sel);
  };
  win.eval(CONTENT_SRC);
  return { win, harness, store: harness.store, chrome: harness.chrome, timeouts, wideQueries };
}

function track(win, selector) {
  const el = win.document.querySelector(selector);
  const state = { clicks: 0, el };
  el.addEventListener("click", () => { state.clicks++; });
  return state;
}

module.exports = { ROOT, CONTENT_SRC, POPUP_SRC, POPUP_HTML, sleep, makeChrome, makeWindow, bootContent, track, closeAll };
