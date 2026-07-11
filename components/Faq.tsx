import React from 'react';
import { SERVER_VERSION } from '../src/constants';

const QA = [
  {
    q: 'What do I need to buy?',
    a: 'Just a thermal label printer (any brand Windows can print to) and 4×2 inch direct-thermal labels. The software is free and open source; no subscriptions.',
  },
  {
    q: 'Can it print the same child twice by accident?',
    a: 'No — the server suppresses duplicate prints of the same name within a 25-second window, so retries, double-taps and overlapping detection paths produce exactly one label. Deliberate reprints from the widget or dashboard always work.',
  },
  {
    q: 'What happens if the Wi-Fi goes down mid-event?',
    a: 'Labels keep printing. The roster is cached on the print server and in the extension, prints queue while the server is briefly unreachable, and the widget search works from the cached roster — you can keep printing labels and do the TwoTimTwo check-ins when the connection returns.',
  },
  {
    q: 'How do updates work?',
    a: 'The desktop shortcut checks for a new version every time it launches and updates itself. If a new version ships mid-season, the widget and dashboard show an "Update now" button — one click restarts the server on the latest version.',
  },
  {
    q: 'Where does the allergy and birthday data come from?',
    a: 'From your own TwoTimTwo roster: the extension syncs it to the print server automatically using your logged-in session. Nothing is sent anywhere except your own computer — the server runs entirely on localhost.',
  },
  {
    q: 'Something isn’t printing. Help?',
    a: 'Click "Help — Not Working?" in the widget for automatic diagnostics, or open the dashboard at http://localhost:3456 for a traffic-light health check, warnings, and a test label preview.',
  },
];

export const Faq: React.FC = () => (
  <section id="faq" className="max-w-3xl mx-auto px-4 py-20">
    <h2 className="text-3xl font-black text-slate-900 text-center tracking-tight mb-12">Questions volunteers ask</h2>
    <div className="space-y-3">
      {QA.map(item => (
        <details key={item.q} className="group bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm open:shadow-md transition-shadow">
          <summary className="flex items-center justify-between cursor-pointer list-none font-bold text-slate-900 text-sm">
            {item.q}
            <i className="fa fa-chevron-down text-slate-400 text-xs group-open:rotate-180 transition-transform"></i>
          </summary>
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">{item.a}</p>
        </details>
      ))}
    </div>
  </section>
);

export const Footer: React.FC = () => (
  <footer className="bg-slate-900 text-slate-400">
    <div className="max-w-6xl mx-auto px-4 py-10 text-center space-y-3 text-sm">
      <p className="font-bold text-white">
        <i className="fa fa-print mr-2 text-brand-500"></i>Awana Label Printer <span className="font-mono text-xs text-slate-500">v{SERVER_VERSION}</span>
      </p>
      <p className="text-xs max-w-xl mx-auto">
        Free &amp; open source. Not affiliated with, endorsed by, or approved by TwoTimTwo.com or
        Awana Clubs International — a community-built tool that works alongside their systems.
      </p>
      <p className="text-xs">
        <a href="https://github.com/patrick-simpson/Print-TwoTimTwo-Labels" target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-white font-semibold">
          <i className="fab fa-github mr-1.5"></i>Source, issues &amp; troubleshooting on GitHub
        </a>
      </p>
    </div>
  </footer>
);
