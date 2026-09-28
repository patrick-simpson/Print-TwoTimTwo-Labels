import React from 'react';
import { IconSprite, Icon, IconName } from './family/Icons';
import { FamilyFooter, FamilyHeader } from './family/Family';

// ─────────────────────────────────────────────────────────────────────────────
// TwoTimTwo reference page (capabilities.html).
//
// Two jobs:
//  1. Document EVERYTHING TwoTimTwo.com can do (so nobody re-scrapes the site).
//  2. Keep a record of the v5.2 roadmap, every item of which shipped. It is a
//     historical record, not a current plan: later work lives in changes.md
//     and in the showcase on the home page.
//
// The developer-level contract (selectors, CSV columns, endpoints) lives in
// docs/TWOTIMTWO.md; this page is the human-readable companion.
// ─────────────────────────────────────────────────────────────────────────────

type Use = 'used' | 'partial' | 'unused';

const USE_BADGE: Record<Use, { label: string; cls: string }> = {
  used:    { label: 'Used today',   cls: 'lbl-badge lbl-badge--used' },
  partial: { label: 'Partly used',  cls: 'lbl-badge lbl-badge--partial' },
  unused:  { label: 'Available',    cls: 'lbl-badge' },
};

interface Capability { name: string; body: string; use: Use; where?: string; }
interface Group { icon: IconName; title: string; caps: Capability[]; }

