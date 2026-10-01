import React from 'react';
import { Icon, IconName } from './Icons';

/**
 * Thin JSX wrappers that emit exactly the family design system's markup
 * (FAMILY.md §4). Class names are the family's own `fam-*` classes; nothing
 * here re-expresses them as utilities, so this site cannot drift from the two
 * static about pages that share family.css.
 */

export const URLS = {
  labels: 'https://awana.kvbchurch.org/',
  checkin: 'https://awana.kvbchurch.org/lobby/about.html',
  journey: 'https://awana.kvbchurch.org/journey/about.html',
  srcLabels: 'https://github.com/patrick-simpson/kvbcawana/tree/main/printer',
  srcCheckin: 'https://github.com/patrick-simpson/kvbcawana/tree/main/lobby',
  srcJourney: 'https://github.com/patrick-simpson/kvbcawana/tree/main/journey',
} as const;

export interface SubLink { href: string; label: string; current?: boolean }

/** Disclaimer bar + family nav, plus this site's own "on this page" row. */
/**
 * `productCurrent` is 'page' on the home page, where the Club Label Printer
 * link IS this page, and 'true' on capabilities.html, where it only marks the
 * current product (the sub-nav's own link carries aria-current="page" there).
 */
export const FamilyHeader: React.FC<{ subLinks: SubLink[]; subLabel: string; productCurrent?: 'page' | 'true' }> = ({ subLinks, subLabel, productCurrent = 'page' }) => (
  <header className="fam-header">
    <p className="fam-disclaimer" role="note">
      <strong>Not affiliated with or endorsed by Awana<sup>®</sup> Clubs International.</strong>{' '}
      <span className="fam-disclaimer__aside">Independent tools made by a local church for its own club nights.</span>
    </p>
    <nav className="fam-nav" aria-label="Club night tools">
      <div className="fam-wrap fam-nav__inner">
        <a className="fam-brand" href={URLS.labels}>
          <span className="fam-brand__mark"><Icon name="tag" /></span>
          <span><span className="fam-brand__name">Club Label Printer</span><span className="fam-brand__sub">One of three club-night tools</span></span>
        </a>
        <ul className="fam-nav__list">
          <li><a className="fam-nav__link" data-accent="labels" href={URLS.labels} aria-current={productCurrent}><span className="fam-swatch" aria-hidden="true"></span><span className="fam-nav__long">Club Label Printer</span><span className="fam-nav__short" aria-hidden="true">Labels</span></a></li>
          <li><a className="fam-nav__link" data-accent="checkin" href={URLS.checkin}><span className="fam-swatch" aria-hidden="true"></span><span className="fam-nav__long">Check-in Display</span><span className="fam-nav__short" aria-hidden="true">Check-in</span></a></li>
          <li><a className="fam-nav__link" data-accent="journey" href={URLS.journey}><span className="fam-swatch" aria-hidden="true"></span><span className="fam-nav__long">Journey Display</span><span className="fam-nav__short" aria-hidden="true">Journey</span></a></li>
        </ul>
      </div>
    </nav>
    <nav className="lbl-subnav" aria-label={subLabel}>
      <ul className="fam-wrap lbl-subnav__list">
        {subLinks.map(l => (
          <li key={l.href}>
            <a className="lbl-subnav__link" href={l.href} aria-current={l.current ? 'page' : undefined}>{l.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  </header>
);

export const FamilyFooter: React.FC = () => (
  <footer className="fam-footer">
    <div className="fam-wrap">
      <div className="fam-footer__grid">
        <p className="fam-footer__credit">Built by and for <em>Kennebec Valley Baptist Church</em>, so every child is welcomed by name.</p>
        <div>
          <h2 className="fam-footer__heading">The family</h2>
          <ul className="fam-footer__list">
            <li data-accent="labels"><a href={URLS.labels}><span className="fam-swatch" aria-hidden="true"></span>Club Label Printer</a></li>
            <li data-accent="checkin"><a href={URLS.checkin}><span className="fam-swatch" aria-hidden="true"></span>Check-in Display</a></li>
            <li data-accent="journey"><a href={URLS.journey}><span className="fam-swatch" aria-hidden="true"></span>Journey Display</a></li>
          </ul>
        </div>
        <div>
          <h2 className="fam-footer__heading">Source</h2>
          <ul className="fam-footer__list">
            <li><a href={URLS.srcLabels}>Club Label Printer on GitHub</a></li>
            <li><a href={URLS.srcCheckin}>Check-in Display on GitHub</a></li>
            <li><a href={URLS.srcJourney}>Journey Display on GitHub</a></li>
          </ul>
        </div>
      </div>
      <div className="fam-footer__legal">
        <p><strong>NOT AFFILIATED WITH OR ENDORSED BY AWANA CLUBS INTERNATIONAL.</strong></p>
        <p>Awana® and the names of its clubs and curricula are trademarks of Awana Clubs International, used here only to describe what these tools work alongside. Club Label Printer, Check-in Display and Journey Display are independent projects made by volunteers at Kennebec Valley Baptist Church; they are not sponsored, reviewed or approved by Awana Clubs International. No Awana logos or artwork appear on this page. TwoTimTwo is a separate service, named here only to describe compatibility.</p>
        <p>Screens and labels on this page are hand-drawn recreations. Children’s names are examples.</p>
      </div>
    </div>
  </footer>
);

/** "Peek under the hood": closed by default (FAMILY.md §4.5). */
export const Hood: React.FC<{ children: React.ReactNode; about?: string }> = ({ children, about }) => (
  <details className="fam-hood">
    <summary><svg className="fam-hood__chev" aria-hidden="true" focusable="false"><use href="#i-chev" /></svg>Peek under the hood{about && <span className="fam-sr">: {about}</span>}</summary>
    <div className="fam-hood__body">{children}</div>
  </details>
);

export interface CardProps {
  icon: IconName;
  title: string;
  children: React.ReactNode;       // the plain-language sentence(s)
  hood?: React.ReactNode;
  tag?: string;                    // opt-in / off-by-default marker
  safeguard?: React.ReactNode;     // one-line promise shown under the body
  demo?: React.ReactNode;
}

export const CapabilityCard: React.FC<CardProps> = ({ icon, title, children, hood, tag, safeguard, demo }) => (
  <li className="fam-card">
    <span className="fam-card__icon"><Icon name={icon} /></span>
    <h3 className="fam-card__title">{title}</h3>
    <p className="fam-card__body">{children}</p>
    {safeguard && (
      <p className="lbl-card-guard"><Icon name="shield" className="lbl-card-guard__icon" /><span>{safeguard}</span></p>
    )}
    {demo && <div className="fam-card__demo" aria-hidden="true">{demo}</div>}
    {tag && <span className="fam-card__tag">{tag}</span>}
    {hood && <Hood about={title}>{hood}</Hood>}
  </li>
);

export interface SafeguardItem { promise: string; detail: string }

export const Safeguard: React.FC<{ id: string; title: string; items: SafeguardItem[] }> = ({ id, title, items }) => (
  <aside className="fam-safeguard" aria-labelledby={id}>
    <div className="fam-safeguard__head"><Icon name="shield" /><h3 className="fam-safeguard__title" id={id}>{title}</h3></div>
    <ul className="fam-safeguard__list">
      {items.map(it => (
        <li key={it.promise}>
          <span className="fam-safeguard__check"><Icon name="check" /></span>
          <div><b>{it.promise}</b><span>{it.detail}</span></div>
        </li>
      ))}
    </ul>
  </aside>
);

export const Also: React.FC<{ items: { b: string; rest: string }[] }> = ({ items }) => (
  <div className="fam-also">
    <h3 className="fam-also__title">Smaller things worth knowing</h3>
    <ul className="fam-also__list">
      {items.map(it => <li key={it.b}><b>{it.b}</b> {it.rest}</li>)}
    </ul>
  </div>
);

export const ChapterHead: React.FC<{
  num: string; kicker: string; title: string; titleId: string; standfirst: string; intro: string;
}> = ({ num, kicker, title, titleId, standfirst, intro }) => (
  <div className="fam-chapter__head">
    <div>
      <div className="fam-chapter__num" aria-hidden="true">{num}</div>
      <p className="fam-kicker">{kicker}</p>
      <h2 className="fam-chapter__title" id={titleId}>{title}</h2>
    </div>
    <div>
      <p className="fam-standfirst">{standfirst}</p>
      <p className="fam-chapter__intro">{intro}</p>
    </div>
  </div>
);

/** Figure caption with the mandatory "Recreated for illustration" line. */
export const Caption: React.FC<{ fig: string; children: React.ReactNode; names?: boolean }> = ({ fig, children, names }) => (
  <figcaption className="fam-frame__caption">
    <b>{fig}</b> {children}
    <span className="fam-frame__recreated">Recreated for illustration.{names ? ' Names are examples.' : ''}</span>
  </figcaption>
);
