import React from 'react';

/**
 * CSS mock of the real 4×2 in thermal label, matching the v4 canvas design:
 * icon panel on the left, big first name, group line, and the icon row in the
 * bottom-right corner (shares · birthday · allergy · no-photo).
 */
const LabelMock: React.FC = () => (
  <div className="relative">
    <div className="absolute -inset-6 bg-gradient-to-tr from-brand-100 via-emerald-50 to-transparent rounded-[2rem] blur-2xl opacity-80" aria-hidden="true"></div>
    <div className="relative bg-white rounded-2xl shadow-2xl shadow-slate-300/60 border border-slate-200 rotate-1 hover:rotate-0 transition-transform duration-300 w-full max-w-[420px] aspect-[2/1] flex overflow-hidden">
      {/* icon panel */}
      <div className="w-[28%] bg-slate-50 border-r border-slate-200 flex items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-slate-900 text-white flex items-center justify-center text-2xl font-black">S</div>
      </div>
      {/* text zone */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 relative">
        <div className="text-4xl font-black text-slate-900 leading-none tracking-tight">Micah</div>
        <div className="text-lg text-slate-800 mt-1">Simpson</div>
        <div className="w-3/4 border-t border-slate-700 mt-2 mb-1"></div>
        <div className="text-xs font-bold italic text-slate-900">Sparks</div>
        <div className="text-[10px] italic text-slate-500">Sparks Green</div>
        {/* bottom-right icon row */}
        <div className="absolute bottom-2 right-3 flex items-end gap-1.5 text-lg leading-none">
          <span className="text-sm font-semibold text-slate-800">🪙 1</span>
          <span className="text-xl">🍰</span>
          <span>🥜</span>
          <span className="relative inline-block">
            📷
            <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <span className="w-[120%] h-[2.5px] bg-slate-900 -rotate-[28deg] rounded-full"></span>
            </span>
          </span>
        </div>
      </div>
    </div>
    <p className="relative text-center text-xs text-slate-400 mt-4">
      The actual 4×2 in label design — allergy, birthday, share &amp; no-photo icons included
    </p>
  </div>
);

export const Hero: React.FC = () => (
  <header className="relative overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-b from-brand-50/70 to-white" aria-hidden="true"></div>
    <div className="relative max-w-6xl mx-auto px-4 pt-16 pb-20 grid lg:grid-cols-2 gap-12 items-center">
      <div>
        <div className="inline-flex items-center gap-2 text-xs font-bold text-brand-700 bg-brand-50 border border-brand-200 rounded-full px-3 py-1 mb-5">
          <i className="fa fa-bolt"></i> v4 — reprints, live dashboard, offline mode &amp; self-updates
        </div>
        <h1 className="text-4xl sm:text-5xl font-black text-slate-900 leading-[1.1] tracking-tight">
          Check a kid in.<br />
          <span className="text-brand-600">The label just prints.</span>
        </h1>
        <p className="mt-5 text-lg text-slate-600 max-w-xl">
          A free companion for <strong>TwoTimTwo.com</strong> check-in: the moment a child is checked
          in — on this computer or any other device — a 4×2 name label prints silently on your
          thermal printer. Allergies, birthdays, handbook groups and photo permissions included.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a href="#install" className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-bold px-6 py-3 rounded-xl shadow-lg shadow-brand-600/25 transition-colors">
            <i className="fa fa-download"></i> Install in 5 minutes
          </a>
          <a href="#simulator" className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-bold px-6 py-3 rounded-xl border border-slate-200 shadow-sm transition-colors">
            <i className="fa fa-vial"></i> Test it live
          </a>
        </div>
        <ul className="mt-8 space-y-2 text-sm text-slate-600">
          {[
            'Zero clicks per label — printing is fully automatic',
            'Duplicate-proof: one check-in, exactly one label',
            'Keeps working when the venue Wi-Fi doesn’t',
          ].map(t => (
            <li key={t} className="flex items-start gap-2.5">
              <i className="fa fa-circle-check text-brand-600 mt-0.5"></i>{t}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-center lg:justify-end">
        <LabelMock />
      </div>
    </div>
  </header>
);