const CATALOG: Group[] = [
  {
    icon: 'check',
    title: 'Check-in',
    caps: [
      { name: 'Tap-to-check-in roster', use: 'used', where: '/clubber/checkin',
        body: 'The main station page: a list of not-yet-checked-in kids; tapping one opens a modal of that meeting’s check-in items (Bible, Attendance, Brought a friend…), and the row disappears once checked in. This disappearing-row behavior is exactly what our extension diffs to detect check-ins made on any device.' },
      { name: 'Last-check-in banner + undo', use: 'used', where: '#lastCheckin',
        body: 'A live "Last checked in: …" banner with an undo link. Our extension watches it to catch check-ins made at this same station.' },
      { name: 'Clubber id + club id on every row', use: 'used', where: 'recid / club_id',
        body: 'Each roster row carries TwoTimTwo’s own clubber id and club id. As of v5.1 we read these for exact identity — so two kids with the same name never pull the wrong allergy/photo data.' },
      { name: 'Check-in Report (who’s in tonight)', use: 'used', where: '/clubber/checkin_report',
        body: 'The authoritative per-club table of exactly who is checked in tonight, with counts and per-row undo. Since v5.2 the printer reconciles against it every few minutes during club, so a check-in the roster-diff detector misses still gets a label (R-1), and since v6.14 tonight’s count comes from it. Since v5.7 the same pass also detects undo: a kid who disappears from the report is uncounted from the tally broadcast and freed for re-check-in on the phones. It also feeds the lobby ticker.' },
      { name: 'Five documented check-in modes', use: 'partial',
        body: 'Central station, per-group leader phones, hybrid, printed paper forms keyed in later, and CSV import (incl. from KidCheck). TwoTimTwo explicitly supports third-party label printing at check-in — which is precisely our niche.' },
      { name: 'CSV check-in import (official write-path)', use: 'used', where: '/clubber/checkin_csv',
        body: 'Upload a check-in CSV and TwoTimTwo records attendance, with fuzzy name-matching. The printer can now export tonight\u2019s check-ins in exactly this format (R-2), so a station that lost its connection reconciles instead of hand-entering a whole night.' },
      { name: 'Checkout with pickup security', use: 'partial', where: '/clubber/checkout',
        body: 'Lists checked-in kids with guardians, authorized-pickup names, a security code entered at check-in, and photo. Could drive a matching parent-pickup tag. The extension reads the live list, first names and clubs only, to feed the lobby checkout board, which is off by default.' },
      { name: 'Walk-in visitor registration', use: 'used', where: '/clubber/register',
        body: 'Register a brand-new child right from the check-in page. The widget now prints the guest label AND (optionally) creates the TwoTimTwo record in one step (F-3) \u2014 the label always prints even if the form errors, because the child is already at the door.' },
    ],
  },
  {
    icon: 'family',
    title: 'Roster & households',
    caps: [
      { name: 'Full roster CSV export', use: 'used', where: '/clubber/csv',
        body: 'The 66-column export we enrich labels from (name, club, grade, group, birthdate, notes/allergies, med & photo release, share balance, guardians, phones). Synced to the local print server every load.' },
      { name: 'Household database', use: 'unused', where: '/household/csv',
        body: 'All households with a comma-separated list of each household’s children. Powered the "Also here tonight?" sibling-suggestion feature (R-3) until that feature was retired; no longer synced.' },
      { name: 'Clubber quick-search API', use: 'unused', where: '/clubber/ajaxSearch',
        body: 'A name-substring lookup returning matching kids with links carrying their ids. Doubles as a cheap session-health probe ("Login Required" when logged out).' },
      { name: 'Custom-view CSV exports', use: 'unused', where: '/clubber/admin?cview=…&print=csv',
        body: 'Saved column views (Birthdays, Contact Info, Game Groupings, Special Notes…) each exportable as a narrow, purpose-built CSV — a cleaner feed than the 66-column dump.' },
      { name: 'Merge / move / history / mailing labels', use: 'unused',
        body: 'Dedupe clubbers, move between households, per-clubber completion history, and printable mailing-label PDF sheets.' },
      { name: 'Grades → club/book mapping', use: 'partial', where: '/grade/admin',
        body: 'The definitive grade→club taxonomy (used implicitly for Step Up). Could normalize club identity across our apps.' },
    ],
  },
  {
    icon: 'ledger',
    title: 'Meetings, awards & tracking',
    caps: [
      { name: 'Record handbook activity', use: 'unused', where: '/meeting/record',
        body: 'Batch entry of completed handbook sections per group, feeding every downstream report.' },
      { name: 'Meeting report — who earned what', use: 'used', where: '/meeting/report?output=csv',
        body: 'Per-meeting CSV of each child’s check-in items and awards earned tonight. Now drives both award-slip printing (F-1) and the lobby “tonight” ticker (D-1).' },
      { name: 'Awards distribution + worksheets', use: 'unused', where: '/meeting/awards',
        body: 'Track earned vs handed-out awards; generate printable undistributed-award worksheets (PDF).' },
      { name: 'Shares (shekels) & points economy', use: 'partial', where: '/report/shekelBalance',
        body: 'Per-club share balances (we already print these on Store Night) plus a full points/color-group scoring system.' },
      { name: 'Color-group points race', use: 'used', where: '/meeting/colorGroup',
        body: 'Team points totals per meeting, now rendered as a projector scoreboard with ranked bars (D-2).' },
      { name: 'Book Tracks / Blue Jewel / book-count awards', use: 'unused',
        body: 'Full curriculum structure (Track→Book→Unit→Section) and automatic attendance/completion award rules.' },
      { name: 'Printable handbook agendas', use: 'used', where: '/meeting/handbook',
        body: 'Per-group worksheet PDFs leaders mark during the meeting. These can auto-print at meeting start (F-4) — opt-in, because a surprise stack of letter-size paper is worse than none.' },
    ],
  },
  {
    icon: 'chart',
    title: 'Calendar, messaging & the rest',
    caps: [
      { name: 'Meeting calendar + calendar_id', use: 'partial', where: '/calendar/index',
        body: 'Every meeting has an id (the check-in form’s calendar_id) and a date; meetings can be marked "No Awana this week".' },
      { name: 'iCal subscription feed', use: 'used', where: '/calendar/iCal',
        body: 'A standard calendar feed of all meetings. The countdown now takes the next meeting date and theme from it as an advisory correction (D-3) — only DTSTART and SUMMARY are ever read, never attendee data.' },
      { name: 'Announcement / cancellation messages', use: 'used', where: '/msg/admin',
        body: 'Church-authored notices are mirrored to the screens (D-5); a cancellation becomes an unmissable full-width alert.' },
      { name: 'CSV report suite', use: 'partial', where: '/report/*?output=csv',
        body: 'Attendance grid/summary, club counts, completed books, quarter points, distributed awards, unpaid — nearly every report exports CSV. A ready-made analytics feed. The attendance grid now feeds the Attendance Audit and completed books the trophy band.' },
      { name: 'Payments, inventory, mass email, profiles/roles', use: 'unused',
        body: 'Registration rates & ledgers, prize inventory with POs, mass email to staff/leaders/parents, and role-based leader logins. Out of scope for label printing but documented for completeness.' },
      { name: 'Built-in label settings & vendor docs', use: 'unused', where: '/setting?tab=Labels',
        body: 'TwoTimTwo has its own label layout settings and an extensive doc/FAQ/guide corpus (250+ entries) — a reference for expected behavior.' },
    ],
  },
];

