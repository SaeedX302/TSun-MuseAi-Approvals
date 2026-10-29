# TSun MuseAi Approvals — v10.0.0

Minimal, monochrome approval helper for [muse.ai](https://muse.ai). It clicks
**Allow** on Hatch file-share cards, and — only if you opt in — on public-link
prompts. White surface, black ink, one switch that matters.

This is the rebrand of the earlier Imran-branded build. Storage keys are
untouched, so every existing setting (switch state, click delay, auto-OFF
timer, badge position, activity history) carries over.

## What it does

- **Hatch file-share cards** ("Share 1 file with Hatch") are allowed while the
  main switch is on.
- **Public-link prompts** need the second switch. Without it the card is left
  alone and the reason is logged.
- Accepts `Allow`, `Allow once`, `Allow always…` and friends; never clicks
  `Deny`.
- Retries a card up to three times, with a 1.5 s per-card cooldown and a 700 ms
  global cooldown so two overlapping cards cannot both be clicked.
- Logs everything under `[TSun-MuseAi:]` in the page console
  (F12 → Console).

## Design

- **Badge** on the Muse page: white pill, 1 px black border, black `TS` plate,
  `ON` / `OFF` state. Click it or press <kbd>Enter</kbd>/<kbd>Space</kbd>.
  Position and visibility come from the popup.
- **Popup**: 320 px, black on white, no gradients, no colour accents, no social
  links. Toggles, activity and three selects.
- **Logo / icons**: the `TS` monogram from the TSun mark (geometric T + S on a
  black plate with one sliced corner), as `icons/logo.svg` for the popup and
  `icons/icon{16,32,48,128}.png` for the toolbar. Regenerate the PNGs with
  `npm run icons`.

## Settings

| Key | Meaning | Default |
| --- | --- | --- |
| `hunaarEnabled` | main switch | `false` |
| `hunaarAllowPublicLinks` | second switch, public links only | `false` |
| `aiClickDelayMs` | wait after the card appears (`0`, `500`, `1000`, `2000`) | `1000` |
| `aiAutoOffMinutes` | auto-OFF after (`0` = never, `30`, `60`, `120`, `180`) | `120` |
| `aiBadgePosition` | `top-right`, `bottom-right`, `hidden` | `top-right` |
| `aiClickCount` / `aiLastClick` / `aiClickHistory` | activity card | — |

The key names keep their historical prefixes on purpose: renaming them would
wipe everyone's settings on upgrade.

## Install

1. Open `chrome://extensions`.
2. Remove or disable older builds.
3. Enable **Developer mode** → **Load unpacked** → select this folder
   (`tests/`, `tools/`, `node_modules/` are ignored by Chrome).
4. Refresh the Muse tab (an old content script stays alive until you do).
5. Open the popup and turn the main switch on. The badge should read `ON`.

## Development

```bash
npm ci             # jsdom, test-only (Node 22.22.2+/24.15+; the lockfile is committed)
npm test           # 21 jsdom tests against the real content.js / popup.js
npm run verify     # manifest, files, PNG structure, popup ids, branding
npm run bench      # idle cost of the content script
npm run icons      # regenerate icons/*.png from tools/make-icons.py
```

The test suite covers: Hatch card click + activity recording, main switch off,
public-link gating, hidden-card and no-Allow-button cases, shadow DOM cards,
the no-full-document-sweep performance guard, per-card cooldown and the
three-attempt cap, badge accessibility and toggling, auto-OFF timer stability,
invalidated-context behaviour (including a pending delayed click), and the
popup's tab readout, select mirroring and storage writes.
