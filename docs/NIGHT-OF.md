# Night-of one-pager — Awana label printing

Print this page and tape it near the check-in laptop.

## Before doors open (5 minutes)

1. **Start the server** — double-click **Awana Labels** on the desktop
   (or the Awana Label Printer tray app). A green window appears.
2. **Open the check-in page** — it opens automatically; sign in to
   TwoTimTwo if asked. The green **Awana widget** appears top-right.
3. **Run the night test** — widget → **Night Test** (or dashboard →
   *Test Night Systems*). You should get:
   - ✅ page selectors
   - ✅ print — a label with a big **TEST** band comes out
   - ✅ pusher — the lobby display is listening
4. **Glance at the dashboard** — `http://localhost:3456` → *Night
   Status* card should be all green.

## During check-in

- Labels print by themselves when kids are checked in — on this
  laptop, on another device, or from a phone.
- **Label didn't print?** Widget → *Tonight* list → **Reprint**.
- **Kid not in the system?** Widget → *Walk-in Guest* → type the name,
  pick a club, **Print**.
- **Red banner across the top?** The website changed under us — check
  kids in normally and use widget search / walk-in printing; labels
  still work.
- **Phone check-in:** volunteers on the club Wi-Fi open
  `http://<this-laptop-ip>:3456/phone`, enter the PIN, tap the kid.
  The check-in and the label happen here automatically.

## If printing stops

1. Is the green server window still open? If not, double-click
   **Awana Labels** again — queued labels print on reconnect.
2. Printer on, paper in, USB seated? The server retries by itself.
3. Dashboard (`http://localhost:3456`) shows exactly what's wrong —
   *Night Status* + *Print Failures Tonight*.

**The screen never blocks the door.** Worst case: check kids in on
paper, print labels later from the widget's Tonight list.