interface Idea {
  id: string; title: string; body: string;
  benefits: 'Printer' | 'Display' | 'Both';
  effort: 'S' | 'M' | 'L'; impact: 'High' | 'Med' | 'Low';
  status?: 'shipped' | 'planned';
  shippedIn?: string;
  retired?: string;   // what changed after it shipped (a record, not a rewrite)
}

const ROADMAP: Idea[] = [
  { id: 'R-1', title: 'Reconcile detection against the Check-in Report', benefits: 'Printer', effort: 'M', impact: 'High', status: 'shipped', shippedIn: '5.2.0',
    body: 'Today the extension infers remote check-ins purely by watching rows disappear from the roster, guarded by heuristics against filters and re-renders. Periodically polling /clubber/checkin_report (the authoritative "who’s in tonight" list) would let it confirm every detection and catch any it missed or phantom-fired — eliminating the whole class of phantom/missed-print bugs the guards exist to paper over.' },
  { id: 'F-1', title: 'Award-slip printing from the meeting report', benefits: 'Printer', effort: 'M', impact: 'High', status: 'shipped', shippedIn: '5.2.0',
    body: 'Pull /meeting/report?output=csv for tonight and print a small "🏅 earned: …" slip when a child completes a book or earns an award — a delight moment leaders currently track on paper.' },
  { id: 'D-1', title: 'Lobby "tonight" ticker', benefits: 'Display', effort: 'M', impact: 'High', status: 'shipped', shippedIn: '5.2.0',
    body: 'Feed the signage app a live ticker of tonight’s totals — kids checked in per club, books completed, awards earned, bring-a-friend count — sourced from the report CSVs via the print server (kept first-name-only per the privacy invariant).' },
  { id: 'R-3', title: 'Authoritative sibling map from household CSV', benefits: 'Printer', effort: 'S', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'The roster CSV has no household id, so sibling grouping now falls back to phone/address heuristics. Syncing /household/csv (which lists each household’s children directly) would make "Also here tonight?" exact for blended families and split same-surname families correctly.',
    retired: 'Retired in v6.1.0, together with the sibling check-in feature it served.' },
  { id: 'D-2', title: 'Color-group points scoreboard', benefits: 'Display', effort: 'M', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'Render the team points race (/meeting/colorGroup) as a rotating lobby scoreboard — a proven engagement driver for kids.' },
  { id: 'D-3', title: 'iCal-driven "next meeting" banner', benefits: 'Display', effort: 'S', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'Subscribe to /calendar/iCal so the countdown/signage app always knows the next real meeting date (and can show "No Awana this week") without any hard-coded schedule.' },
  { id: 'F-2', title: 'Direct check-in API for driven flows', benefits: 'Printer', effort: 'M', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'Sibling / phone / Quick-Mode check-ins currently click the row and poll for the modal button — fragile if TwoTimTwo restyles the modal. The documented POST /clubber/checkinclubber (clubber_id + calendar_id + events[]) would let those flows check in directly and reliably, keeping the click path only as a fallback.',
    retired: 'Sibling check-in was removed in v6.1.0; the direct check-in path still serves phone check-in.' },
  { id: 'R-2', title: 'CSV write-back as a safety net', benefits: 'Both', effort: 'M', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'If a station is offline from TwoTimTwo mid-event, queue the night’s check-ins and reconcile later via the official /clubber/checkin_csv import instead of hand-entry — no attendance ever lost.' },
  { id: 'F-3', title: 'One-step walk-in that also registers', benefits: 'Printer', effort: 'M', impact: 'Low', status: 'shipped', shippedIn: '5.2.0',
    body: 'The walk-in widget prints a guest label now; it could also submit /clubber/register so the visitor exists in TwoTimTwo immediately (with the required phone/birthdate prompted inline).' },
  { id: 'F-4', title: 'Auto-print leader worksheets at meeting start', benefits: 'Printer', effort: 'S', impact: 'Low', status: 'shipped', shippedIn: '5.2.0',
    body: 'Fetch the per-group handbook agenda PDF (/meeting/handbook) and print it for each leader when club night begins.' },
  { id: 'R-4', title: 'Full clubber-id identity through detection & siblings', benefits: 'Printer', effort: 'M', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'v5.1 anchors the print/enrichment path to TwoTimTwo’s clubber id, but the extension’s roster cache, print-dedup, and GET /siblings are still keyed by lowercased name. Two children with an identical first+last name therefore still can’t be told apart for detection/dedup or sibling lookup. Key ROSTER_CACHE and the dedup sets by recid, and let /siblings accept a clubberId, to close the last gap.',
    retired: 'The sibling lookup was removed in v6.1.0; the clubber-id identity itself stays.' },
  { id: 'D-4', title: 'Trek & Journey included in the projector celebrations', benefits: 'Display', effort: 'S', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'The presentation tool was scoped to four clubs in code, so a Trek or Journey child’s birthday was silently dropped and never celebrated. All six clubs are now recognised. The game-time roster stays schedule-driven, so teen clubs are not forced into a game window a church has not configured.' },
  { id: 'D-5', title: 'Cancellation / announcement alert on every screen', benefits: 'Display', effort: 'S', impact: 'High', status: 'shipped', shippedIn: '5.2.0',
    body: 'A church announcement written in TwoTimTwo is mirrored to the lobby TV. A cancellation renders as an unmissable full-width bar above every other layer, so “CLUB CANCELLED TONIGHT” reaches families walking in — and reaches an OBS/ProPresenter feed too.' },
  { id: 'R-5', title: 'Smarter allergy extraction from free-text Notes', benefits: 'Printer', effort: 'M', impact: 'Low', status: 'shipped', shippedIn: '5.2.0',
    body: 'The real export has no dedicated allergy column, so allergies are parsed from the free-text Notes field. Parsing stays deliberately permissive (an extra icon is safer than a missed allergy), which can surface false-positive icons (e.g. "loves coloring" → dye). A negation-aware parse, or asking the church for a dedicated allergy field/custom view, would cut the noise without risking a missed allergy.' },
];

