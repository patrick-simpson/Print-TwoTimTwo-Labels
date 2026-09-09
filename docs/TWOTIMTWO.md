# TwoTimTwo integration reference

**The canonical map of how this project talks to TwoTimTwo.com — so nobody
has to re-scrape the site to understand or change the integration.**

Captured 2026-07-26 against a live church tenant (`kvbchurch.twotimtwo.com`,
Yii 1.x + Bootstrap 3 + jQuery). TwoTimTwo is closed-source and has no public
API; everything here was observed from the authenticated site. Treat it as a
contract that can drift — the tests in `scripts/test-server-helpers.cjs` and
the extension's selector self-test exist to catch drift loudly.

> **Privacy:** every field below is a column name, selector, or shape — never
> real data. The live site holds real children's PII (names, allergies,
> guardians, phones, addresses). Never commit captured pages, CSVs, or cookie
> jars. The extension already reduces everything to first-name-only before it
> reaches any display (see the privacy invariant in the display repo).

---

## 1. Authentication

- Login form: `POST /site/login`, form-encoded, fields `LoginForm[username]`
  (email), `LoginForm[password]`, `Login=1`, plus a `YII_CSRF_TOKEN` hidden
  field read from the GET of `/site/login`.
- Session is a cookie (`PHPSESSID`-style). The browser extension relies on the
  volunteer already being logged in — it never handles credentials; it just
  issues same-origin `fetch()`s that ride the existing cookie.
- **Session-health probe:** `GET /clubber/ajaxSearch?text=zz` returns an HTML
  fragment normally, or the literal string `Login Required` when the session
  has expired. Cheap way to detect a dead session before a check-in fails.

---

## 2. The check-in page — `/clubber/checkin`

This is the page the Chrome extension content script runs on. Everything the
automatic-printing pipeline depends on lives here.

### 2.1 Roster DOM (load-bearing selectors)

```html
<div class="clubbers">
  <div class="clubber checkin-box boy"      <!-- or "girl" -->
       recid="662" club_id="2"
       data-photo="" data-hgroup="" data-balance="" data-color="…">
    <div class="name">First Last</div>
    <div class="club"><img class="club-icon-16"
         src="/images/clubs/sparks.png" alt="Sparks " /></div>
    <div class="color">&nbsp;</div>
  </div>
  …one .clubber per NOT-yet-checked-in child…
</div>
```

| Selector / attr | Meaning | Used for |
|---|---|---|
| `.clubber` | one un-checked-in child (the row **disappears** on check-in) | roster diff = the whole remote-detection engine |
| `.clubber .name` | `"First Last"` display name | name + label |
| `.clubber .club img[alt]` | club display name (`"Sparks "`, `"T&T "` — trailing space, `&amp;`) | club label + icon |
| `.clubber[recid]` | **TwoTimTwo's clubber id** | exact identity → CSV `Clubber ID` match + direct check-in API |
| `.clubber[club_id]` | numeric club id (1 Cubbies, 2 Sparks, 3 T&T, 4 Puggles, 6 Trek, 7 Journey) | maps `events[].clubs` applicability |
| `.clubber.boy` / `.clubber.girl` | gender styling | — |

> A checked-in child's row is **removed** from `.clubbers`. That removal is the
> only signal the roster-diff detector gets — hence the miss-threshold and
> mass-disappearance guards in `content.js` (a search filter also removes rows).

### 2.2 Check-in modal & form

Clicking a `.clubber` opens `#checkin-modal` and populates the hidden
`#checkinForm`:

```html
<form id="checkinForm" style="display:none">
  <input id="checkinClubberId" name="clubber_id" value="" />
  <input name="calendar_id" id="calendar_id" value="368" />   <!-- the meeting -->
  <!-- one checkbox per configured check-in item, filtered by club: -->
  <input class="event" name="events[]" value="707" recid="707"
         clubs="2,3,6" />                       <label> Bible</label>
  <input class="event" name="events[]" value="40"  automatic="1"
         clubs="4,1,2,3,6" />                    <label>Attendance</label>
  <input class="event" name="events[]" value="410" clubs="2,3,6" />
                                                 <label>Brought a friend</label>
</form>
<button id="checkin">Checkin</button>   <!-- inside #checkin-modal .modal-footer -->
```

