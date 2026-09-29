import React from 'react';
import { Icon, IconName } from './family/Icons';

/* ───────────────────────────────────────────────────────────────────────────
   Hand-built CSS recreations. No screenshots, no club art, no logos.

   The label recreation follows generateLabel() in print-server/server.js:
   a 288×144pt page drawn at 300 dpi, a 6pt inset badge with 12pt corners and
   no outline, an 84pt icon panel (#f4f4f4) with a 0.5pt divider, a 28pt-radius
   monogram disc when there is no club art, the name block centred in the text
   zone above a reserved bottom band, a ~12pt seasonal motif top-centre, the
   icon row right-anchored on the bottom padding line (collectible, coin,
   flame, sparkle, cake + age words, allergies, no-photo camera — in that
   order), the bottom-left stack (trophy band, "Go to", milestone, footer) at
   10pt on 13pt steps, and the -10° TEST band. Page CSS converts points to cqi
   (1pt = 100/288 cqi) so every mock keeps the real proportions at any width.
   ─────────────────────────────────────────────────────────────────────────── */

export type LabelGlyph =
  | { k: 'icon'; icon: IconName; size: 'allergy' | 'cake' | 'small' | 'collectible' }
  | { k: 'count'; icon: IconName; n: number }
  | { k: 'words'; text: string };

export interface LabelSpec {
  name: string;
  mono?: string;            // club monogram (no club art is ever drawn)
  club?: string;            // club line, plain text
  group?: string;           // handbook-group line
  season?: IconName;        // top-centre motif
  pill?: 'VISITOR' | 'LEADER';
  glyphs?: LabelGlyph[];
  lines?: { text: string; band?: boolean; bold?: boolean; italic?: boolean }[];
  test?: boolean;
  inverted?: boolean;
  custom?: boolean;         // a free-text label: one centred line, nothing else
}

export const LabelArt: React.FC<{ spec: LabelSpec }> = ({ spec }) => {
  if (spec.custom) {
    return (
      <div className="lbl-label lbl-label--custom">
        <span className="lbl-label__custom">{spec.name}</span>
      </div>
    );
  }
  const glyphs = spec.glyphs || [];
  const lines = spec.lines || [];
  // generateLabel's bottom-band reservation: 20pt for the icon row, or
  // 7pt + 13pt per bottom-left line, whichever is taller.
  const bandPt = Math.max(glyphs.length ? 20 : 0, lines.length ? 7 + lines.length * 13 : 0);
  const hasPanel = !!spec.mono;
  const style = { ['--lbl-band' as string]: `${(bandPt * 100) / 288}cqi` } as React.CSSProperties;
  return (
    <div className={`lbl-label${spec.inverted ? ' lbl-label--inverted' : ''}${hasPanel ? '' : ' lbl-label--nopanel'}`} style={style}>
      {hasPanel && (
        <div className="lbl-label__panel"><span className="lbl-label__mono" data-long={spec.mono && spec.mono.length > 1 ? '' : undefined}>{spec.mono}</span></div>
      )}
      <div className="lbl-label__text">
        {spec.season && <Icon name={spec.season} className="lbl-label__season" />}
        <div className="lbl-label__name">{spec.name}</div>
        {spec.club && <div className="lbl-label__club">{spec.club}</div>}
        {spec.group && <div className="lbl-label__group">{spec.group}</div>}
      </div>
      {spec.pill && <span className="lbl-label__pill">{spec.pill}</span>}
      {glyphs.length > 0 && (
        <div className="lbl-label__row">
          {glyphs.map((g, i) => {
            if (g.k === 'words') return <span key={i} className="lbl-label__words">{g.text}</span>;
            if (g.k === 'count') return <span key={i} className="lbl-label__count"><Icon name={g.icon} className="lbl-g lbl-g--small" />{g.n}</span>;
            return <Icon key={i} name={g.icon} className={`lbl-g lbl-g--${g.size}`} />;
          })}
        </div>
      )}
      {lines.length > 0 && (
        <div className="lbl-label__lines">
          {lines.map(l => (
            <span key={l.text} className={`lbl-label__line${l.band ? ' lbl-label__line--band' : ''}${l.bold ? ' lbl-label__line--bold' : ''}${l.italic ? ' lbl-label__line--italic' : ''}`}>{l.text}</span>
          ))}
        </div>
      )}
      {spec.test && <div className="lbl-label__test"><span>TEST — NOT A CHECK-IN</span></div>}
    </div>
  );
};

