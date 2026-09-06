# Night-of one-pager — club label printing

Print this page and tape it near the check-in laptop.

## Before doors open (5 minutes)

1. **Start the server** — double-click **Club Label Printer** on the desktop
   (or the tray app). A green window appears.
2. **Open the check-in page** — it opens automatically; sign in to
   TwoTimTwo if asked. The green **Club Print widget** appears top-right.
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
- **Count looks wrong?** Phone → *Tonight* tab shows exactly who is
  being counted. **Remove** fixes the count here (still undo them on
  TwoTimTwo if they really left); **Add back** reverses a slip.
- **Leader name tag:** three places, all the same list — the check-in
  widget's *Walk-in Guest* row with the **Leader** box ticked (the row
  turns amber and the button reads *Print Leader Tag*), phone →
  **Leader tag** (top right), or the dashboard's *Leader Name Tag*
  card. Never counts as a kid.
- **Leaders you printed before** come back as chips on all three: tap
  **Print** on one, or tick several and press **Print selected** to tag
  a whole team without typing. The **×** forgets a leader (a name typed
  wrong, or someone who has moved on); anyone not printed for a season
  hides itself, and printing them again brings the chip back.

### The TwoTimTwo count check

Under **Tonight** (in the check-in widget, on the dashboard, and on the phone)
there is one line comparing this server's count with TwoTimTwo's own:

- **`✓ Matches TwoTimTwo (101)`** — nothing to do.
- **`⚠ TwoTimTwo 101 · printed 99 — 2 with no label (Sparks −2)`** — two
  children are checked in at the desk but no label came out for them. **This
  is the one to act on**: find them in Sparks and reprint from the Tonight
  list, or print a walk-in label.
- **`⚠ … — 3 extra`** — more labels than TwoTimTwo has check-ins, beyond the
  walk-in guests it already knows are unregistered. Usually someone was
  printed but never checked in at the desk.
- **No line at all** — the check-in page has not reported a number in the last
  five minutes (nobody has that tab open, or the network dropped). Silence is
  never agreement; open the check-in page and it comes back within a minute.

Walk-in guests printed without *Also register in TwoTimTwo* are counted and
subtracted automatically, so they do not raise a false alarm. A shortfall is
never explained away that way.

## If printing stops

1. Is the green server window still open? If not, double-click
   **Club Label Printer** again — queued labels print on reconnect.
2. Printer on, paper in, USB seated? The server retries by itself.
3. Dashboard (`http://localhost:3456`) shows exactly what's wrong —
   *Night Status* + *Print Failures Tonight*.

**The screen never blocks the door.** Worst case: check kids in on
paper, print labels later from the widget's Tonight list.