- `events[]` items with `automatic="1"` (Attendance) are auto-checked and their
  row hidden. Items are club-scoped via the `clubs="…"` CSV.
- `#checkin-modal` is `position:fixed` → `offsetParent` is always `null`; test
  visibility with `getComputedStyle(el).display !== 'none'` (the extension does).

### 2.3 Live check-in AJAX (what the page itself calls)

| Method | URL | Body | Returns |
|---|---|---|---|
| POST | `/clubber/checkinclubber` | `clubber_id`, `calendar_id`, `events[]=…` (`$('#checkinForm').serialize()`) | HTML snippet (checked-in name) inserted into `#lastCheckin div` |
| POST | `/clubber/checkinclubberundo` | `calendar_id`, `clubber_id` | HTML snippet, `"(checkin undone)"` |
| GET | `/clubber/ajaxSearch?text=<frag>` | — | HTML `<table>` of `<a href="/clubber/update/{id}">First Last</a>` + club |

- `#lastCheckin` (`<div id="lastCheckin">Last checked in: <div></div></div>`) is
  what the extension's MutationObserver watches for **local** check-ins.
- The extension does **not** call `checkinclubber` directly — it clicks the
  real `.clubber` row and `#checkin` button so TwoTimTwo's own JS runs. The POST
  contract is documented here in case a future version wants a direct path
  (it removes the fragile modal-timing dance — see future idea F-2).

### 2.4 Other tabs on the check-in page

| Tab | URL | Output | Notes |
|---|---|---|---|
| Report | `/clubber/checkin_report?date=YYYY-MM-DD` | HTML: one `<table>` per club, `tfoot tr.totals` Count / Total Shares, per-row `undoCheckin(<id>)` | **Authoritative "who is checked in tonight."** No CSV variant. Markup notes below. |
| Print Form | `/clubber/checkin_form` | printable blank HTML sheet | paper fallback |
| Form Entry | `/clubber/checkin_form_entry?date&club_id` | HTML attendance-checkbox table (POST saves) | key in a paper sheet |
| Import CSV | `/clubber/checkin_csv` (multipart POST `file`) | HTML w/ `.clubber_not_found` / `.multiple_clubbers` | **official external write-path** for check-ins |
| KidCheck | `/clubber/checkin_kidcheck` | HTML | import from KidCheck |
| Checkout | `/clubber/checkout` (POST `calendar_id`,`clubber_id` → `"OK"`) | HTML: one row per child **currently checked in**, with parents / authorized-pickup / security code | pickup security — **and the live "still here" list**, see §2.1 |


### 2.1 `GET /clubber/checkout` — the live "who is still here" list

Structure captured 2026-07-31 from kvbchurch.twotimtwo.com. **Selectors and
attribute names only — no roster data**, same discipline as the `/clubber/csv`
header fixture in `scripts/test-server-helpers.cjs`.

The important realisation: this page is not a checkout *form*, it is a list of
the children **currently checked in**, each with a button to check them out. A
child's row **disappears once they are checked out** — exactly the
disappearing-row behaviour the check-in roster uses, and which
`scanClubberList()` already knows how to diff. So "who is still here" needs no
new departure event: it is simply the set of rows on this page.

Page shape:

- `<title>` ends `- Checkout Clubber`.
- Two tables. The **second** (`table.table`) is the data table; the first
  (`table.items.table`, header `Title`) is an unrelated messages/notices table
  and must be skipped. Do not use `querySelector('table')`.
- Data table headers: `["", "Clubber", "", "Parent/Guardian", "Other"]` — note
  the blank first and third columns, so header count does not equal cell count.
- One row per child, `<tr>` whose cells are:

| cell | selector | carries |
|---|---|---|
| 0 | `a.checkout[clubber_id]` | **the identity hook** — `clubber_id` is TwoTimTwo's own clubber id, the same id `.clubber[recid]` carries on the check-in page. `href="#"`; the click is JS-bound, so the attribute is the only reliable read. |
| 1 | `td.clubber.name` (plus a gender letter class, `M` / `F`) | the child's name |
| 2 | `td.center > img.club-icon-20[alt]` | club name in `alt`, e.g. `"Sparks "` (trailing space) — same alt-based club read the check-in page uses |
| 3–5 | plain `<td>` | guardian / authorized-pickup / security-code columns |

