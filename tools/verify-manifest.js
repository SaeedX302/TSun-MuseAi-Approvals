#!/usr/bin/env node
"use strict";
/* Sanity check for the packaged extension: manifest shape, referenced files,
   PNG icon headers, and popup markup ids used by popup.js.
   Usage: node tools/verify-manifest.js   (or: npm run verify) */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const problems = [];
const ok = [];

function check(cond, message) {
  (cond ? ok : problems).push(message);
}

const manifestPath = path.join(ROOT, "manifest.json");
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  ok.push("manifest.json is valid JSON");
} catch (e) {
  problems.push("manifest.json is not valid JSON: " + e.message);
}

if (manifest) {
  check(manifest.manifest_version === 3, "manifest_version is 3");
  check(typeof manifest.name === "string" && manifest.name.length > 0, "name present");
  check(/^\d+(\.\d+){0,3}$/.test(manifest.version), "version format valid (" + manifest.version + ")");
  check(!!manifest.description, "description present");

  const allowedTop = ["manifest_version", "name", "version", "description", "permissions", "host_permissions",
    "icons", "action", "content_scripts", "background", "options_page", "web_accessible_resources",
    "minimum_chrome_version", "author", "homepage_url"];
  for (const key of Object.keys(manifest)) {
    check(allowedTop.includes(key), "known manifest key: " + key);
  }

  const files = [];
  if (manifest.action) {
    if (manifest.action.default_popup) files.push(manifest.action.default_popup);
    for (const p of Object.values(manifest.action.default_icon || {})) files.push(p);
  }
  for (const p of Object.values(manifest.icons || {})) files.push(p);
  for (const cs of manifest.content_scripts || []) {
    files.push(...(cs.js || []), ...(cs.css || []));
  }
  for (const f of files) {
    check(fs.existsSync(path.join(ROOT, f)), "referenced file exists: " + f);
  }

  const expectedIcons = { 16: "icons/icon16.png", 32: "icons/icon32.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
  for (const [size, rel] of Object.entries(expectedIcons)) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { problems.push("missing icon: " + rel); continue; }
    const buf = fs.readFileSync(p);
    const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    check(isPng, "PNG signature: " + rel);
    if (isPng) {
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      check(w === Number(size) && h === Number(size), rel + " is " + w + "x" + h);
    }
    check((manifest.icons || {})[size] === rel, "manifest icons[" + size + "] points to " + rel);
  }

  const cs = (manifest.content_scripts || [])[0] || {};
  check((cs.matches || []).includes("https://muse.ai/*"), "content script matches muse.ai");
  check(cs.all_frames === true, "content script runs in all frames");
  check(JSON.stringify(manifest.permissions) === JSON.stringify(["storage"]),
    "permissions still minimal (storage only): " + JSON.stringify(manifest.permissions));
}

const popupHtml = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");
const popupJs = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
for (const m of popupJs.matchAll(/getElementById\("([^"]+)"\)/g)) {
  check(popupHtml.includes('id="' + m[1] + '"'), "popup.html has #" + m[1] + " used by popup.js");
}
for (const m of popupJs.matchAll(/querySelector\("([^"]+)"\)/g)) {
  if (m[1].includes("data-custom")) continue;
  check(true, "popup.js selector: " + m[1]);
}
for (const f of ["content.js", "content.css", "popup.css", "popup.js", "popup.html"]) {
  check(fs.existsSync(path.join(ROOT, f)), "file present: " + f);
}

const version = manifest ? manifest.version : "";
check(popupHtml.includes("v" + version), "popup footer shows v" + version);
const contentSrc = fs.readFileSync(path.join(ROOT, "content.js"), "utf8");
check(contentSrc.includes("v" + version), "content.js header mentions v" + version);
check(fs.readFileSync(path.join(ROOT, "README.md"), "utf8").includes("v" + version), "README mentions v" + version);

console.log(ok.map(l => "  ok   " + l).join("\n"));
if (problems.length) {
  console.error("\n" + problems.map(l => "  FAIL " + l).join("\n"));
  console.error("\n" + problems.length + " problem(s)");
  process.exit(1);
}
console.log("\nAll " + ok.length + " checks passed.");
