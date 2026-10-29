AI WITH IMRAN — MUSE ASSIST v9.4.0

New in v9.4.0 — speed + reliability pass. Koi feature nahi hataya, koi
storage key nahi badli, is liye aap ki ON/OFF choice, delay, auto-OFF
timer, badge position aur history sab waise hi rahenge.

1. Speed (asli bug fix). Purana scan() har 500ms mein poora page do dafa
   sweep karta tha — har element ka innerText aur getComputedStyle parh
   kar — aur MutationObserver har chhoti si DOM harkat par bhi scan
   chalata tha. Ab:
   - scan() sirf buttons dekhta hai (button/[role=button]/input) aur
     "Allow" button se *upar* chal kar us ka card dhoondta hai, kyunke
     card hamesha apne Allow button ka ancestor hota hai.
   - Buttons par pehle sasta text filter (textContent/aria-label/title/
     value) chalta hai, layout parhne wala isVisible() sirf un 1-2
     candidates par chalta hai jinka label waqai Allow/Deny hai.
   - MutationObserver ki bharmaar aik debounced scan (120ms) mein
     collapse ho jati hai.
   - Background tab mein kuch scan nahi hota; tab wapas active hone par
     foran ek scan.
   Naap (tests/perf-bench.js, ~7,500 node ka page, 2 second idle):
     v9.3.1: 4 full-document sweeps, 27,033 getBoundingClientRect,
             171,144 getComputedStyle
     v9.4.0: 0 sweeps, 0 getBoundingClientRect, 0 getComputedStyle
   Yani jab koi card khula hi nahi, tab extension ab bilkul free hai.

2. Shadow DOM wale cards ab bhi chalte hain, magar shadow roots ek dafa
   dhoondhe jate hain (naye nodes ke liye incrementally), har scan par
   poora document dobara nahi chhanta jata. Agar shadow root baad mein
   attach ho to har 5 second par ek retry hota hai.

3. Reload ke baad error khatam. Extension reload karne par purane tab ka
   content script "Extension context invalidated" phenkta tha. Ab har
   chrome.storage call guarded hai: script chup chap ruk jati hai aur
   console mein sirf aik line likhti hai — "reload the Muse tab to
   re-activate."

4. Double-click guard. Do overlapping cards par 700ms ke andar doosra
   click nahi hota (pehle sirf per-card 1.5s guard tha, do alag cards
   dono click ho sakte the).

5. Auto-OFF timer ka bug. Pehle "click delay" ya "badge ki jagah"
   badalne par bhi auto-OFF timer dobara shuru ho jata tha (aap ka 2
   ghanta extend ho jata tha). Ab timer sirf tab reset hota hai jab
   switch ON ho ya duration badli jaye. Page load par timer waise hi
   dobara shuru hota hai (jaisa pehle documented tha).

6. Badge ab keyboard se chalta hai: role="button", tabindex="0",
   aria-pressed, Enter/Space se toggle, aur amber focus ring
   (content.css). Screen reader bhi ON/OFF bata deta hai.

7. Extension icon add kiye (icons/icon16|32|48|128.png). Pehle toolbar
   par default puzzle piece dikhta tha. Icons tools/make-icons.py se
   bante hain (koi image library nahi chahiye) — dobara banane ke liye:
   python3 tools/make-icons.py

8. Popup naya: "Current tab" row batati hai ke active tab muse.ai hai ya
   nahi, aur agar nahi hai to amber hint: "Muse tab refresh karein."
   Iske liye koi naya permission nahi chahiye — host_permissions ki
   wajah se chrome.tabs.query sirf muse.ai tabs ka url deta hai.
   Saath hi: agar storage mein koi aisa value ho jo preset list mein
   nahi (jaise 1500ms), to select blank nahi hota — wo value apni
   option ban kar dikhti hai.

9. manifest.json saaf format (pretty-printed), version 9.4.0, icons ke
   saath. Permissions waise hi: sirf "storage" + muse.ai host access.

Base fix (v9 se v9.3.1 tak) unchanged:
- Matches Hatch cards ("Share 1 file with Hatch") AND public-link
  prompts, accepts "Allow" and "Allow once" buttons.