- The name cell's parent row is `.clubber-row`.
- **Club filter checkboxes** `input.filter[name="clubs[N]"]` sit above the table,
  all `checked` by default (so the default view is all clubs). A scraper must not
  assume the page is unfiltered if a volunteer has touched them.
- No `recid` attribute anywhere on this page — `clubber_id` on `a.checkout` is
  the id. There is no `?date=` parameter; the page reflects the current meeting.

Guards a scraper needs, mirroring `fetchCheckinReport()`:

- Skip `table.items` and any `td.empty` placeholder row (present when nobody is
  checked in — the page renders `<span class="empty">`).
- Treat "zero rows" as **unknown**, not "everyone has left", unless the page
  positively parsed (title matched, data table found). An empty parse and an
  empty room are indistinguishable otherwise, and the wrong guess tells a
  volunteer the building is clear when it is not.


Walk-in registration from the check-in page: `GET /clubber/register?default_visitor=Y`
returns the registration form (see §4); a successful POST returns a
`.clubber.checkin-box` row that TwoTimTwo prepends to `.clubbers` and auto-clicks.

---

## 3. Roster export — `GET /clubber/csv`

The single source the print server enriches from (`clubbers.csv`). Session-cookie
auth; `Content-Type: application/csv`; filename `clubbers (YY-MM-DD.HHMM).csv`.
Current-year, active clubbers; household fields **denormalized onto each row**.
Ends with footer lines the parser must stop at:

```
…last data row…
Clubber Count=<n>
                       ← blank
FILTER,VALUE
```

**66 columns, in order** (header line is quoted; there is a trailing empty
column, i.e. a trailing comma; note the literal `?` on two headers and the
truncated `(Te...)` on one — these are verbatim):

```
Clubber ID, Inactive, First Name, Last Name, Gender, Grade, Club, Group, Color,
Handbook Group, Birthdate, Shirt Size, New to Awana?, Has an Awana vest?,
Invited by, Completed Handbooks, Notes, Clubber Created, Clubber Last Updated,
# payments, Med Release?, Share Balance, Book, Doctor Name, Doctor Phone,
Payments total, Rate, Parent/Guardian#1, Parent/Guardian#2, Address1, Address2,
City, State, Zip, Alt Address1, Alt Address2, Alt City, Alt State, Alt Zip,
Primary Phone, Primary Phone Type, Primary Phone SMS (Text)?, Alt Phone,
Alt Phone Type, Alt Phone SMS (Text)?, 3rd Phone, 3rd Phone Type,
3rd Phone SMS (Text)?, Alt Primary Phone, Alt Primary Phone Type,
Alt Primary Phone SMS (Te..., Alt Phone#2, Alt Phone#2 Type,
Alt Phone#2 SMS (Text)?, Alt Phone#3, Alt Phone#3 Type, Alt Phone#3 SMS (Text)?,
Emergency Contact, Others Pickup, Church, Email, Alt Email, GrandPrix Type,
Photo Release?, Leader Notes, <empty>
```

### 3.1 Columns this project actually uses → canonical key

`print-server/server.js` `HEADER_MAP` + `normalizeHeader()` map them (lowercased,
whitespace-collapsed, trailing `?!.:` stripped):

| Export column | Canonical key | Used for |
|---|---|---|
| `Clubber ID` | `ClubberID` | **exact identity match** (with `clubberId` from the DOM) |
| `First Name` / `Last Name` | `FirstName` / `LastName` | name match + label |
| `Club` | `Club` | fallback club when detection path had none |
| `Grade` | `Grade` | Step Up cohort |
| `Handbook Group` / `Group` | `HandbookGroup` / `Group` | table-sorting line on label |
| `Birthdate` | `Birthdate` | birthday-week cake |
| `Notes` | `Notes` | **allergy source** (no dedicated allergy column) |
| `Med Release?` | `MedRelease` | **no-photo camera icon** — an explicit "no" in either release column flags |
| `Photo Release?` | `PhotoRelease` | **no-photo camera icon** — an explicit "no" in either release column flags |
| `Share Balance` | `ShareBalance` | Store-Night shares badge (also see §5) |
| `Leader Notes` | `LeaderNotes` | (reserved) |

### 3.2 Quoting rules the parser must survive
- UTF-8 BOM sometimes present (stripped before parse).
- Fields are `"quoted"`, may contain commas and **newlines** (Notes, Emergency
  Contact) and `""`-escaped quotes → needs a stateful parser, not a line split.
