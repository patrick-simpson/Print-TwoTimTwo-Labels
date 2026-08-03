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
| Report | `/clubber/checkin_report?date=YYYY-MM-DD` | HTML: one `<table>` per club, `tfoot tr.totals` Count / Total Shares, per-row `undoCheckin(<id>)` | **Authoritative "who is checked in tonight."** No CSV variant. |
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
| `Parent/Guardian#1` | `PrimaryContact` | family grouping |
| `Parent/Guardian#2` | `Guardian` | family grouping |
| `Address1` | `Address` | family grouping |
| `Primary Phone` | `PrimaryPhone` | **primary family-grouping key** (no HouseholdID exists) |
| `Leader Notes` | `LeaderNotes` | (reserved) |

> **There is no `Household ID` / `Family ID` column.** Sibling detection groups
> by normalized `Primary Phone`, then guardian+address, then a type-prefixed
> fallback chain, then last name. The authoritative alternative is the household
> CSV (§4). Keep `HEADER_MAP` and the fixture in `test-server-helpers.cjs` in
> sync — if TwoTimTwo renames a column, the test fails instead of labels going
> basic on a Wednesday night.

### 3.2 Quoting rules the parser must survive
- UTF-8 BOM sometimes present (stripped before parse).
- Fields are `"quoted"`, may contain commas and **newlines** (Notes, Emergency
  Contact) and `""`-escaped quotes → needs a stateful parser, not a line split.
- Club names carry a trailing space and HTML `&amp;` in the DOM (`alt`), but
  the CSV `Club` column is plain (`Sparks`, `T&T`).

### 3.3 Related roster exports
- `GET /clubber/prevyearcsv?year=YYYY|all&exclude_if_this_year=Y` — same 66 cols
  + a `Year` column. (Prior-year returners.)
- `GET /household/csv` — 38 cols, **all** households (not just active); the
  `Active Clubbers` column is a comma-separated `"First Last"` list = the
  authoritative household→children map. Header: Household ID, Parent/Guardian#1,
  Parent/Guardian#2, Address1/2, City, State, Zip, (alt addr), Primary Phone(+
  Type + SMS), … Emergency Contact, Others Pickup, Church, Email, Alt Email,
  Active Clubbers, Billing Notes.
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
- Clicks `.clubber` + `#checkin` (driven check-in for siblings / phone / quick mode).
- `GET /clubber/csv` → POSTs to the local print server `/update-csv`.
- `GET /report/shekelBalance?club_id=N&output=csv` (Store Night).
- Scans page text for "step up" / "store" (night-mode auto-detect).

**Print server (`print-server/server.js`), from the CSV only** — never talks to
TwoTimTwo directly; enriches labels from the synced `clubbers.csv`.

Everything else in this doc is **available but unused** — see the capabilities
page (`/capabilities.html`) for the ranked backlog of what to build next.
