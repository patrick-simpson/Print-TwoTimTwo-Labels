import React from 'react';
import { Icon, IconName } from './family/Icons';
import { URLS } from './family/Family';

/* ── The whole club night: the family band (FAMILY.md §4.8) ─────────────── */
export const FamilyBand: React.FC = () => (
  <section className="fam-band" aria-labelledby="band-title">
    <div className="fam-wrap">
      <div className="fam-band__head">
        <p className="fam-kicker">A family of three</p>
        <h2 className="fam-band__title" id="band-title">The whole <em>club night</em></h2>
        <p className="fam-band__lede">
          Three small tools, one evening. Each hands the child along to the next, so the welcome at the door
          carries all the way to the lesson.
        </p>
      </div>
      <ol className="fam-route">
        <li className="fam-route__stop" data-accent="labels"><span className="fam-route__pin" aria-hidden="true"></span><div className="fam-route__step">Checked in</div><div className="fam-route__when">on TwoTimTwo.com</div></li>
        <li className="fam-route__stop" data-accent="labels"><span className="fam-route__pin" aria-hidden="true"></span><div className="fam-route__step">Label prints</div><div className="fam-route__when">at the door</div></li>
        <li className="fam-route__stop" data-accent="checkin"><span className="fam-route__pin" aria-hidden="true"></span><div className="fam-route__step">Lobby says hello</div><div className="fam-route__when">by first name</div></li>
        <li className="fam-route__stop" data-accent="journey"><span className="fam-route__pin" aria-hidden="true"></span><div className="fam-route__step">Lesson begins</div><div className="fam-route__when">6:30, large group</div></li>
      </ol>
      <ul className="fam-products">
        <li className="fam-product" data-accent="labels">
          <div className="fam-product__head">
            <div className="fam-product__meta"><span>At the door</span><span className="fam-product__here">You are here</span></div>
            <h3 className="fam-product__name">Club Label Printer</h3>
          </div>
          <div className="fam-product__body">
            <p>Prints a name label for every child the moment they are checked in, with the safety details a leader needs.</p>
            <ul className="fam-product__points"><li>Allergy, birthday and photo wishes</li><li>A phone page for the night-of team</li></ul>
            <p className="fam-product__note">You are reading this one.</p>
          </div>
        </li>
        <li className="fam-product" data-accent="checkin">
          <div className="fam-product__head">
            <div className="fam-product__meta"><span>In the lobby</span></div>
            <h3 className="fam-product__name">Check-in Display</h3>
          </div>
          <div className="fam-product__body">
            <p>The lobby TV welcomes each child by first name, and the projector keeps the evening on schedule.</p>
            <ul className="fam-product__points"><li>Birthdays and celebrations</li><li>A countdown and game timers</li></ul>
            <a className="fam-product__link" href={URLS.checkin}><span>About Check-in Display</span><Icon name="arrow" /></a>
          </div>
        </li>
        <li className="fam-product" data-accent="journey">
          <div className="fam-product__head">
            <div className="fam-product__meta"><span>At large group</span></div>
            <h3 className="fam-product__name">Journey Display</h3>
          </div>
          <div className="fam-product__body">
            <p>A small kiosk shows the Check-in Display by day and, at 6:30, has tonight’s lesson ready for a leader to start, with captions and teaching slides.</p>
            <ul className="fam-product__points"><li>Runs on a tiny, older computer</li><li>Tonight’s lesson is saved ahead of time</li></ul>
            <a className="fam-product__link" href={URLS.journey}><span>About Journey Display</span><Icon name="arrow" /></a>
          </div>
        </li>
      </ul>
    </div>
  </section>
);

/* ── How it works: the three pieces, for the team that sets it up ───────── */
const STEPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'printer',
    title: 'Install the Windows app',
    body: 'One installer puts Club Label Printer in the system tray. It starts with the PC, runs the print server on that laptop, and updates itself.',
  },
  {
    icon: 'puzzle',
    title: 'Load the Chrome extension once',
    body: 'A small Club Print widget appears on your TwoTimTwo check-in page. It notices check-ins made at this station and on other devices.',
  },
  {
    icon: 'tag',
    title: 'Labels print themselves',
    body: "Every check-in prints a 4×2 label with the child’s name, club and safety icons. No dialogs and no clicks.",
  },
];

export const HowItWorks: React.FC = () => (
  <section id="how-it-works" className="lbl-part" aria-labelledby="how-title">
    <div className="fam-wrap">
      <div className="lbl-part__head">
        <p className="fam-kicker">For volunteers and other churches</p>
        <h2 className="lbl-part__title" id="how-title">How it works</h2>
        <p className="lbl-part__lede">
          Three pieces and a few minutes of setup. Everything below is for the people who will run it:
          try the check-in page, install it on a Windows laptop, and read the questions volunteers ask.
        </p>
      </div>
      <ol className="lbl-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="lbl-steps__item">
            <span className="lbl-steps__num" aria-hidden="true">{i + 1}</span>
            <span className="fam-card__icon"><Icon name={s.icon} /></span>
            <h3 className="lbl-steps__title">{s.title}</h3>
            <p className="lbl-steps__body">{s.body}</p>
          </li>
        ))}
      </ol>
    </div>
  </section>
);