- Club names carry a trailing space and HTML `&amp;` in the DOM (`alt`), but
  the CSV `Club` column is plain (`Sparks`, `T&T`).

### 3.3 Related roster exports
- `GET /clubber/prevyearcsv?year=YYYY|all&exclude_if_this_year=Y` — same 66 cols
  + a `Year` column. (Prior-year returners.) **Drift, 2026-09-08:** every
  `year` value tried (`2016`–`2025`, `all`, with and without
  `exclude_if_this_year`) now returns HTTP 400. Treat as unavailable until
  re-verified; `/report/prevyear_clubbername` and `/clubber/query` (§8) are
  the surviving prior-year lookups.
- `GET /household/csv` — 38 cols, **all** households (not just active); the
  `Active Clubbers` column is a comma-separated `"First Last"` list — a
  household→children map. Header: Household ID, Parent/Guardian#1,
  Parent/Guardian#2, Address1/2, City, State, Zip, (alt addr), Primary Phone(+
  Type + SMS), … Emergency Contact, Others Pickup, Church, Email, Alt Email,
  Active Clubbers, Billing Notes. (Available but unused — this fed the now-
  retired "Also here tonight?" sibling-suggestion feature.)
- `GET /clubber/admin?cview={id}&print=csv` — a **saved custom view** exported as
  CSV (columns per view: e.g. `cview=14` Birthdays = Birthday, First, Last, Club,
  Med?, Grade). A curated, narrower export than the 66-column dump.

---

## 4. Registration / walk-in — `GET|POST /clubber/register?default_visitor=Y`

`#clubber-form`, POST to the same URL. Creates a household + one or more
clubbers. **Required fields** (validated server-side): `Household[name1]`,
`Household[phn1]`, `Clubber[0][first_name]`, `Clubber[0][last_name]`,
`Clubber[0][gender]` (`M`/`F`), `Clubber[0][grade_id]`, `Clubber[0][birthdate]`
(`YYYY-MM-DD`), plus `jscript=yep` and the CSRF token. Notes/allergies go in
`Clubber[0][notes]`; consent radios `Clubber[0][med_release]` = `Y|N|?`.