/** One physical label on its backing sheet, as a labelled image. */
export const LabelOnLiner: React.FC<{ spec: LabelSpec; label: string; className?: string }> = ({ spec, label, className }) => (
  <div className={`fam-frame__liner${className ? ' ' + className : ''}`}>
    <div className="fam-frame__screen fam-label-paper" role="img" aria-label={label}>
      <LabelArt spec={spec} />
    </div>
  </div>
);

/* ── Phone: the Tonight tab ─────────────────────────────────────────────── */
export const PhoneTonight: React.FC = () => (
  <div className="fam-frame__screen lbl-phone" role="img"
    aria-label="Recreation of the phone page’s Tonight tab: three tabs (Check in, Tonight, Not here), a line reading 31 checked in tonight, club chips for Cubbies, Sparks and T&T, a green line saying Matches TwoTimTwo, and a list of children by first name, Micah, Ava, Eli and Nora, each with a Remove button.">
    <div className="lbl-phone__body">
      <div className="lbl-phone__tabs"><span>Check in</span><span className="is-on">Tonight (31)</span><span>Not here</span></div>
      <div className="lbl-phone__total">31 checked in tonight</div>
      <div className="lbl-phone__chips"><span>Cubbies 8</span><span>Sparks 12</span><span>T&amp;T 11</span></div>
      <div className="lbl-phone__check"><Icon name="check" />Matches TwoTimTwo (31)</div>
      {[['Micah', 'Sparks'], ['Ava', 'Cubbies'], ['Eli', 'T&T'], ['Nora', 'Sparks']].map(([n, c]) => (
        <div key={n} className="lbl-phone__row"><span><b>{n}</b><small>{c}</small></span><span className="lbl-phone__btn">Remove</span></div>
      ))}
    </div>
  </div>
);

/* ── Dashboard windows (the print server's own dashboard, recreated) ───── */
export const DashWindow: React.FC<{ title: string; label: string; children: React.ReactNode; className?: string }> = ({ title, label, children, className }) => (
  <div className={`lbl-window${className ? ' ' + className : ''}`} role="img" aria-label={label}>
    <div className="lbl-window__bar"><span></span><span></span><span></span><b>{title}</b></div>
    <div className="lbl-window__body">{children}</div>
  </div>
);

export const JamAlarm: React.FC = () => (
  <DashWindow title="Dashboard"
    label="Recreation of the dashboard during a paper jam: a red status light reading Problem Detected, check the warnings below for details. Below it, a warning: 4 print jobs are waiting on Label Printer, oldest 3 minutes 12 seconds, status PaperOut. Labels are not coming out; check paper and power, then clear the queue on the Diagnostics tab. Beside it, the Clear print queue button from the Diagnostics tab.">
    <div className="lbl-status lbl-status--red">
      <span className="lbl-dot" />
      <div><b>Problem Detected</b><span>Check the warnings below for details.</span></div>
    </div>
    <div className="lbl-warnbox">
      <p className="lbl-warnbox__head">Warnings</p>
      <p>4 print jobs are waiting on “Label Printer” (oldest 3m 12s, status: PaperOut). Labels are NOT coming out — check paper and power, then clear the queue on the Diagnostics tab.</p>
    </div>
    <div className="lbl-window__actions"><span className="lbl-uibtn lbl-uibtn--secondary">Clear print queue</span><span className="lbl-window__where">on the Diagnostics tab</span></div>
  </DashWindow>
);

export const CountCheck: React.FC = () => (
  <div className="lbl-countcheck lbl-stage">
    <DashWindow title="Dashboard · Tonight at a Glance"
      label="Recreation of the dashboard’s Tonight at a Glance card when the counts agree: 31 checked in, 31 labels printed, from TwoTimTwo’s report; club chips for Cubbies 8, Sparks 12 and T and T 11; and a green line: Matches TwoTimTwo, 31 checked in.">
      <div className="lbl-tonight"><span className="lbl-tonight__num">31</span><span className="lbl-tonight__lab">checked in tonight</span></div>
      <p className="lbl-window__note">31 labels printed · from TwoTimTwo’s report</p>
      <ClubChips />
      <p className="lbl-verdict lbl-verdict--ok"><Icon name="check" /><span>Matches TwoTimTwo (31 checked in)</span></p>
    </DashWindow>
    <DashWindow title="Dashboard · Tonight at a Glance"
      label="Recreation of the same card when one child has no label: still 31 checked in, from TwoTimTwo’s report, with 30 labels printed; and a red line reading TwoTimTwo 31, printed 30, 1 with no label printed, with Sparks minus 1 on the line below.">
      <div className="lbl-tonight"><span className="lbl-tonight__num">31</span><span className="lbl-tonight__lab">checked in tonight</span></div>
      <p className="lbl-window__note">30 labels printed · from TwoTimTwo’s report</p>
      <ClubChips />
      <p className="lbl-verdict lbl-verdict--short"><Icon name="alarm" /><span><b>TwoTimTwo 31 · printed 30</b> — 1 with no label printed<small>Sparks −1</small></span></p>
    </DashWindow>
  </div>
);

