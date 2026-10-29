<div align="center">

<img src="icons/logo.svg" width="80" height="80" alt="TSun MuseAi mark">

# TSun MuseAi Approvals

**One switch. One badge. Approvals on muse.ai, handled.**

<sub>`v11.0.0` · Manifest V3 · no runtime dependencies · monochrome by design</sub>

</div>

---

A small Chrome extension for [muse.ai](https://muse.ai). It clicks **Allow** on
Hatch file-share cards — and, only if you ask it to, on public-link prompts.
Nothing else leaves the page.

## What it does

- **Hatch cards** (`Share 1 file with Hatch`) are approved while the main switch is on.
- **Public-link prompts** stay untouched unless the second switch is on. A public link is shareable, so that stays a deliberate choice.
- Matches `Allow`, `Allow once`, `Allow always…`; never clicks `Deny`.
- Three attempts per card, 1.5 s per-card cooldown, 700 ms global cooldown — no double approvals.
- Every action is logged: `F12 → Console`, filter `[TSun-MuseAi:]`.

## The badge

The floating badge is the only UI on the page. It is **draggable anywhere**,
**remembers where you left it** and **cannot be dragged off screen**.

| Action | Result |
| --- | --- |
| Click / `Enter` / `Space` | toggle automation |
| Drag | move the badge; the spot is saved and restored on every Muse page |
| `←` `→` `↑` `↓` (`Shift` = 3×) | nudge by 8 px |
| Popup → Badge `Reset` | back to the default corner |

Position is clamped to the viewport on drag, on load, and on window resize, so
a smaller window or a different screen can never strand it off-canvas. The badge
also reports the truth: `ON`, `OFF`, or `RELOAD` when the extension was updated
under a live tab.

## Design

A deliberately narrow system — black ink on white, nothing else.

- **One ink.** `#111111` on `#ffffff`, greys for hairlines. No accent colour anywhere; `npm run verify` fails the build if a non-grey colour literal appears in either stylesheet.
- **The mark.** A geometric `T` + `S` on a black plate with one corner sliced off, echoing the TSun Studio logo. Vector at `icons/logo.svg`, rasterised for the toolbar.
- **Honest small sizes.** At 16 px the two letters collapse into one bold `T`, because two glyphs become mush at that size.
- **Hairline UI.** 1 px rules and borders, 8–10 px radii, one soft shadow on the badge only. No gradients, no glow, no pulse.
- **Switch geometry.** Pill track, solid ink when on, 16 px knob. State is readable in greyscale.
- **Accessible by default.** The badge is a real button (`role`, `tabindex`, `aria-pressed`, arrow-key nudging, visible focus ring); the popup's tab readout is a `role="status"` live region.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** → this folder (`tests/`, `tools/`, `node_modules/` are ignored by Chrome).
3. Refresh the Muse tab — an old content script survives until you do.
4. Turn the main switch on. The badge appears and reads `ON`.
5. Drag it wherever you like; it will be there next time.

## Settings

| Key | Meaning | Default |
| --- | --- | --- |
| `hunaarEnabled` | main switch | `false` |
| `hunaarAllowPublicLinks` | second switch, public links only | `false` |
| `aiClickDelayMs` | wait after a card appears (`0` / `500` / `1000` / `2000`) | `1000` |
| `aiAutoOffMinutes` | auto-OFF after (`0` = never, `30` / `60` / `120` / `180`) | `120` |
| `aiBadgePosition` | `top-right` / `bottom-right` / `hidden` | `top-right` |
| `aiBadgeOffset` | saved drag position `{x, y}`, clamped to the viewport | `null` |
| `aiClickCount` · `aiLastClick` · `aiClickHistory` | activity card | — |

Keys keep their historical prefixes on purpose: renaming them would wipe
existing settings on upgrade.

## Third party

**Shipped code: none.** `content.js`, `popup.js`, the stylesheets and the icons
contain no third-party library, no CDN asset, no web font and no remote request.
The extension talks to Chrome APIs (`storage`) and nothing else.

Development-only tooling, never packaged:

| Dependency | Why | Licence |
| --- | --- | --- |
| [jsdom](https://github.com/jsdom/jsdom) | runs the real `content.js` / `popup.js` in the test suite | MIT |
| Node `node:test`, `node:assert` | test runner and assertions | part of Node |
| Python `zlib` + `struct` | writes the PNG icons in `tools/make-icons.py` | Python stdlib |
| `gh` CLI | used once to open the pull request | MIT |

The lockfile is committed, so `npm ci` resolves the exact jsdom tree used here
(jsdom 30 requires Node `^22.22.2 || ^24.15.0 || >=26`). The icon generator is
plain Python — no Pillow, no ImageMagick.

## Development

```bash
npm ci        # jsdom, test-only
npm test      # 28 jsdom tests on the real scripts
npm run verify # manifest, files, PNG structure, popup ids, palette, branding
npm run bench # idle cost of the content script
npm run icons # regenerate icons/*.png
```

`npm test` covers card matching and the public-link gate, hidden cards, cards
without an Allow button, shadow-DOM cards (including a root attached late),
the no-document-sweep guard, the cooldown and three-attempt cap, badge
accessibility, drag + remember + viewport clamping, arrow-key nudging, the
auto-OFF timer, invalidated-extension behaviour (including a pending delayed
click), and the popup's tab readout, selects, badge switch and storage writes.

## Privacy

Everything stays in `chrome.storage.local` on your machine. No analytics, no
network calls, no telemetry. Permissions: `storage` plus host access to
`muse.ai` only.

## Limits

It can only click cards that exist as real elements in the page. A card drawn
on a canvas, or living in a closed shadow root or a cross-origin frame, is out
of reach for any page extension. If a card is missed, check the console for
`[TSun-MuseAi:]` and report the exact card wording.

