AI WITH IMRAN — MUSE ASSIST v9.3.1

New in v9.3.1 — links updated: WhatsApp channel replaced with the user's channel link, and YouTube replaced with the Facebook profile link (blue 'f' logo).

New in v9.3 — completely different look from the old green extension:
- Colour: green khatam — ab gehra violet/indigo background, violet
  gradients, aur amber (sunehra) highlights. ON dot, switch glow aur
  "Imran" naam ab amber mein hai.
- Font: Inter/system-ui ki jagah Gill Sans / Trebuchet MS wali
  humanist font family, zyada letter-spacing ke sath.
- Shapes: badge ab gol pill ki jagah rounded-square pill hai, popup
  cards zyada gol (20px) hain, logo square-ish hai.
Logic v9.2 wala hi hai — kuch bhi kaam ke hisab se nahi badla.

New in v9.2 (test button NOT added, as requested):
1. Counter + history — popup mein "Activity" card: kul Allow clicks,
   aakhri Allow ka time, aur aakhri 5 clicks ki list (Hatch file /
   Public link). Reset button se history saaf ho jati hai.
2. Click delay — popup > Settings > "Click delay": Foran / 0.5s / 1s
   (default) / 2s. Card milne ke baad click itni der ruk kar hota hai,
   taake aap card dekh saken. Card delay se pehle gayab ho jaye to
   click nahi hota.
3. Auto-OFF timer — popup > Settings > "Auto-OFF timer": Kabhi nahi /
   30 minute / 1 ghanta / 2 ghante (default) / 3 ghante. Main switch
   ON hone ke baad itni der mein extension khud OFF ho jati hai.
   Timer har page load par dobara shuru hota hai.
4. Badge ki jagah — popup > Settings > "Badge ki jagah": Upar right
   (default) / Neeche right / Chhupao. Chhupane par bhi popup se
   switch ON/OFF hota rehta hai.

Base fix (v9) unchanged:
- Matches Hatch cards ("Share 1 file with Hatch") AND public-link
  prompts, accepts "Allow" and "Allow once" buttons.
- Main switch alone auto-allows Hatch file-share cards. The second
  switch is an extra gate ONLY for public-link prompts.
- Retries a card up to 3 times and logs to the console:
  F12 > Console, "[AI with Imran:]".
- Settings storage keys are unchanged, so your ON/OFF choices survive
  replacing v8/v9/v9.1 with this build. New settings keep their own
  keys (aiClickDelayMs, aiAutoOffMinutes, aiBadgePosition, ...).

Install:
1. Extract this ZIP.
2. Open chrome://extensions.
3. Remove/disable older versions (Hunaar AI / v8 / v9 / v9.1 / v9.2).
4. Enable Developer mode > Load unpacked > select the
   "AI_with_Imran_v9.3_Fixed" folder.
5. Refresh the Muse tab.
6. Open the extension popup and turn the MAIN switch ON.
   (Turn the second switch ON only if you also want public-link
   prompts auto-clicked.)
7. The "AI with Imran" badge on the Muse page should show ON.

Honest limit: this extension can only click cards that are real
elements in the muse.ai page. If a card is drawn by the Muse app
outside the page, or inside a closed shadow DOM / separate origin
frame, no page extension can reach it. If a card still does not
auto-click, open F12 > Console, filter "[AI with Imran:]", and send
a screenshot of what it says plus the exact card wording.

WhatsApp: https://whatsapp.com/channel/0029Vb9VJU6AYlUG9GQWrY2D
Facebook: https://www.facebook.com/profile.php?id=100093358239749