- Main switch alone auto-allows Hatch file-share cards. The second
  switch is an extra gate ONLY for public-link prompts.
- Retries a card up to 3 times and logs to the console:
  F12 > Console, "[AI with Imran:]".
- Settings storage keys are unchanged (hunaarEnabled,
  hunaarAllowPublicLinks, aiClickDelayMs, aiAutoOffMinutes,
  aiBadgePosition, aiClickCount, aiLastClick, aiClickHistory).

Tests (naye):
- npm install   (sirf jsdom, dev dependency)
- npm test      (16 tests: card matching, public-link gate, hidden/hidden
                 button cases, shadow DOM, double-click guard, retry cap,
                 badge a11y, auto-OFF timer, invalidated context, popup)
- node tests/perf-bench.js   (idle cost naapne ke liye)
Tests tests/helpers.js ke zariye asli content.js/popup.js ko jsdom mein
chalate hain — koi nakli copy nahi.

Install:
1. Open chrome://extensions.
2. Remove/disable older versions (Hunaar AI / v8 / v9 / v9.1 / v9.2 / v9.3).
3. Enable Developer mode > Load unpacked > is folder ko select karein
   (README.md, tests/, tools/, package.json extension load hone mein
   koi rukawat nahi dalte).
4. Refresh the Muse tab (zaroori — purana content script tab tak zinda
   rehta hai).
5. Open the extension popup and turn the MAIN switch ON.
   (Second switch sirf public-link prompts ke liye.)
6. Popup ki "Current tab" row muse.ai dikhani chahiye aur Muse page par
   "AI with Imran" badge ON.

Aage ke liye suggestions (is build mein nahi, aap decide karein):
1. Per-site allowlist ya "sirf is domain par ON" — abhi switch global hai
   aur har muse.ai tab par lagta hai. chrome.storage mein
   {host: bool} map rakh kar findCard ke shuru mein check kiya ja sakta
   hai (~20 lines).
2. Sync settings: chrome.storage.sync use karein taake switch/ delay
   doosre Chrome profiles par bhi chale jayen (local ki jagah, ya
   local+sync mirror). Sirf numbers/booleans store hote hain, quota
   masla nahi.
3. "Test card" button popup mein: aik chhoti demo dialog render kar ke
   verify karein ke detection chal rahi hai. v9.2 mein aap ne ise mana
   kiya tha, is liye abhi nahi add kiya.
4. Selector config: agar Muse apne button ka label badal de ("Grant"),
   to abhi code change chahiye. Popup mein aik chhota "extra button
   labels" field (comma separated) rakh sakte hain — isAllowLabel us
   list ko bhi parh le.
5. Structure: content.js ab ~400 lines hai. Aage barhne se pehle usay
   modules mein tor dein (storage.js / dom.js / cards.js / badge.js) aur
   esbuild ya vite se bundle karein — MV3 content scripts ES modules
   support nahi karte, is liye bundler zaroori hoga.
6. i18n: popup mein Hinglish + English mix hai. _locales/ + chrome.i18n
   se ek proper language switch ho sakta hai.
7. Optional: auto-OFF timer ko chrome.alarms par le jayen. MV3 mein
   background tab ke setTimeout throttle ho sakte hain, is liye lambe
   timer ke liye alarms zyada reliable hain (abhi timer sirf tab ke
   andar chalta hai, tab band = timer band — jo aap ki documented
   behaviour hai).
8. Privacy note README/popup mein: extension koi data bahar nahi
   bhejti, sab kuch chrome.storage.local mein. Web Store review ke liye
   yeh likha hona behtar hai.

Honest limit: this extension can only click cards that are real
elements in the muse.ai page. If a card is drawn by the Muse app outside
the page, or inside a closed shadow DOM / separate origin frame, no page
extension can reach it. If a card still does not auto-click, open
F12 > Console, filter "[AI with Imran:]", and send a screenshot of what
it says plus the exact card wording.

WhatsApp: https://whatsapp.com/channel/0029Vb9VJU6AYlUG9GQWrY2D
Facebook: https://www.facebook.com/profile.php?id=100093358239749