const EFFORT_LABEL = { S: 'Small', M: 'Medium', L: 'Large' } as const;

const SUB_LINKS = [
  { href: './', label: 'Home' },
  { href: './#features', label: 'Showcase' },
  { href: './#install', label: 'Install' },
  { href: './#faq', label: 'FAQ' },
  { href: './capabilities.html', label: 'TwoTimTwo reference', current: true },
];

export const Capabilities: React.FC = () => (
  <>
    <a className="fam-skip" href="#main">Skip to the content</a>
    <IconSprite />
    <FamilyHeader subLinks={SUB_LINKS} subLabel="Club Label Printer pages" productCurrent="true" />

    <main id="main">
      {/* Hero */}
      <section className="lbl-ref-hero" aria-labelledby="ref-title">
        <div className="fam-wrap">
          <p className="fam-kicker">TwoTimTwo reference</p>
          <h1 className="lbl-ref-hero__title" id="ref-title">What TwoTimTwo can do, <em>and what we use</em></h1>
          <p className="lbl-ref-hero__lede">
            A map of every capability the TwoTimTwo check-in system exposes and which ones this printer and
            display project taps, captured from the live site so future work starts from a reference
            instead of another scrape.
          </p>
          <div className="lbl-note lbl-ref-note">
            <Icon name="ledger" className="lbl-note__icon" />
            <span>
              <strong>A reference and a record.</strong> The catalog was mapped around v5.2 and has had small
              updates since; it is not a full list of what Club Label Printer does today (for that, see the{' '}
              <a href="./#features">showcase on the home page</a>). The roadmap below is kept as a record of
              the fourteen items that shipped in v5.2.0, with notes where something changed later.
            </span>
          </div>
          <p className="lbl-small mt-4">
            The developer-level contract (selectors, CSV columns, endpoints) lives in{' '}
            <code className="lbl-code">docs/TWOTIMTWO.md</code>.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-step--1 text-ink-2">
            <span>Legend:</span>
            {(Object.keys(USE_BADGE) as Use[]).map(u => (
              <span key={u} className={USE_BADGE[u].cls}>{USE_BADGE[u].label}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Catalog */}
      <section className="lbl-refband mt-0!" aria-labelledby="catalog-title">
        <div className="fam-wrap">
          <h2 className="text-step-3" id="catalog-title">Everything TwoTimTwo.com does</h2>
          <p className="mt-2 text-ink-2 text-step--1">Grouped by area. The badge shows how much of each capability this project taps.</p>
          <div className="mt-10 space-y-12">
            {CATALOG.map(group => (
              <div key={group.title}>
                <h3 className="flex items-center gap-3 text-step-1">
                  <span className="fam-card__icon"><Icon name={group.icon} /></span>{group.title}
                </h3>
                <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.caps.map(c => (
                    <div key={c.name} className="lbl-refcard">
                      <div className="flex items-start justify-between gap-3">
                        <h4>{c.name}</h4>
                        <span className={`shrink-0 ${USE_BADGE[c.use].cls}`}>{USE_BADGE[c.use].label}</span>
                      </div>
                      <p className="flex-1">{c.body}</p>
                      {c.where && <code className="lbl-where">{c.where}</code>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap record */}
      <section className="lbl-part" aria-labelledby="roadmap-title">
        <div className="fam-wrap">
          <div className="lbl-part__head">
            <p className="fam-kicker">A record</p>
            <h2 className="lbl-part__title" id="roadmap-title">The v5.2 roadmap, all shipped</h2>
            <p className="lbl-part__lede">
              Every item below started as a &ldquo;future possibility&rdquo; found by mapping the live
              check-in system, and all fourteen shipped in v5.2.0. Each is grounded in a real endpoint
              from the catalog above. The codes (R-/F-/D-) are stable so they stay referenceable from
              issues and commits. The descriptions are kept as they were written, as a plan; the notes
              mark what changed later.
            </p>
          </div>
          <div className="mt-10 space-y-4">
            {ROADMAP.map(idea => (
              <div key={idea.id} className="lbl-refcard">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="font-code text-step--1 font-medium text-ink-3">{idea.id}</span>
                  <h3 className="flex-1 min-w-[12rem]">{idea.title}</h3>
                  {idea.status === 'shipped' && (
                    <span className="lbl-badge lbl-badge--shipped">Shipped{idea.shippedIn ? ` v${idea.shippedIn}` : ''}</span>
                  )}
                  <span className="lbl-badge">{idea.benefits}</span>
                  <span className="text-step--1 text-ink-2">Effort: <b className="text-ink">{EFFORT_LABEL[idea.effort]}</b></span>
                  <span className="text-step--1 text-ink-2">Impact: <b className="text-ink">{idea.impact}</b></span>
                </div>
                <p>{idea.body}</p>
                {idea.retired && (
                  <p className="mt-3! flex flex-wrap items-center gap-2"><span className="lbl-badge lbl-badge--retired">Later</span><span>{idea.retired}</span></p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lbl-refband" aria-labelledby="privacy-title">
        <div className="fam-wrap">
          <div className="max-w-3xl">
            <p className="fam-kicker">Privacy</p>
            <h2 className="mt-3 text-step-3" id="privacy-title">Privacy stays non-negotiable</h2>
            <p className="mt-4 text-ink-2">
              Every idea here respects the project&rsquo;s core rule: only first names ever leave the
              volunteer&rsquo;s browser for a display. Allergy, contact, photo-release and household data are
              used locally to enrich a label and never broadcast. Any feature touching photos must respect
              each child&rsquo;s release answers: an explicit &ldquo;no&rdquo; under either <b className="text-ink">Photo Release?</b> or{' '}
              <b className="text-ink">Med Release?</b> counts, since churches record the media release under either column.
            </p>
          </div>
        </div>
      </section>
    </main>

    <FamilyFooter />
  </>
);
