import React from 'react';
import { Also, CapabilityCard, Caption, ChapterHead, Safeguard } from './family/Family';
import { CountCheck, JamAlarm, LabelOnLiner, LabelSpec, LobbyPublish, PhoneTonight } from './Mocks';

/**
 * The capability showcase: four spotlight chapters, written for church
 * leadership. Every claim here is true of the current code (print-server,
 * chrome-extension, electron-app); opt-in features carry a tag.
 */

const CHAPTERS = [
  { id: 'runs-the-room', n: '01', title: 'Runs the whole room' },
  { id: 'accuracy', n: '02', title: 'Accuracy & trust' },
  { id: 'night-of', n: '03', title: 'Night-of control' },
  { id: 'label-delight', n: '04', title: 'Label delight' },
];

export const ChapterIndex: React.FC = () => (
  <section id="features" className="lbl-showcase-intro" aria-labelledby="showcase-title">
    <div className="fam-wrap lbl-showcase-intro__grid">
      <div>
        <p className="fam-kicker">The showcase</p>
        <h2 className="lbl-showcase-intro__title" id="showcase-title">What happens <em>behind a single label</em></h2>
      </div>
      <div>
        <p className="lbl-showcase-intro__lede">
          A label looks simple. Behind it, one quiet program on the check-in laptop keeps the lobby
          screens in step, checks its own numbers against TwoTimTwo, and puts a few small delights in
          front of the kids. Four chapters, each with a closer look for the curious.
        </p>
        <nav aria-label="Chapters" className="lbl-showcase-intro__nav">
          <ol className="fam-chapters">
            {CHAPTERS.map(c => <li key={c.id}><a href={`#${c.id}`}><b>{c.n}</b>{c.title}</a></li>)}
          </ol>
        </nav>
      </div>
    </div>
  </section>
);

/* ── 01 ─────────────────────────────────────────────────────────────────── */
const RunsTheRoom: React.FC = () => (
  <section className="fam-chapter" id="runs-the-room" aria-labelledby="runs-the-room-title">
    <div className="fam-wrap">
      <ChapterHead num="01" kicker="Chapter one" title="Runs the whole room" titleId="runs-the-room-title"
        standfirst="One laptop at the check-in table quietly keeps every screen in the building telling the same story."
        intro="Leaders set things up once, before the first family walks in. After that the printer and the lobby screens keep themselves in step, so the people at the door can look after the children." />

      <figure className="fam-frame lbl-figure">
        <LobbyPublish />
        <Caption fig="Fig. 2">Announcements typed once at the laptop appear on every lobby screen, a heartbeat later.</Caption>
      </figure>

      <ul className="fam-cards fam-cards--2">
        <CapabilityCard icon="screens" title="Lobby slides, published once"
          hood={<>Once the church sets a display key, the deck travels as a sealed <code>slides</code> message, encrypted like children’s names, and split into ordered pieces that fit the realtime service’s size limit. The whole deck is re-sent about every five minutes and every screen keeps the newest publish, so an older copy can never win. A slide can carry a show-until date and retire itself.</>}>
          Where the lobby screens run Check-in Display, tonight’s announcements are typed once at the
          check-in laptop. Press Publish and every screen shows them, including one switched on halfway
          through the evening.
        </CapabilityCard>
        <CapabilityCard icon="key" title="One passphrase logs in every screen" tag="Opt-in"
          hood={<>The passphrase is stretched with <code>PBKDF2-SHA256</code> (600,000 rounds, with a fresh salt whenever it changes) into a key that opens a sealed setup message. The laptop re-sends that message every five minutes, and it fails closed: with no passphrase or no display key, nothing is sent at all.</>}>
          Instead of copying a long key onto each lobby TV and the projector, a leader types one church
          passphrase once per screen. The screen receives its keys, and its settings too if the church
          wants, and keeps working through later key changes.
        </CapabilityCard>
        <CapabilityCard icon="flask" title="Rehearse the whole room" tag="Off until armed"
          safeguard="It switches itself off after two hours, so a forgotten practice can’t spill into a real club night."
          hood={<>Rehearsal prints skip print history, the season attendance record and the tally. Every tally sent while it is armed carries a <code>rehearsal: true</code> flag that the lobby screens recognize, and the dashboard’s health check warns for as long as it is on.</>}>
          Before opening night a leader can run a full practice: real labels print with a bold TEST
          band, the lobby screens show a rehearsal notice, and nothing is counted or remembered.
        </CapabilityCard>
        <CapabilityCard icon="refresh" title="Keeps itself up to date"
          hood={<>The app checks GitHub Releases for new versions, with a faster nudge over the realtime channel when one is configured, and restarts a few seconds after a download finishes, so a label already sent has time to go through. On every launch it rewrites the extension’s files into a folder Chrome already loads, so an app update carries the extension with it; Chrome picks it up when it restarts.</>}>
          A new version downloads in the background and installs itself, and the printer is back within
          moments. The Chrome extension comes along with it, and the widget says when a Chrome restart is
          needed to load it.
        </CapabilityCard>
      </ul>

      <Also items={[
        { b: 'A slide can hold the check-ins.', rest: 'While a slide marked “Hold check-ins” is up, arriving names wait instead of covering it, then each plays in full on the next slide.' },
        { b: "A “what’s new” card", rest: 'on the dashboard shows the release notes for the version that just arrived.' },
        { b: 'A broken update is easy to fix:', rest: 'an interrupted install offers a one-click Repair instead of a cryptic error.' },
        { b: 'The dashboard notices', rest: 'when Chrome is still running an older extension than the one the app installed.' },
        { b: 'The lobby screens can wear the season', rest: 'the labels are wearing (with a screen’s theme set to Auto), and always show when a rehearsal is running.' },
        { b: 'An optional update beacon', rest: 'confirms a clean install with nothing more than a version number, only if a church turns it on.' },
        { b: 'Warnings in plain words:', rest: 'a missing consent column or a stuck queue is spelled out, never a silent yellow box.' },
      ]} />
    </div>
  </section>
);

