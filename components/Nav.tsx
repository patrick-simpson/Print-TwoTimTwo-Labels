import React from 'react';
import { SERVER_VERSION } from '../src/constants';

const links = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#install', label: 'Install' },
  { href: '#simulator', label: 'Try it' },
  { href: '#faq', label: 'FAQ' },
];

export const Nav: React.FC = () => (
  <nav className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-100">
    <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
      <a href="#" className="flex items-center gap-2.5 font-extrabold text-slate-900">
        <span className="w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center text-lg shadow-sm">
          <i className="fa fa-print"></i>
        </span>
        <span className="hidden sm:inline">Awana Label Printer</span>
        <span className="text-[10px] font-mono font-medium bg-brand-50 text-brand-700 border border-brand-200 px-1.5 py-0.5 rounded-full">
          v{SERVER_VERSION}
        </span>
      </a>
      <div className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
        {links.map(l => (
          <a key={l.href} href={l.href} className="hover:text-brand-700 transition-colors">{l.label}</a>
        ))}
      </div>
      <a
        href="https://github.com/patrick-simpson/Print-TwoTimTwo-Labels"
        target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-2 text-sm font-semibold bg-slate-900 hover:bg-slate-700 text-white px-3.5 py-2 rounded-lg transition-colors"
      >
        <i className="fab fa-github"></i>
        <span className="hidden sm:inline">GitHub</span>
      </a>
    </div>
  </nav>
);
