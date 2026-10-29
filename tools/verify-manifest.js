#!/usr/bin/env node
"use strict";
/* Sanity check for the packaged extension: manifest shape, referenced files,
   PNG icon structure, and popup markup ids used by popup.js.
   Usage: node tools/verify-manifest.js   (or: npm run verify) */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const problems = [];
const ok = [];
let crcTable = null; // lazily built CRC table for PNG chunk validation

function check(cond, message) {
  (cond ? ok : problems).push(message);
}
function isFile(rel) {
  try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch (_) { return false; }
}
function readText(rel, label) {
  if (!isFile(rel)) { problems.push((label || "file") + " is missing: " + rel); return null; }
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let manifest = null;
const manifestText = readText("manifest.json", "manifest");
if (manifestText !== null) {
  try {
    manifest = JSON.parse(manifestText);
    ok.push("manifest.json is valid JSON");
  } catch (e) {
    problems.push("manifest.json is not valid JSON: " + e.message);
  }
  if (manifest !== null && (typeof manifest !== "object" || Array.isArray(manifest))) {
    problems.push("manifest.json must be a JSON object, got " + (Array.isArray(manifest) ? "array" : typeof manifest));
    manifest = null;
  }
}

if (manifest) {
  check(manifest.manifest_version === 3, "manifest_version is 3");
  check(typeof manifest.name === "string" && manifest.name.length > 0, "name present");
  check(/^\d+(\.\d+){0,3}$/.test(manifest.version), "version format valid (" + manifest.version + ")");
  check(!!manifest.description, "description present");
  check(manifest.name === "TSun-MuseAi-Approvals", "name is the TSun branding");
  check(!/AI with Imran/i.test(manifest.name + " " + String((manifest.action || {}).default_title || "")), "manifest carries no old branding");

  const allowedTop = ["manifest_version", "name", "version", "description", "permissions", "host_permissions",
    "icons", "action", "content_scripts", "background", "options_page", "web_accessible_resources",
    "minimum_chrome_version", "author", "homepage_url", "default_locale"];
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
    check(isFile(f), "referenced file is a regular file: " + f);
  }

  const expectedIcons = { 16: "icons/icon16.png", 32: "icons/icon32.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
  for (const [size, rel] of Object.entries(expectedIcons)) {
    if (!isFile(rel)) { problems.push("missing icon: " + rel); continue; }
    const buf = fs.readFileSync(path.join(ROOT, rel));
    const png = readPng(buf);
    check(!!png, "PNG structure valid: " + rel + (png ? "" : " (" + (png === null ? "unreadable" : "") + ")"));
    if (png) {
      check(png.width === Number(size) && png.height === Number(size),
        rel + " is " + png.width + "x" + png.height);
      check(png.colorType === 6 || png.colorType === 2, rel + " has an alpha or truecolour image");
      check(png.hasData, rel + " carries image data");
    }
    check((manifest.icons || {})[size] === rel, "manifest icons[" + size + "] points to " + rel);
  }

  const cs = (manifest.content_scripts || [])[0] || {};
  check((cs.matches || []).includes("https://muse.ai/*"), "content script matches muse.ai");
  check(cs.all_frames === true, "content script runs in all frames");
  check(JSON.stringify(manifest.permissions) === JSON.stringify(["storage"]),
    "permissions still minimal (storage only): " + JSON.stringify(manifest.permissions));
}

function readPng(buf) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return null;
  let offset = 8;
  let header = null;
  const tags = [];
  let sawData = false;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const tag = buf.subarray(offset + 4, offset + 8).toString("latin1");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) return null; // truncated chunk
    const crc = buf.readUInt32BE(dataEnd);
    if (crc !== (zlibCrc32(buf.subarray(offset + 4, dataEnd)) >>> 0)) return null;
    if (tag === "IHDR") {
      if (length !== 13) return null;
      header = {
        width: buf.readUInt32BE(dataStart),
        height: buf.readUInt32BE(dataStart + 4),
        bitDepth: buf[dataStart + 8],
        colorType: buf[dataStart + 9]
      };
    } else if (tag === "IDAT") {
      sawData = sawData || length > 0;
    }
    tags.push(tag);
    offset = dataEnd + 4;
  }
  if (!header || !tags.includes("IEND")) return null;
  return Object.assign({ hasData: sawData }, header);
}

function zlibCrc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ ((c >>> 1) & 0x7fffffff) : (c >>> 1) & 0x7fffffff;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buf) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

const popupHtml = readText("popup.html", "popup.html");
const popupJs = readText("popup.js", "popup.js");
if (popupHtml !== null && popupJs !== null) {
  const htmlIds = new Set([...popupHtml.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const m of popupJs.matchAll(/getElementById\("([^"]+)"\)/g)) {
    check(htmlIds.has(m[1]), "popup.html has #" + m[1] + " used by popup.js");
  }
  /* local assets referenced by the popup markup must exist too */
  for (const m of popupHtml.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    check(isFile(m[1]), "popup asset present: " + m[1]);
  }
}

for (const f of ["content.js", "content.css", "popup.css", "popup.html", "popup.js", "icons/logo.svg"]) {
  check(isFile(f), "file present: " + f);
}

/* The redesign is monochrome on purpose: every colour literal in the two
   stylesheets must be a grey (r == g == b). */
function isMonochrome(css) {
  const bad = [];
  for (const m of css.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = hex.split("").map(c => c + c).join("");
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    if (!(r === g && g === b)) bad.push(m[0]);
  }
  for (const m of css.matchAll(/rgba?\(([^)]+)\)/g)) {
    const parts = m[1].split(",").map(s => parseFloat(s));
    if (!(parts[0] === parts[1] && parts[1] === parts[2])) bad.push(m[0]);
  }
  const hueWords = /\b(?:orange|amber|violet|purple|indigo|red|green|blue|pink|teal|cyan|gold|yellow)\b/i;
  const withoutNames = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (hueWords.test(withoutNames)) bad.push("named colour: " + withoutNames.match(hueWords)[0]);
  return bad;
}
for (const css of ["popup.css", "content.css"]) {
  const text = readText(css, css);
  if (text === null) continue;
  const bad = isMonochrome(text);
  check(bad.length === 0, css + " uses a monochrome palette only" + (bad.length ? " (found " + bad.join(", ") + ")" : ""));
}

const version = manifest ? manifest.version : "";
if (popupHtml !== null) check(popupHtml.includes("v" + version), "popup footer shows v" + version);
const contentSrc = readText("content.js", "content.js");
if (contentSrc !== null) check(contentSrc.includes("v" + version), "content.js header mentions v" + version);
const readme = readText("README.md", "README.md");
if (readme !== null) {
  check(readme.includes("v" + version), "README mentions v" + version);
  check(/## Third party/.test(readme), "README documents third-party components");
  check(/## Design/.test(readme), "README documents the design system");
  check(!/whatsapp|facebook/i.test(readme + (popupHtml || "")), "no WhatsApp/Facebook links left");
  check(!/AI with Imran/.test(readme + (popupHtml || "") + (contentSrc || "") + (popupJs || "")),
    "old 'AI with Imran' branding is gone");
}

console.log(ok.map(l => "  ok   " + l).join("\n"));
if (problems.length) {
  console.error("\n" + problems.map(l => "  FAIL " + l).join("\n"));
  console.error("\n" + problems.length + " problem(s)");
  process.exit(1);
}
console.log("\nAll " + ok.length + " checks passed.");