/* ── 02 ─────────────────────────────────────────────────────────────────── */
const Accuracy: React.FC = () => (
  <section className="fam-chapter" id="accuracy" aria-labelledby="accuracy-title">
    <div className="fam-wrap">
      <ChapterHead num="02" kicker="Chapter two" title="Accuracy & trust" titleId="accuracy-title"
        standfirst="A label is only as good as the count behind it, and a safety flag has to be right every time."
        intro="Wherever the system can check itself against TwoTimTwo, it does. Where it can’t be sure, it says so plainly instead of guessing, so a leader can trust the number on the wall and the icons on a badge." />

      <figure className="fam-frame lbl-figure">
        <CountCheck />
        <Caption fig="Fig. 3">The Tonight card compares tonight’s labels with TwoTimTwo’s own count. When they disagree, it names the club.</Caption>
      </figure>

      <ul className="fam-cards">
        <CapabilityCard icon="chart" title="Tonight’s count comes from TwoTimTwo"
          safeguard="A child a volunteer removed on the phone, or a night an operator reset, stays removed even while TwoTimTwo keeps listing them."
          hood={<>A check-in report counts when it arrived within the last 12 minutes, plus anyone checked in since. With no fresh report, the count falls back to the printer’s own history, and the dashboard’s health check names the fallback, so a weaker number never looks like the stronger one.</>}>
          The number on the lobby screen and the dashboard follows TwoTimTwo’s own check-in report, so a
          child checked in while the laptop was asleep is still counted.
        </CapabilityCard>
        <CapabilityCard icon="check" title="A count check that names the gap"
          hood={<>Short and over are worded differently on purpose. A shortfall is never softened. An overage is usually a walk-in guest printed at the door, so those are subtracted first. A report that can’t be read shows as unknown, never as zero or as agreement.</>}>
          One line on the Tonight card says “Matches TwoTimTwo” or, if not, which club is short and by
          how many, so a leader knows exactly where to look for a child without a label.
        </CapabilityCard>
        <CapabilityCard icon="ledger" title="The season’s attendance, audited"
          safeguard="It only ever adds. It never deletes, and a check it couldn’t make reads “Not checked,” never a green check mark."
          hood={<>Outside club hours the extension fetches each club’s attendance grid. The reader checks its own reading against TwoTimTwo’s attendance total for every row, and discards a whole club rather than guess. Twins, walk-in guests and unreadable clubs are listed, never applied.</>}>
          Streaks, milestones and the new-kid welcome all come from a season attendance record. An
          Attendance Audit tab shows any night that record and TwoTimTwo disagree about, with one button
          to add what’s missing.
        </CapabilityCard>
        <CapabilityCard icon="nocam" title="No-photo wishes are never silent"
          safeguard="The dashboard’s consent summary shows the answers it found, never children’s names."
          hood={<><code>parseNoPhoto()</code> reads both the photo-release and the medical-release columns and flags any answer that starts with a negative word (“No”, “Declined”) or carries a negative phrase (“Not signed”, “No photos”). Blank, “N/A” and “pending” mean not answered, and never print the camera.</>}>
          If a family has said no to photos, in either consent column and in any of the ways a church
          might write it, the crossed-out camera prints. If the column can’t be read, the dashboard says so.
        </CapabilityCard>
        <CapabilityCard icon="id" title="Twin-safe labels"
          hood={<>Identity is anchored to TwoTimTwo’s own clubber id first, with the name as a fallback, through printing, duplicate checks and reprints. An ambiguous name is refused rather than guessed.</>}>
          Two children with the same name never swap labels, allergies or photo wishes. When two roster
          names match exactly, their labels add a middle initial or a small birth-month note.
        </CapabilityCard>
        <CapabilityCard icon="lock" title="Names travel sealed" tag="With a display key"
          safeguard="Until a church sets its key, the dashboard says plainly that names are traveling unsealed."
          hood={<><code>AES-256-GCM</code>, padded so a message’s length gives nothing away about a name. A screen that holds a key drops any unsealed name message, so the protection can’t be quietly switched off.</>}>
          The lobby screens receive names over a public realtime channel, so each first name and club is
          encrypted before it leaves the laptop. Anyone who found the channel could not read a single child’s name.
        </CapabilityCard>
      </ul>

      <Also items={[
        { b: 'One check-in, one label:', rest: 'a repeat of the same child within 45 seconds is held back, so a retry or a double-tap never prints twice.' },
        { b: 'An undo on TwoTimTwo', rest: 'is noticed on the next check of the report, and the child comes off tonight’s count on every screen.' },
        { b: "A check-in that didn’t stick", rest: 'is tracked and retried, and shown to a leader until TwoTimTwo confirms it.' },
        { b: 'A daily read-only check', rest: "that TwoTimTwo’s pages still work the way the extension expects, caught before club night." },
        { b: '“Tonight” means tonight:', rest: 'streaks, exports and counts agree on the local evening, even late at night.' },
        { b: 'Reset tonight', rest: 'zeroes a practice night on every screen at once, without deleting a single history row.' },
      ]} />
    </div>
  </section>
);