`grade_id` → club mapping (from the form's select):

| grade_id | Label | Club |
|---|---|---|
| 17 | Age 2 | Puggles |
| 3 / 22 | Preschool (1yr / 2yr before K) | Cubbies |
| 4 / 5 / 6 | K / Gr 1 / Gr 2 | Sparks |
| 7 / 8 / 9 | Gr 3 / 4 / 5 | T&T |
| 18 / 19 / 20 | Gr 6 / 7 / 8 | Trek |
| 21 / 23 | Gr 9 / 10 | Journey |

`enter_ovr_club_id`: 4 Puggles, 1 Cubbies, 2 Sparks, 3 T&T, 6 Trek, 7 Journey.

---


### `/clubber/checkin_report` — the markup, exactly

Verified against the live report. Each detail here has already cost a bug, so
change a selector only against a real page:

- **One `<table>` per club.** The club is named ONLY by its crest's `alt`
  text — `<th colspan=4 class="title"><img alt="Sparks "></th>` — and that
  crest sits in **its own `<thead><tr>`, ahead of the column-header row**.
  So `querySelector('thead tr')` returns the crest row, not the headers. That
  is why `friendsBrought` read 0 all season: the "Brought a friend" column was
  being looked for in the crest row. Search *every* header row.
- Alt text carries trailing spaces (`"Cubbies "`) and `&`
  (`T&T`, which is `T&amp;T` in the source but decoded by the DOM). Fold club
  names through `clubKey()` rather than comparing them raw.
- The totals row is **single-quoted**: `<tfoot><tr class='totals'><td><i>Count:
  14</i></td>…`. A CSS selector (`tfoot tr.totals`) is quote-agnostic; a
  regex over the raw HTML is not.
- **Every row opens a fresh unclosed `<tbody>`.** They parse as siblings, so
  `querySelectorAll('tbody tr')` still sees them all — but do not assume one
  tbody per table.
- Each row carries **two** controls for the same child: an edit link
  `/meeting/clubberCheckin/{id}` and `onclick='undoCheckin({id})'`. Dedupe by
  id when counting rows, or every child counts twice.
- The page opens with a decorative table that has no crest. Skip any table
  without one rather than folding it into a total.
- `?clubs[N]=1` filters to specific clubs; **omitting the params returns every
  club**, so the plain `?date=` URL is already the whole night.

`/report/attendance_summary?output=csv` is the aggregate cross-check —
`"Meeting","Puggles","","Cubbies",…,"TOTAL",""` with one row per meeting,
newest first. **The newest row is the NEXT, unheld meeting** (all blank, TOTAL
`0`), so "the most recent row" is the newest row dated on or before today, not
row one. Its totals agree with the check-in report's per-club `Count:` values.


## 5. Reports — the CSV feed suite

Almost every report renders CSV with `&output=csv` (session-cookie auth,
`application/csv`). These are the machine feeds for future features.

| URL | Params | Row shape |
|---|---|---|
| `/report/shekelBalance` | `club_id=1..7`, `output=csv`, `hide_zero` | `"Name","Balance"` (one CSV per club — already used on Store Night) |
| `/meeting/report` | `calendar_id`, `year_start`, `output=csv` | **"who earned what tonight"** — per-clubber items/awards |
| `/report/checkinItems` | `club_id`, `output=csv` | dynamic columns per configured check-in item |
| `/report/attendance_grid` | `club_id`, `year_start`, `from`, `to`, `output=csv` | one date column per meeting |
| `/report/attendance_summary` | `year_start`, `output=csv` | per-meeting counts per club |
| `/report/clubcounts` | `year_start`, `output=csv` | club headcounts |
| `/report/completed_books`, `/report/bookProgress`, `/report/quarter_points`, `/report/distributedAwards`, `/payment/unpaid`, `/payment/report` | `output=csv` (+ filters) | as named |

Awards / meeting flow (HTML, mutating POSTs **not** used by this project):
`/meeting/record` (record handbook activity), `/meeting/awards` (distribute),
`/meeting/Awards_undistributed` (PDF worksheets), `/meeting/colorGroup`
(points→shares), `/meeting/handbook` (PDF agenda), `/meeting/shekels`.

---

## 6. Calendar & meetings

- `GET /calendar/index` — HTML month grid; each meeting has a
  `data-source="/calendar/details/{calendar_id}"`. `calendar_id` is what the
  check-in form's hidden `calendar_id` points at (e.g. `368` = the current
  meeting). Meetings can be marked "No Awana this week".
- `GET /calendar/details/{id}` — HTML fragment: `#Checkins`, `#Clubber Events`.
- `GET /calendar/iCal` — **`text/calendar` subscription feed** of all meetings.
  Candidate source for the signage "next meeting / tonight's theme" banner.
- `GET /calendar/ajaxCheckinSample?club_id&date` — sample check-in form.
- `/msg/admin` — announcement / cancellation messages (could drive a
  "CLUB CANCELLED TONIGHT" display alert).

---

## 7. What this project touches today (surface area to protect)

**Chrome extension (`chrome-extension/content.js`), same-origin on twotimtwo.com:**
- Reads `.clubber` / `.name` / `.club img` / `recid` / `club_id` (roster diff,
  labels, identity).
- Watches `#lastCheckin` (local check-in detection).
- Clicks `.clubber` + `#checkin` (driven check-in for phone / quick mode).
- `GET /clubber/csv` → POSTs to the local print server `/update-csv`.
- `GET /report/shekelBalance?club_id=N&output=csv` (Store Night).
- Scans page text for "step up" / "store" (night-mode auto-detect).

**Print server (`print-server/server.js`), from the CSV only** — never talks to
TwoTimTwo directly; enriches labels from the synced `clubbers.csv`.

Everything else in this doc is **available but unused** — see the capabilities
page (`/capabilities.html`) for the ranked backlog of what to build next.

---

## 8. Additional pages observed 2026-09-08 (read-only inventory)

A GET-only walk of ~140 URLs on the same tenant, logged in as the operator.
Same discipline as the rest of this document: page paths, form field names,
table headers and CSV header rows only — never data. Nothing here has been
built against yet; it exists so the ideas page's feasibility badges rest on
something observed rather than assumed.

### 8.1 The report catalogue

