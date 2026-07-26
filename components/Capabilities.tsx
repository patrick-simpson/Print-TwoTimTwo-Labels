import React from 'react';
import { SERVER_VERSION } from '../src/constants';

// ─────────────────────────────────────────────────────────────────────────────
// Capabilities & roadmap page.
//
// Two jobs:
//  1. Document EVERYTHING TwoTimTwo.com can do (so nobody re-scrapes the site).
//  2. List concrete future possibilities for this project, ranked.
//
// The developer-level contract (selectors, CSV columns, endpoints) lives in
// docs/TWOTIMTWO.md; this page is the human-readable companion.
// ─────────────────────────────────────────────────────────────────────────────

type Use = 'used' | 'partial' | 'unused';

const USE_BADGE: Record<Use, { label: string; cls: string }> = {
  used:    { label: 'Used today',   cls: 'bg-brand-600 text-white' },
  partial: { label: 'Partly used',  cls: 'bg-amber-500 text-white' },
  unused:  { label: 'Available',    cls: 'bg-slate-200 text-slate-600' },
};

interface Capability { name: string; body: string; use: Use; where?: string; }
interface Group { icon: string; title: string; caps: Capability[]; }

const CATALOG: Group[] = [
  {
    icon: '✅',
    title: 'Check-in',
    caps: [
      { name: 'Tap-to-check-in roster', use: 'used', where: '/clubber/checkin',
        body: 'The main station page: a list of not-yet-checked-in kids; tapping one opens a modal of that meeting’s check-in items (Bible, Attendance, Brought a friend…), and the row disappears once checked in. This disappearing-row behavior is exactly what our extension diffs to detect check-ins made on any device.' },
      { name: 'Last-check-in banner + undo', use: 'used', where: '#lastCheckin',
        body: 'A live "Last checked in: …" banner with an undo link. Our extension watches it to catch check-ins made at this same station.' },
      { name: 'Clubber id + club id on every row', use: 'used', where: 'recid / club_id',
        body: 'Each roster row carries TwoTimTwo’s own clubber id and club id. As of v5.1 we read these for exact identity — so two kids with the same name never pull the wrong allergy/photo data.' },
      { name: 'Check-in Report (who’s in tonight)', use: 'unused', where: '/clubber/checkin_report',
        body: 'The authoritative per-club table of exactly who is checked in tonight, with counts and per-row undo. A rock-solid reconciliation/recovery source — see roadmap R-1.' },
      { name: 'Five documented check-in modes', use: 'partial',
        body: 'Central station, per-group leader phones, hybrid, printed paper forms keyed in later, and CSV import (incl. from KidCheck). TwoTimTwo explicitly supports third-party label printing at check-in — which is precisely our niche.' },
      { name: 'CSV check-in import (official write-path)', use: 'unused', where: '/clubber/checkin_csv',
        body: 'Upload a check-in CSV and TwoTimTwo records attendance, with fuzzy name-matching. The sanctioned way for an external tool to WRITE check-ins back — see roadmap R-2.' },
      { name: 'Checkout with pickup security', use: 'unused', where: '/clubber/checkout',
        body: 'Lists checked-in kids with guardians, authorized-pickup names, a security code entered at check-in, and photo. Could drive a matching parent-pickup tag.' },
      { name: 'Walk-in visitor registration', use: 'partial', where: '/clubber/register',
        body: 'Register a brand-new child right from the check-in page. Our widget prints walk-in labels today; it could also create the TwoTimTwo record — see roadmap F-3.' },
    ],
  },
  {
    icon: '👥',
    title: 'Roster & households',
    caps: [
      { name: 'Full roster CSV export', use: 'used', where: '/clubber/csv',
        body: 'The 66-column export we enrich labels from (name, club, grade, group, birthdate, notes/allergies, med & photo release, share balance, guardians, phones). Synced to the local print server every load.' },
      { name: 'Household database', use: 'unused', where: '/household/csv',
        body: 'All households with a comma-separated list of each household’s children — the authoritative sibling map (the clubber CSV has no household id). See roadmap R-3.' },
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
    icon: '📖',
    title: 'Meetings, awards & tracking',
    caps: [
      { name: 'Record handbook activity', use: 'unused', where: '/meeting/record',
        body: 'Batch entry of completed handbook sections per group, feeding every downstream report.' },
      { name: 'Meeting report — who earned what', use: 'unused', where: '/meeting/report?output=csv',
        body: 'Per-meeting CSV of each child’s check-in items and awards earned tonight. The machine feed behind award-slip printing and a lobby "tonight" ticker — roadmap F-1 / D-1.' },
      { name: 'Awards distribution + worksheets', use: 'unused', where: '/meeting/awards',
        body: 'Track earned vs handed-out awards; generate printable undistributed-award worksheets (PDF).' },
      { name: 'Shares (shekels) & points economy', use: 'partial', where: '/report/shekelBalance',
        body: 'Per-club share balances (we already print these on Store Night) plus a full points/color-group scoring system.' },
      { name: 'Color-group points race', use: 'unused', where: '/meeting/colorGroup',
        body: 'Team points totals per meeting — a natural lobby scoreboard. See roadmap D-2.' },
      { name: 'Book Tracks / Blue Jewel / book-count awards', use: 'unused',
        body: 'Full curriculum structure (Track→Book→Unit→Section) and automatic attendance/completion award rules.' },
      { name: 'Printable handbook agendas', use: 'unused', where: '/meeting/handbook',
        body: 'Per-group worksheet PDFs leaders mark during the meeting — could auto-print at meeting start (roadmap F-4).' },
    ],
  },
  {
    icon: '🗓️',
    title: 'Calendar, messaging & the rest',
    caps: [
      { name: 'Meeting calendar + calendar_id', use: 'partial', where: '/calendar/index',
        body: 'Every meeting has an id (the check-in form’s calendar_id) and a date; meetings can be marked "No Awana this week".' },
      { name: 'iCal subscription feed', use: 'unused', where: '/calendar/iCal',
        body: 'A standard calendar feed of all meetings — could drive the signage "next meeting / tonight’s theme" banner without any scraping. Roadmap D-3.' },
      { name: 'Announcement / cancellation messages', use: 'unused', where: '/msg/admin',
        body: 'Church-authored notices — mirror a cancellation as a big "CLUB CANCELLED TONIGHT" display alert.' },
      { name: 'CSV report suite', use: 'unused', where: '/report/*?output=csv',
        body: 'Attendance grid/summary, club counts, completed books, quarter points, distributed awards, unpaid — nearly every report exports CSV. A ready-made analytics feed.' },
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
}

const ROADMAP: Idea[] = [
  { id: 'R-1', title: 'Reconcile detection against the Check-in Report', benefits: 'Printer', effort: 'M', impact: 'High',
    body: 'Today the extension infers remote check-ins purely by watching rows disappear from the roster, guarded by heuristics against filters and re-renders. Periodically polling /clubber/checkin_report (the authoritative "who’s in tonight" list) would let it confirm every detection and catch any it missed or phantom-fired — eliminating the whole class of phantom/missed-print bugs the guards exist to paper over.' },
  { id: 'F-1', title: 'Award-slip printing from the meeting report', benefits: 'Printer', effort: 'M', impact: 'High',
    body: 'Pull /meeting/report?output=csv for tonight and print a small "🏅 earned: …" slip when a child completes a book or earns an award — a delight moment leaders currently track on paper.' },
  { id: 'D-1', title: 'Lobby "tonight" ticker', benefits: 'Display', effort: 'M', impact: 'High',
    body: 'Feed the signage app a live ticker of tonight’s totals — kids checked in per club, books completed, awards earned, bring-a-friend count — sourced from the report CSVs via the print server (kept first-name-only per the privacy invariant).' },
  { id: 'R-3', title: 'Authoritative sibling map from household CSV', benefits: 'Printer', effort: 'S', impact: 'Med',
    body: 'The roster CSV has no household id, so sibling grouping now falls back to phone/address heuristics. Syncing /household/csv (which lists each household’s children directly) would make "Also here tonight?" exact for blended families and split same-surname families correctly.' },
  { id: 'D-2', title: 'Color-group points scoreboard', benefits: 'Display', effort: 'M', impact: 'Med',
    body: 'Render the team points race (/meeting/colorGroup) as a rotating lobby scoreboard — a proven engagement driver for kids.' },
  { id: 'D-3', title: 'iCal-driven "next meeting" banner', benefits: 'Display', effort: 'S', impact: 'Med',
    body: 'Subscribe to /calendar/iCal so the countdown/signage app always knows the next real meeting date (and can show "No Awana this week") without any hard-coded schedule.' },
  { id: 'F-2', title: 'Direct check-in API for driven flows', benefits: 'Printer', effort: 'M', impact: 'Med',
    body: 'Sibling / phone / Quick-Mode check-ins currently click the row and poll for the modal button — fragile if TwoTimTwo restyles the modal. The documented POST /clubber/checkinclubber (clubber_id + calendar_id + events[]) would let those flows check in directly and reliably, keeping the click path only as a fallback.' },
  { id: 'R-2', title: 'CSV write-back as a safety net', benefits: 'Both', effort: 'M', impact: 'Med',
    body: 'If a station is offline from TwoTimTwo mid-event, queue the night’s check-ins and reconcile later via the official /clubber/checkin_csv import instead of hand-entry — no attendance ever lost.' },
  { id: 'F-3', title: 'One-step walk-in that also registers', benefits: 'Printer', effort: 'M', impact: 'Low',
    body: 'The walk-in widget prints a guest label now; it could also submit /clubber/register so the visitor exists in TwoTimTwo immediately (with the required phone/birthdate prompted inline).' },
  { id: 'F-4', title: 'Auto-print leader worksheets at meeting start', benefits: 'Printer', effort: 'S', impact: 'Low',
    body: 'Fetch the per-group handbook agenda PDF (/meeting/handbook) and print it for each leader when club night begins.' },
];

const EFFORT_LABEL = { S: 'Small', M: 'Medium', L: 'Large' } as const;
const BENEFIT_CLS: Record<Idea['benefits'], string> = {
  Printer: 'bg-brand-50 text-brand-700 border-brand-200',
  Display: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Both:    'bg-slate-100 text-slate-700 border-slate-300',
};
const IMPACT_CLS: Record<Idea['impact'], string> = {
  High: 'text-brand-700', Med: 'text-amber-600', Low: 'text-slate-400',
};

export const Capabilities: React.FC = () => (
  <div className="min-h-screen flex flex-col bg-white text-slate-800">
    <nav className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-100">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <a href="./index.html" className="flex items-center gap-2.5 font-extrabold text-slate-900">
          <span className="w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center text-lg shadow-sm">
            <i className="fa fa-print"></i>
          </span>
          <span className="hidden sm:inline">Awana Label Printer</span>
          <span className="text-[10px] font-mono font-medium bg-brand-50 text-brand-700 border border-brand-200 px-1.5 py-0.5 rounded-full">v{SERVER_VERSION}</span>
        </a>
        <a href="./index.html" className="text-sm font-semibold text-slate-600 hover:text-brand-700 transition-colors">
          <i className="fa fa-arrow-left mr-1.5"></i>Back to home
        </a>
      </div>
    </nav>

    <main className="flex-1">
      {/* Hero */}
      <section className="max-w-4xl mx-auto px-4 pt-16 pb-10 text-center">
        <span className="inline-block text-[11px] font-black uppercase tracking-wider bg-brand-50 text-brand-700 border border-brand-200 px-2.5 py-1 rounded-full mb-4">
          Capabilities & Roadmap
        </span>
        <h1 className="text-4xl font-black text-slate-900 tracking-tight">What TwoTimTwo can do — and what we could build next</h1>
        <p className="text-slate-500 mt-4 leading-relaxed">
          A living map of every capability the TwoTimTwo check-in system exposes, which ones this
          printer/display project uses today, and a ranked list of features worth building. Captured
          from the live site so future work starts from a reference instead of another scrape.
        </p>
        <p className="text-xs text-slate-400 mt-3">
          Developer-level contract (selectors, CSV columns, endpoints) lives in{' '}
          <code className="bg-slate-100 px-1.5 py-0.5 rounded">docs/TWOTIMTWO.md</code>.
        </p>
      </section>

      {/* Legend */}
      <section className="max-w-6xl mx-auto px-4 pb-6">
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-slate-500">
          <span>Legend:</span>
          {(Object.keys(USE_BADGE) as Use[]).map(u => (
            <span key={u} className="inline-flex items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${USE_BADGE[u].cls}`}>{USE_BADGE[u].label}</span>
            </span>
          ))}
        </div>
      </section>

      {/* Catalog */}
      <section className="bg-slate-50 border-y border-slate-100">
        <div className="max-w-6xl mx-auto px-4 py-14">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-1">Everything TwoTimTwo.com does</h2>
          <p className="text-slate-500 text-sm mb-8">Grouped by area. The badge shows how much of each capability this project already taps.</p>
          <div className="space-y-10">
            {CATALOG.map(group => (
              <div key={group.title}>
                <h3 className="flex items-center gap-2 font-bold text-slate-900 mb-4">
                  <span className="text-xl" aria-hidden="true">{group.icon}</span>{group.title}
                </h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.caps.map(c => (
                    <div key={c.name} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <h4 className="font-bold text-slate-900 text-sm leading-snug">{c.name}</h4>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap ${USE_BADGE[c.use].cls}`}>{USE_BADGE[c.use].label}</span>
                      </div>
                      <p className="text-[13px] text-slate-600 leading-relaxed flex-1">{c.body}</p>
                      {c.where && <code className="mt-3 text-[11px] text-slate-400 font-mono truncate">{c.where}</code>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-1">Future possibilities</h2>
        <p className="text-slate-500 text-sm mb-8">
          Concrete, buildable ideas — each grounded in a real endpoint above. Ordered by impact.
          Codes (R-/F-/D-) are stable so they can be referenced from issues and commits.
        </p>
        <div className="space-y-4">
          {ROADMAP.map(idea => (
            <div key={idea.id} className="border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="font-mono text-xs font-bold text-slate-400">{idea.id}</span>
                <h3 className="font-bold text-slate-900 flex-1 min-w-[12rem]">{idea.title}</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${BENEFIT_CLS[idea.benefits]}`}>{idea.benefits}</span>
                <span className="text-[11px] text-slate-500">Effort: <b className="text-slate-700">{EFFORT_LABEL[idea.effort]}</b></span>
                <span className={`text-[11px] font-bold ${IMPACT_CLS[idea.impact]}`}>Impact: {idea.impact}</span>
              </div>
              <p className="text-[13px] text-slate-600 leading-relaxed">{idea.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-900 text-slate-300">
        <div className="max-w-4xl mx-auto px-4 py-12 text-center">
          <h2 className="text-xl font-black text-white mb-2">Privacy stays non-negotiable</h2>
          <p className="text-sm leading-relaxed text-slate-400">
            Every idea here respects the project’s core invariant: only first names ever leave the
            volunteer’s browser for a display. Allergy, contact, photo-release and household data are
            used locally to enrich a label and never broadcast. Any feature touching photos must gate
            on each child’s <b>Photo Release?</b> value.
          </p>
        </div>
      </section>
    </main>

    <footer className="border-t border-slate-100 py-8 text-center text-xs text-slate-400">
      Awana Label Printer · Capabilities reference · v{SERVER_VERSION}
    </footer>
  </div>
);