/* ── 03 ─────────────────────────────────────────────────────────────────── */
const NightOf: React.FC = () => (
  <section className="fam-chapter" id="night-of" aria-labelledby="night-of-title">
    <div className="fam-wrap">
      <ChapterHead num="03" kicker="Chapter three" title="Night-of control" titleId="night-of-title"
        standfirst="The person running the evening can carry it in a pocket."
        intro="These are the tools a volunteer reaches for once the doors are open and a line has formed: on the laptop, on a phone, or standing beside a jammed printer." />

      <div className="lbl-figpair">
        <figure className="fam-frame lbl-figure">
          <div className="lbl-stage lbl-stage--phone">
            <div className="fam-frame--phone"><div className="fam-frame__stage"><PhoneTonight /></div></div>
          </div>
          <Caption fig="Fig. 4" names>The phone’s Tonight tab: exactly who is being counted.</Caption>
        </figure>
        <figure className="fam-frame lbl-figure">
          <div className="lbl-stage"><JamAlarm /></div>
          <Caption fig="Fig. 5">A jam turns the dashboard red and says what is stuck, and where the fix is.</Caption>
        </figure>
      </div>

      <ul className="fam-cards">
        <CapabilityCard icon="phone" title="A phone becomes a check-in station" tag="Off by default"
          safeguard="The laptop only answers phones after a church sets a PIN and turns on phone access."
          hood={<>The Tonight tab mirrors the same list the lobby tally is built from, with Remove and Add back for local corrections. Remove fixes the count here; it never undoes the check-in on TwoTimTwo.</>}>
          A volunteer’s phone on the church Wi-Fi can check a child in, print a leader’s name tag, and see
          exactly who is being counted tonight.
        </CapabilityCard>
        <CapabilityCard icon="alarm" title="The dashboard turns red on a jam"
          safeguard="Clearing the queue asks first, and only works at the laptop itself, never from a phone."
          hood={<><code>checkPrinterWarnings()</code> reads the Windows print queue and warns at three or more waiting jobs, an oldest job past 90 seconds, or any error status such as PaperOut. If the queue can’t be read, it says unknown, never zero.</>}>
          A paper jam or an empty roll used to sit behind a green dashboard while labels quietly failed.
          Now a backlog turns the light red, names the real numbers, and points to Clear print queue.
        </CapabilityCard>
        <CapabilityCard icon="reprint" title="Reprint a whole stretch after a jam"
          hood={<>Up to 20 labels, paced 0.4 seconds apart so a real check-in at the door still gets through. A reprint is never a new check-in: award slips, welcome cards and leader tags are left out, and it refuses to run during a rehearsal.</>}>
          Give a time range, see the count first (“6 labels will reprint”), then print them with one
          press, instead of one row at a time while the line grows.
        </CapabilityCard>
        <CapabilityCard icon="badge" title="Leader name tags, remembered"
          safeguard="A leader tag never counts as a child’s check-in, anywhere."
          hood={<>Remembered leaders live in their own names-only list and are offered for 270 days, a full club year, then quietly step aside. One tap forgets a name.</>}>
          A volunteer’s tag prints from the widget, the phone or the dashboard. After the first time, their
          name comes back as a one-tap chip for the rest of the season.
        </CapabilityCard>
        <CapabilityCard icon="tag" title="A label that just says VOLUNTEER"
          safeguard="It records nothing: no history, no count, and nothing sent to the lobby screens."
          hood={<>The text sizes itself from 56pt down to a 14pt floor before it will wrap to a second line, up to 60 characters.</>}>
          One line of whatever you type, big and centered on an otherwise blank label, for a helper, a
          room sign or a snack table.
        </CapabilityCard>
        <CapabilityCard icon="family" title="A visiting family in one form"
          hood={<>Each child is still its own print through the normal duplicate-safe path, up to four per form. A blank row is dropped and a name typed twice collapses to one child. If the volunteer also chooses to register them in TwoTimTwo, the household is created once, with every child in it.</>}>
          A parent with three children at the door types the family details once and adds each child.
          Every child gets a label, and a church that uses welcome cards gets one card for the family.
        </CapabilityCard>
      </ul>

      <div className="lbl-nothere">
        <ul className="fam-cards lbl-nothere__card">
          <CapabilityCard icon="search" title="Who hasn’t arrived yet" tag="Off by default"
            hood={<>It re-reads the roster the phone page already has, leaves out anyone checked in tonight and anyone the roster marks inactive, and groups the rest by club. No new data leaves the laptop to build it.</>}>
            A third phone tab lists everyone on the roster who hasn’t been checked in yet, grouped by club,
            so a leader can call the families running late.
          </CapabilityCard>
        </ul>
        <Safeguard id="sg-not-here" title="How the “Not here” list is kept safe" items={[
          { promise: 'Off until a church turns on phone check-in', detail: 'It lives on the PIN-protected phone page, which the laptop only serves once a PIN and phone access are set.' },
          { promise: "It stays on the leader’s phone", detail: 'The list is never sent to the lobby screens or over the realtime channel.' },
          { promise: '“Not checked in yet,” never “missing”', detail: 'It only knows who has had a label printed tonight, and the page says so. It is not a headcount.' },
          { promise: 'Blank until it truly knows', detail: 'The count stays empty until the roster has actually loaded, so it can never show a confident zero.' },
        ]} />
      </div>

      <Also items={[
        { b: 'The search box is ready', rest: 'for the next name the moment a label prints.' },
        { b: 'The walk-in form asks', rest: 'whether a typed name is the child on the roster or a visitor who shares it, and never guesses.' },
        { b: 'A welcome card for first-timers', rest: "can print on a child’s very first night, if a church turns it on." },
        { b: 'Leader worksheets', rest: 'can print themselves when the meeting starts, also off until chosen.' },
        { b: 'One-tap reprints', rest: "of any single label from tonight’s list in the widget." },
        { b: "Keeps printing when the Wi-Fi doesn’t:", rest: 'the widget searches the roster saved on the laptop, so labels still print and the TwoTimTwo check-ins can be finished later.' },
        { b: '“Help, not working?”', rest: 'in the widget runs its own checks, and the dashboard has a traffic-light health view and a test label preview.' },
      ]} />
    </div>
  </section>
);