The Reports page exposes every report through one `current_report` select:
Current Counts, Payments, Share Balances, Attendance Summary, Unpaid
Attendance, Missed Attendance, Attendance Grid, Quarterly Attendance (Blue
Jewel), Quarterly Points or Shares, Checkin Items Summary, Book Progress, Book
Progress Details, Completed Sections, Completed Books (by range), Completed
Books (history), Meeting Reports, Distributed Awards, Compare Prev Year by
Clubber Name, Clubbers without Book History, Clubbers History, Registration
Info.

CSV header rows seen with `&output=csv` (session cookie, `application/csv`),
extending the §5 table:

| URL | Params | CSV header |
|---|---|---|
| `/report/checkinItems` | `club_id` | `"Clubber","Attendance","Brought a friend","Bible"` — columns are that club's configured check-in items |
| `/report/attendance_summary` | `year_start` | `"Meeting","Puggles","","Cubbies","","Sparks","","T&T","","Trek","","Journey","","TOTAL",""` |
| `/report/clubcounts` | `year_start` | `"Club","#Registered","Capacity"` |
| `/report/attendance_grid` | `club_id, year_start, from, to` | `"Club","Clubber","Sep02","Sep09","#","%"` — one column per meeting date. **Parsed since v6.10.0** (the attendance audit). The date column labels carry no year, so the year comes from the Aug-1 Awana season boundary. The per-cell encoding for present/absent was never observed, so the parser classifies cells and then cross-checks its own count against the `#` column for every row — one disagreement and the whole club is discarded as unreadable. The `from`/`to` value formats are still unverified; the parser retries without them. |
| `/meeting/report` (alias `/report/meeting`) | `year_start, calendar_id, club_id, info, sort` | `"HBGroup","Clubber","Book","Unit","Award","Note"` |
| `/report/completed_books` | `club_id, year_start, from_date, to_date` | `"Name","Book","Date"` — **parsed since v6.9.0** (the trophy band). The accepted `from_date`/`to_date` formats and whether `Name` is "First Last" or "Last, First" are both still unverified, so neither is trusted: the print server's own 14-day window filters, and the name key swaps around a comma so either ordering matches. |
| `/report/completed_books_history` | `club_id` | `"Name","Book","Date"` |
| `/report/bookProgress` | `club_id` | `"Name","Track","Current Book","Progress","HB Group"` |
| `/report/quarter_points` | `club_id, what, year_start, from, to, level` | `"Clubber","TOTAL","Sections","Checkin","Special"` |
| `/report/quarter_attendance` (Blue Jewel) | `club_id, year_start, from, to, minimum, cal_event_id` | `"Handbook Group","Name","#Meetings"` |
| `/report/missed_attendance` | `club_id, calendar_id, include_contact` | `"Handbook Group","Name","Last Meeting"` — `include_contact` adds guardian contact columns (PII; operator-only) |
| `/report/clubberWithoutHistory` | `club_id` | `"First Name","Last Name","Grade","Possible previous year match"` |
| `/report/prevyear_clubbername` | `club_id` | header row is mostly blank cells plus `"Previous Year(s)"`; awkward to parse |
| `/payment/unpaid` | `club_id, minimum` | `"Name","#Meetings"` |
| `/clubber/admin?cview=14&print=csv` | — | `Birthday,First,Last,Club,Med?,Grade` (saved view "Birthdays"). Other saved views on this tenant: Contact Info, Game Groupings, Meeting Info, Special Notes (ids not probed) |

Not CSV despite `output=csv`: `/report/registration` returns
`application/pdf`; `/report/bookProgressDetail` returns HTML (about 790 KB);
`/report/completed_steps` returned an empty body without a date range.

### 8.2 Check-in page details not covered above

- Filter form on `/clubber/checkin`: `date` (select of meeting dates), `sort`
  (First Name / Last Name), `clubs[4]`,`[1]`,`[2]`,`[3]`,`[6]`,`[7]`
  checkboxes, and **`selected_color`** (All / Blue / Green / Red / Yellow).
  The color teams behind the CSV `Color` column are a first-class filter.
- `/clubber/checkin_form` (printable blank sheet) takes POST `tab, sort,
  bygroup` (Group by Club / Group by Handbook Group / All selected clubs),
  `orientation` (Portrait / Landscape), `clubs[]`.
- `/clubber/checkin_csv`: POST `tab, date, file` (the official bulk import;
  not exercised).
