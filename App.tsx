import React from 'react';
import { IconSprite } from './components/family/Icons';
import { FamilyFooter, FamilyHeader } from './components/family/Family';
import { Hero, Stats } from './components/Hero';
import { Showcase } from './components/Showcase';
import { FamilyBand, HowItWorks } from './components/Features';
import { Simulator } from './components/Simulator';
import { InstallGuide } from './components/InstallGuide';
import { Faq } from './components/Faq';

// Section order (leadership first, then the people who run it):
// hero → stats → showcase (#features: chapter index + four chapters) →
// the whole club night → #how-it-works → #simulator → #install → #faq.
// Old hash links (#how-it-works, #features, #install, #simulator, #faq) all
// still land on a sensible section.
const SUB_LINKS = [
  { href: '#features', label: 'Showcase' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#simulator', label: 'Try it' },
  { href: '#install', label: 'Install' },
  { href: '#faq', label: 'FAQ' },
  { href: './capabilities.html', label: 'TwoTimTwo reference' },
];

const App: React.FC = () => (
  <>
    <a className="fam-skip" href="#main">Skip to the content</a>
    <IconSprite />
    <FamilyHeader subLinks={SUB_LINKS} subLabel="On this page" />
    <main id="main">
      <Hero />
      <Stats />
      <Showcase />
      <FamilyBand />
      <HowItWorks />
      <Simulator />
      <InstallGuide />
      <Faq />
    </main>
    <FamilyFooter />
  </>
);

export default App;