/* ── 04 ─────────────────────────────────────────────────────────────────── */
const STRIP: { spec: LabelSpec; label: string; note: string }[] = [
  {
    note: 'Birthday week, with the age',
    label: 'Recreation of a label for Ava of Sparks: a leaf at the top, and in the corner a rocket (the collectible icon), a birthday cake and the words Turning 7 this week.',
    spec: { name: 'Ava', mono: 'S', club: 'Sparks', season: 'leaf', glyphs: [
      { k: 'icon', icon: 'rocket', size: 'collectible' }, { k: 'icon', icon: 'cake', size: 'cake' }, { k: 'words', text: 'Turning 7 this week!' },
    ] },
  },
  {
    note: 'A finished handbook',
    label: 'Recreation of a label for Nora of Sparks with a black band in the bottom-left corner reading Finished Sparks Handbook, and a rocket icon in the corner.',
    spec: { name: 'Nora', mono: 'S', club: 'Sparks', season: 'leaf', glyphs: [{ k: 'icon', icon: 'rocket', size: 'collectible' }],
      lines: [{ text: 'Finished Sparks Handbook', band: true, bold: true }] },
  },
  {
    note: 'A regular, and a milestone',
    label: 'Recreation of a label for Eli of T and T with a flame and the number 6 for six club nights running, a rocket icon, and a milestone line reading: star, 10th club night tonight.',
    spec: { name: 'Eli', mono: 'T&T', club: 'T&T', season: 'leaf', glyphs: [
      { k: 'icon', icon: 'rocket', size: 'collectible' }, { k: 'count', icon: 'flame', n: 6 },
    ], lines: [{ text: '★ 10th club night tonight!' }] },
  },
  {
    note: 'A first visit',
    label: 'Recreation of a first-timer label printed white on black for Grace of Cubbies, with a VISITOR pill in the top corner, a rocket icon and a sparkle for a new face.',
    spec: { name: 'Grace', mono: 'C', club: 'Cubbies', inverted: true, pill: 'VISITOR', glyphs: [
      { k: 'icon', icon: 'rocket', size: 'collectible' }, { k: 'icon', icon: 'sparkle', size: 'small' },
    ] },
  },
  {
    note: 'A practice run: the band covers the name on purpose',
    label: 'Recreation of a rehearsal label for Leo of Sparks with a black diagonal band across it reading TEST, not a check-in.',
    spec: { name: 'Leo', mono: 'S', club: 'Sparks', test: true, glyphs: [{ k: 'icon', icon: 'rocket', size: 'collectible' }] },
  },
  {
    note: 'A free-text label',
    label: 'Recreation of a blank label with one word, VOLUNTEER, printed large and centered.',
    spec: { name: 'VOLUNTEER', custom: true },
  },
];