- `/clubber/labels` returns **`application/pdf`** — TwoTimTwo's own built-in
  label sheet. Its layout knobs live on `/setting?tab=Labels`: `# labels
  across`, `# labels down`, `Expanded format?`, `Font size for name`, `Font
  size for other info`, `Label Height`, `Label Width`, `Origin X`, `Origin Y`.
- `/clubber/assignment?club_id=N` — club roster assignment (structure only).
- `/clubber/query` — table `First Name | Last Name | Year Start | Birthdate |
  Clubber#` (multi-year clubber lookup).

### 8.3 Site-wide pages

- `/setting` — tenant settings with a "Find Setting" search. Examples:
  Current Year Description (`2026 - 2027`), Date format (`M/D/Y`),
  Accumulated award levels, Cumulative completed books awards, Disable
  Public Registration, Display meeting assigned sections on public calendar.
  A read-only source for season/year detection.
- `/msg/admin` — `Start Date | Message | End Date` plus a **Create** button:
  the announcement table (the natural source for a `notice` broadcast).
  Reading is a GET; creating is a POST that was not exercised.
- `/text/admin` — `What | Text`: custom front-page / registration-page text.
- `/calendar/iCal` — `text/calendar`; 33 `VEVENT`s this season, each
  `UID:<yyyymmdd>.<calendar_id>`, `DTSTART`/`DTEND` in UTC (this tenant:
  21:00Z–22:30Z), `SUMMARY:Awana meeting`. The `UID` embeds the same
  `calendar_id` the check-in form posts. `/calendar/iCalInfo` is its help page.
- `/calendar/index` also hosts the **Checkin Items** editor (fields `desc,
  checkin, id, calendar_id, calendar_date, clubs[], type` (Checkbox /
  Quantity / Text), `shekels, points, automatic, inactive`) and
  `addManualDate` / `addDateRange` actions: meeting dates and check-in items
  are per-tenant configuration.
- `/meeting/handbook` — Generate Handbook Agenda: `cal_id, club_id,
  checked_in, print_balances` (PDF agenda for tonight's checked-in kids).
- `/meeting/groups` — Select Club, then game / handbook groupings.
- `/bookTrack/admin` — `Description | Used by Club(s) | Properties` (for
  example the Journey club's "Journey: Advocates" track).
- `/blueJewel/admin` — `Period Start | Period End | Min # Attendance in
  Period | #Mtgs in Period | Award` per club; buttons Add / Re-apply /
  Switch to every 5 meetings. Attendance-award periods are data.
- `/grade/admin` — `Desc | Club | Handbook Group | Auto-assign Book | Age
  Min | Age Max | Clubber Count`. The clubber form's grade select runs Age 2
  (Puggles); Preschool 1 yr / 2 yrs before K (Cubbies); K, Gr 1, Gr 2
  (Sparks); Gr 3–5 (T&T); Gr 6–8 (Trek); Gr 9–12 (Journey).
- `/profile/admin` — staff roster `Name | Email | Roles | Inactive |
  Parent?`; roles include Is Administrator?, Manage Inventory, Is
  Secretary?, Is Awana staff?, Record Shekels, Record Checkin, Record
  Handbook Activity, Record Award Distribution, Record Item Distribution,
  Change book assigned to Clubber, Meeting Reports. PII-bearing;
  operator-only.
- `/inventory` — store inventory `Item | Inventory`, with an "Items with
  Negative Balance" section.
- `/download` — "Download Data" per `year_start` (Current, 2025-2026 …
  2016-2017): a `File` table of bulk exports.
- `/payment/index`, `/payment/report` (`year_start, date_from, date_to,
  type`), `/payment/unpaid` — payments; financial PII, operator-only.
- `/yearend/process` — year-end rollover (POST `advance_grade`; not
  exercised). `/forum`, `/doc/guide`, `/doc/all` — vendor help.
- Setup pages: `/additItem/admin`, `/registrationRate/admin`,
  `/pmtType/admin`, `/shirtsize/admin`, `/relationship/admin`,
  `/clubber/customize`, `/household/customize`.
- Scale on this tenant: `/clubber/csv` had roughly 300 data rows,
  `/household/csv` roughly 500.

### 8.4 Privacy rule for anything built from §8

Whatever is read from these pages stays on the print server and the
operator dashboard unless it is reduced to the display contract's allowlist
(first names, counts, dates). Guardian contact, payments, notes, birth years
and addresses never leave the operator machine.
