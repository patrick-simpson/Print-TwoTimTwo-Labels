import React from 'react';
import { Icon } from './family/Icons';
import { Caption } from './family/Family';
import { LabelOnLiner, LabelSpec } from './Mocks';

// The everyday label, as generateLabel() draws it for a Sparks child with a
// birthday this week, a nut allergy and a "no photos" answer. With a peanut
// and a camera on the row, the age words take the renderer's short form
// ("Turning 7!") so the safety icons keep their places.
const HERO_LABEL: LabelSpec = {
  name: 'Micah',
  mono: 'S',
  club: 'Sparks',
  season: 'leaf',
  glyphs: [
    { k: 'icon', icon: 'star', size: 'collectible' },
    { k: 'icon', icon: 'cake', size: 'cake' },
    { k: 'words', text: 'Turning 7!' },
    { k: 'icon', icon: 'peanut', size: 'allergy' },
    { k: 'icon', icon: 'nocam', size: 'allergy' },
  ],
};

export const Hero: React.FC = () => (
  <section className="fam-hero" aria-labelledby="hero-title">
    <div className="fam-wrap fam-hero__inner">
      <div>
        <p className="fam-kicker">For the check-in table</p>
        <h1 className="fam-hero__title" id="hero-title">Every child, <em>greeted by&nbsp;name.</em></h1>
        <p className="fam-hero__lede">
          The moment a child is checked in on TwoTimTwo.com, a name label prints by itself, carrying
          the allergy, the birthday and the photo wishes a leader needs to see at a glance.
        </p>
        <div className="fam-actions">
          <a className="fam-btn" href="#features">See what it does <Icon name="arrow" /></a>
          <a className="fam-btn fam-btn--ghost" href="#install"><Icon name="download" />Install it</a>
        </div>
        <ul className="fam-hero__facts">
          <li><Icon name="check" />Free for any church</li>
          <li><Icon name="check" />Windows app + Chrome extension</li>
          <li><Icon name="check" />Made at Kennebec Valley Baptist Church</li>
        </ul>
      </div>

      <figure className="fam-frame fam-frame--label">
        <div className="fam-frame__stage">
          <LabelOnLiner spec={HERO_LABEL}
            label="Recreation of a 4 by 2 inch check-in label: a round S monogram for Sparks in a grey panel on the left; a small leaf at the top; the first name Micah in large bold type with Sparks beneath it; and along the bottom right, a star (this week’s collectible icon), a birthday cake with the words Turning 7, a peanut for a nut allergy, and a crossed-out camera meaning no photos." />
        </div>
        <Caption fig="Fig. 1" names>
          The 4×2 label, as the printer draws it: a first name you can read across a room, and the
          allergy, birthday and photo wishes in the corner where every leader knows to look. The
          printed label also carries the last name, left off here. The club appears here as the
          printer’s monogram badge; on the printed label it may carry the club’s own artwork.
        </Caption>
      </figure>
    </div>
  </section>
);

export const Stats: React.FC = () => (
  <section className="fam-stats" aria-label="At a glance">
    <div className="fam-wrap">
      <ul className="fam-stats__list">
        <li className="fam-stat"><div className="fam-stat__num">0<span className="fam-stat__unit">clicks</span></div><p className="fam-stat__label">per label. Check a child in and the printer takes it from there.</p></li>
        <li className="fam-stat"><div className="fam-stat__num">4×2<span className="fam-stat__unit">inches</span></div><p className="fam-stat__label">a thermal label drawn at 300 dots per inch.</p></li>
        <li className="fam-stat"><div className="fam-stat__num">12<span className="fam-stat__unit">icons</span></div><p className="fam-stat__label">in the collectible series, a new one each week.</p></li>
        <li className="fam-stat"><div className="fam-stat__num">1<span className="fam-stat__unit">passphrase</span></div><p className="fam-stat__label">logs in a new lobby screen, once display login is set up.</p></li>
      </ul>
    </div>
  </section>
);