const LabelDelight: React.FC = () => (
  <section className="fam-chapter" id="label-delight" aria-labelledby="label-delight-title">
    <div className="fam-wrap">
      <ChapterHead num="04" kicker="Chapter four" title="Label delight" titleId="label-delight-title"
        standfirst="Small touches that make a label something a child notices, and looks for next week."
        intro="None of these can push an allergy icon or the no-photo camera out of its place: those always hold the right-hand end of the row. When a label gets crowded, the birthday words shorten and the season picture steps aside first." />

      <figure className="fam-frame lbl-figure">
        <div className="lbl-strip lbl-stage">
          {STRIP.map(s => (
            <div className="lbl-strip__item" key={s.note}>
              <LabelOnLiner spec={s.spec} label={s.label} />
              <p className="lbl-strip__note" aria-hidden="true">{s.note}</p>
            </div>
          ))}
        </div>
        <Caption fig="Fig. 6" names>Six labels from one printer. Book titles on the trophy band come from TwoTimTwo’s own report.</Caption>
      </figure>

      <ul className="fam-cards">
        <CapabilityCard icon="star" title="A collectible icon every week"
          hood={<>Twelve line-art icons on a weekly cycle that turns over at local Monday midnight, so the icon never changes during club and a same-week reprint matches. On by default; a church can switch it off.</>}>
          Each label carries a small hand-drawn icon, a rocket, a kite, a snail, that changes every week,
          so a season of club nights becomes a little collection.
        </CapabilityCard>
        <CapabilityCard icon="leaf" title="The label wears the season"
          hood={<>Eight seasons tile the calendar with no gaps, with Easter worked out for each year. An operator can pin a season or turn the art off, and a crowded label skips the motif to keep its ink for the name.</>}>
          A small picture at the top of the label, a pencil, a leaf, a snowflake, a tulip, changes on its
          own through the year, Easter included.
        </CapabilityCard>
        <CapabilityCard icon="cake" title="A birthday cake that says the age"
          safeguard="A summer birthday gets its cake on the half-birthday, inside the club year, and that cake prints without an age."
          hood={<>The age comes from the same birth year that places the cake, so the two can never disagree. A missing or odd birth year prints the plain cake, never a wrong number.</>}>
          “Turning 7 this week!” prints beside the cake, so every leader who reads the badge can greet the
          exact age.
        </CapabilityCard>
        <CapabilityCard icon="trophy" title="A trophy band for a finished handbook"
          hood={<>It reads TwoTimTwo’s own completed-books report during club, prints once per child per night, and never delays a label. A church can turn it off in Settings.</>}>
          Finishing a whole handbook is one of the big moments of a child’s club year. The next label
          carries a bold band that says so, and the whole room can read it.
        </CapabilityCard>
        <CapabilityCard icon="flame" title="A flame for regulars, a sparkle for new faces"
          hood={<>Streaks count real club nights from the attendance record, so a holiday break never breaks one. Milestones such as “10th club night tonight!” print in the corner too, at 5, 10, 25 and 50 nights.</>}>
          A child who has come six club nights running gets a small flame with their streak. A brand-new
          child gets a sparkle for their first two weeks, so leaders learn new names faster.
        </CapabilityCard>
        <CapabilityCard icon="music" title="The printer that plays a tune" tag="Off by default"
          safeguard="A tune that fails is quietly skipped, and the label always prints."
          hood={<>Melodies are sent to the printer as speed-and-feed steps for its motor, rotating through three tunes on printers that support it. The birthday tune is kept out of that rotation, so hearing it always means something. A burst reprint stays quiet.</>}>
          With one setting on, the label printer plays a short melody just before each label, and a
          birthday child’s label plays the opening of “Happy Birthday” instead.
        </CapabilityCard>
      </ul>

      <Also items={[
        { b: 'Per-club label templates:', rest: 'each club can show or hide parts of the label and cap the name size, with a live preview.' },
        { b: 'An optional footer line', rest: 'with a church name, a verse or service times along the bottom of the label.' },
        { b: 'Visitors stand out:', rest: 'a label printed for a visitor comes out white on black, so it pops out of the stack (a church can switch this off).' },
        { b: 'Step-up labels', rest: 'print in reverse and announce the club a graduating child is moving up to.' },
        { b: 'Store night shares', rest: "can print as a coin with the child’s balance, from TwoTimTwo." },
        { b: 'Handbook groups, and “Go to” lines for late arrivals,', rest: 'send a child to the right table or room.' },
        { b: 'The TEST band', rest: 'marks any practice or demo label so it can never pass for a real check-in.' },
      ]} />
    </div>
  </section>
);

export const Showcase: React.FC = () => (
  <>
    <ChapterIndex />
    <RunsTheRoom />
    <Accuracy />
    <NightOf />
    <LabelDelight />
  </>
);