const ClubChips: React.FC = () => (
  <div className="lbl-clubchips"><span>Cubbies <b>8</b></span><span>Sparks <b>12</b></span><span>T&amp;T <b>11</b></span></div>
);

/* ── Lobby slides: publish once at the laptop, every screen shows it ──────
   The left window is Check-in Display's own slide editor (Settings → Edit
   slides), open in a browser on the check-in laptop: its "Publish to all
   displays" button posts the deck to the print server there, which seals
   it and sends it to every screen (the printer dashboard's Lobby Slides
   card is the paste-a-file route to the same pipe). The TV is a typed slide
   in the display's 2026-27 look: the "night" catalog scene, a Londrina
   Solid eyebrow, a Paytone One headline and the house wave (CatalogScene.jsx,
   app.css .manual-slide-*). No logo, no club art. */
const WAVE = 'M0 190 C220 80 420 80 640 160 C880 250 1120 250 1330 150 C1430 105 1530 100 1600 130 L1600 420 L0 420 Z';

export const LobbyPublish: React.FC = () => (
  <div className="lbl-publish lbl-stage">
    <DashWindow title="Check-in Display · Edit slides" className="lbl-publish__dash"
      label="Recreation of Check-in Display’s slide editor, open on the check-in laptop: three typed slides (Bring a friend night, Store night next week, and Pick-up is at the side door tonight, which is marked Hold check-ins), a Publish to all displays button, and a note: Published rev 4, 3 slides.">
      <ol className="lbl-slidelist">
        <li>Bring a friend night</li>
        <li>Store night next week</li>
        <li><span>Pick-up is at the side door tonight</span><em className="lbl-slidelist__hold">Hold check-ins</em></li>
      </ol>
      <div className="lbl-window__actions"><span className="lbl-uibtn">Publish to all displays</span><span className="lbl-window__ok"><Icon name="check" />Published rev 4 (3 slides)</span></div>
    </DashWindow>
    <span className="lbl-publish__arrow" aria-hidden="true"><Icon name="arrow" /></span>
    <div className="fam-frame fam-frame--tv lbl-publish__tv" data-accent="checkin">
      <div className="fam-frame__stage">
        <div className="fam-frame__screen lbl-lobby" role="img" aria-label="Recreation of a lobby TV showing the first slide on a night-blue sky above an orange wave: Next Wednesday, Bring a friend night, Every friend is welcome at club.">
          <svg className="lbl-lobby__doodles" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <g fill="none" stroke="#b9d5ec" strokeLinecap="round" strokeLinejoin="round" opacity=".7">
              <path d="M120 180 C160 120 210 120 250 170" strokeWidth="6" />
              <path d="M1370 210 C1400 170 1450 170 1480 205" strokeWidth="6" />
            </g>
            <g fill="#ffd98a" opacity=".85">
              <path d="M480 100 c3 18 13 28 31 31 c-18 3 -28 13 -31 31 c-3 -18 -13 -28 -31 -31 c18 -3 28 -13 31 -31z" />
              <path d="M1180 110 c4 22 16 34 38 38 c-22 4 -34 16 -38 38 c-4 -22 -16 -34 -38 -38 c22 -4 34 -16 38 -38z" />
              <circle cx="340" cy="120" r="7" /><circle cx="940" cy="80" r="6" /><circle cx="1300" cy="470" r="8" />
            </g>
          </svg>
          <svg className="lbl-lobby__wave lbl-lobby__wave--back" viewBox="0 0 1600 420" preserveAspectRatio="none" aria-hidden="true"><path fill="#FFB81C" opacity=".4" d={WAVE} /></svg>
          <svg className="lbl-lobby__wave" viewBox="0 0 1600 420" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="lbl-lobby-wave" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFB81C" /><stop offset="1" stopColor="#F26B21" /></linearGradient></defs>
            <path fill="url(#lbl-lobby-wave)" d={WAVE} />
          </svg>
          <div className="lbl-lobby__copy">
            <span className="lbl-lobby__eyebrow">Next Wednesday</span>
            <p className="lbl-lobby__big">Bring a friend night</p>
            <p className="lbl-lobby__sub">Every friend is welcome at club.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
);
