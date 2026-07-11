import React from 'react';
import { Nav } from './components/Nav';
import { Hero } from './components/Hero';
import { HowItWorks, Features } from './components/Features';
import { InstallGuide } from './components/InstallGuide';
import { Simulator } from './components/Simulator';
import { Faq, Footer } from './components/Faq';

const App: React.FC = () => (
  <div className="min-h-screen flex flex-col">
    <Nav />
    <main className="flex-1">
      <Hero />
      <HowItWorks />
      <Features />
      <InstallGuide />
      <Simulator />
      <Faq />
    </main>
    <Footer />
  </div>
);

export default App;
