"use strict";
/* Idle-cost benchmark: how much work does the content script do on a page it
 * is not clicking anything on? Run it against any build:
 *   node tests/perf-bench.js                      # current content.js
 *   AWI_CONTENT=/tmp/content.old.js node tests/perf-bench.js
 */
const path = require("path");
const { bootContent, sleep, closeAll } = require("./helpers");

const BLOCKS = 1500; // roughly a busy video page

function bigPage() {
  let html = '<div id="app">';
  for (let i = 0; i < BLOCKS; i++) {
    html += `<div class="row" data-i="${i}"><span class="title">Video ${i}</span><div class="meta"><a href="#">link</a><button>Options</button></div></div>`;
  }
  return html + "</div>";
}

(async () => {
  const label = process.env.AWI_CONTENT ? path.basename(process.env.AWI_CONTENT) : "content.js";
  const { win } = await bootContent(bigPage(), { hunaarEnabled: true, aiClickDelayMs: 1000, aiAutoOffMinutes: 0 });
  const nodeCount = win.document.querySelectorAll("*").length; // counted before the spy is installed
  const counts = { sweeps: 0, rects: 0, styles: 0 };

  const isDocumentLevel = el => el === win.document || el === win.document.documentElement;
  const realQS = win.Document.prototype.querySelectorAll;
  win.Document.prototype.querySelectorAll = function (sel) {
    if (sel === "*" && isDocumentLevel(this)) counts.sweeps++;
    return realQS.call(this, sel);
  };
  win.Element.prototype.querySelectorAll = function (sel) {
    if (sel === "*" && isDocumentLevel(this)) counts.sweeps++;
    return realQS.call(this, sel);
  };
  const realRect = win.Element.prototype.getBoundingClientRect;
  win.Element.prototype.getBoundingClientRect = function () { counts.rects++; return realRect.call(this); };
  const realStyle = win.getComputedStyle;
  win.getComputedStyle = function (el, ps) { counts.styles++; return realStyle.call(win, el, ps); };

  await sleep(2000);
  console.log(`${label}: page nodes=${nodeCount}, over 2s idle time ->`);
  console.log(`  full-document sweeps : ${counts.sweeps}`);
  console.log(`  getBoundingClientRect: ${counts.rects}`);
  console.log(`  getComputedStyle     : ${counts.styles}`);
  closeAll();
  process.exit(0);
})();
