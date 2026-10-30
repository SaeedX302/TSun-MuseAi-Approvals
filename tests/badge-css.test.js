"use strict";
/* Regression cover for the badge geometry and its rest states: the position is
   set by inline styles from content.js, so content.css must never pin the badge
   with `!important`. That exact rule made dragging and the popup Reset look
   broken — the badge simply stayed at left:0/top:96px. These tests boot the
   real stylesheet in jsdom, so the cascade is exercised for real. */
const test = require("node:test");
const assert = require("node:assert");
const { bootContent, sleep, closeAll, CONTENT_CSS } = require("./helpers");

test.afterEach(() => closeAll());
test.after(() => closeAll());

const WITH_CSS = { css: CONTENT_CSS };

/* jsdom viewport is 1024x768 and the stubbed badge box is 200x60, so the
   default top-right anchor is x = 1024-200-16 = 808, y = 96. */
function gesture(win, badge, from, to) {
  badge.dispatchEvent(new win.MouseEvent("pointerdown", { clientX: from[0], clientY: from[1], button: 0, bubbles: true }));
  if (to) badge.dispatchEvent(new win.MouseEvent("pointermove", { clientX: to[0], clientY: to[1], bubbles: true }));
  badge.dispatchEvent(new win.MouseEvent("pointerup", { clientX: (to || from)[0], clientY: (to || from)[1], bubbles: true }));
  badge.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
}

test("the stylesheet does not pin the badge, so a drag really moves it", async () => {
  const { win } = await bootContent("", { hunaarEnabled: false }, {}, WITH_CSS);
  await sleep(80);
  const badge = win.document.getElementById("tsun-museai-badge");
  const computed = () => win.getComputedStyle(badge);
  assert.strictEqual(computed().position, "fixed", "the badge stays fixed to the viewport");
  assert.strictEqual(computed().left, "808px", "the anchor wins over the stylesheet fallback");
  assert.strictEqual(computed().top, "96px");
  gesture(win, badge, [200, 200], [400, 320]);
  await sleep(30);
  assert.strictEqual(computed().left, "200px", "the dragged spot is the computed one");
  assert.strictEqual(computed().top, "120px");
});

test("a dragged badge follows the pointer up to the viewport edge", async () => {
  const { win } = await bootContent("", { hunaarEnabled: false }, {}, WITH_CSS);
  await sleep(80);
  const badge = win.document.getElementById("tsun-museai-badge");
  gesture(win, badge, [200, 200], [4000, 4000]);
  await sleep(30);
  assert.strictEqual(win.getComputedStyle(badge).left, "824px");
  assert.strictEqual(win.getComputedStyle(badge).top, "708px");
});

test("Reset from the popup moves a dragged badge back to the default corner", async () => {
  const { win, chrome } = await bootContent("", { hunaarEnabled: false, aiBadgeOffset: { x: 40, y: 40 } }, {}, WITH_CSS);
  await sleep(80);
  const badge = win.document.getElementById("tsun-museai-badge");
  assert.strictEqual(win.getComputedStyle(badge).left, "40px");
  chrome.storage.local.set({ aiBadgeOffset: null, aiBadgePosition: "top-right" });
  await sleep(80);
  assert.strictEqual(win.getComputedStyle(badge).left, "808px", "reset restores the top-right corner");
  assert.strictEqual(win.getComputedStyle(badge).top, "96px");
  assert.strictEqual(badge.style.getPropertyPriority("left"), "important",
    "the inline position is authoritative, whatever the page stylesheets do");
});

test("the resting states are real fades in the stylesheet", async () => {
  const { win } = await bootContent("", { hunaarEnabled: false }, {}, WITH_CSS);
  await sleep(50);
  const badge = win.document.getElementById("tsun-museai-badge");
  const opacity = () => win.getComputedStyle(badge).opacity;
  assert.strictEqual(Number(opacity()), 1, "fully visible when awake");
  badge.classList.add("tsun-idle");
  assert.strictEqual(Number(opacity()), 0.35, "dimmed after the fade");
  badge.classList.add("tsun-ghost");
  assert.strictEqual(Number(opacity()), 0.1, "the ghost stage is fainter still");
  badge.classList.remove("tsun-idle", "tsun-ghost");
  assert.strictEqual(Number(opacity()), 1, "waking the badge restores full opacity");
});

test("dragging the badge does not feed its own mutations back into scans", async () => {
  const { win, timeouts } = await bootContent("", { hunaarEnabled: true, aiClickDelayMs: 0, aiAutoOffMinutes: 0 }, {}, WITH_CSS);
  await sleep(120);
  const badge = win.document.getElementById("tsun-museai-badge");
  const scans = () => timeouts.filter(d => d === 120).length;
  const before = scans();
  badge.dispatchEvent(new win.MouseEvent("pointerdown", { clientX: 200, clientY: 200, button: 0, bubbles: true }));
  for (let i = 1; i <= 10; i++) {
    badge.dispatchEvent(new win.MouseEvent("pointermove", { clientX: 200 + i * 10, clientY: 200 + i * 5, bubbles: true }));
  }
  badge.dispatchEvent(new win.MouseEvent("pointerup", { clientX: 300, clientY: 250, bubbles: true }));
  await sleep(60);
  assert.strictEqual(scans(), before, "the badge's own style writes must not schedule rescans");
});
