import React from 'react';

const STEPS = [
  {
    icon: 'fa-server',
    title: 'Run the print server',
    body: 'One PowerShell command installs everything and puts an "Awana Check In" icon on the desktop. Double-click it on club night — it even updates itself.',
  },
  {
    icon: 'fa-puzzle-piece',
    title: 'Add the browser extension',
    body: 'A small widget appears on your TwoTimTwo check-in page. It watches for check-ins — from this station and from phones or other laptops.',
  },
  {
    icon: 'fa-print',
    title: 'Labels print themselves',
    body: 'Every check-in silently prints a 4×2 label with the child’s name, club, group and safety icons. No dialogs, no clicks, no missed kids.',
  },
];

export const HowItWorks: React.FC = () => (
  <section id="how-it-works" className="max-w-6xl mx-auto px-4 py-20">
    <h2 className="text-3xl font-black text-slate-900 text-center tracking-tight">How it works</h2>
    <p className="text-slate-500 text-center mt-2 mb-12">Three pieces, five minutes of setup, then it runs itself.</p>
    <div className="grid md:grid-cols-3 gap-6">
      {STEPS.map((s, i) => (
        <div key={s.title} className="relative bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute -top-3 left-6 bg-brand-600 text-white text-xs font-black w-7 h-7 rounded-full flex items-center justify-center shadow">{i + 1}</div>
          <div className="w-11 h-11 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center text-lg mb-4">
            <i className={`fa ${s.icon}`}></i>
          </div>
          <h3 className="font-bold text-slate-900 mb-1.5">{s.title}</h3>
          <p className="text-sm text-slate-600 leading-relaxed">{s.body}</p>
        </div>
      ))}
    </div>
  </section>
);

const FEATURES: { icon: string; title: string; body: string; isNew?: boolean }[] = [
  { icon: '⚡', title: 'Zero-click printing', body: 'Check-ins are detected automatically — including ones made on other devices — and the label prints silently.' },
  { icon: '🛡️', title: 'Duplicate-proof', body: 'The server refuses to print the same child twice within seconds, so retries and double-taps never waste labels.' },
  { icon: '🥜', title: 'Allergy icons', body: 'Nut, dairy, gluten, egg and dye allergies from your roster print as bold icons in the label corner.' },
  { icon: '📷', title: 'No-photo flag', body: 'Kids whose family didn’t sign the media release get a crossed-out camera on their label.', isNew: true },
  { icon: '🍰', title: 'Birthday week', body: 'A cake icon appears on labels all week when a birthday is coming — volunteers never miss one.' },
  { icon: '📖', title: 'Handbook groups', body: 'Each child’s handbook group prints under their name so they get sorted to the right table fast.' },
  { icon: '🪙', title: 'Store Night shares', body: 'On Awana Store nights the label shows each kid’s share balance, pulled straight from TwoTimTwo.' },
  { icon: '🎓', title: 'Step Up Night', body: 'Graduating kids get a special inverted label announcing the club they’re stepping up to.' },
  { icon: '👋', title: 'Walk-ins & visitors', body: 'Type any name in the widget to print a guest label — with a VISITOR badge if you want one.' },
  { icon: '🔁', title: 'One-tap reprints', body: 'Tonight’s check-ins are listed right in the widget — tap Reprint when a label tears or wanders off.', isNew: true },
  { icon: '📊', title: 'Live dashboard', body: 'Tonight at a glance: per-club counts, visitors, and every allergy or no-photo kid in the building.', isNew: true },
  { icon: '📴', title: 'Offline-ready', body: 'The roster is cached locally, prints queue while the server is unreachable, and search keeps working if the Wi-Fi drops.', isNew: true },
  { icon: '🎉', title: 'Welcome screen', body: 'Pair with the lobby TV display: every check-in celebrates the kid by first name — with birthday and first-timer confetti.', isNew: true },
];

export const Features: React.FC = () => (
  <section id="features" className="bg-slate-50 border-y border-slate-100">
    <div className="max-w-6xl mx-auto px-4 py-20">
      <h2 className="text-3xl font-black text-slate-900 text-center tracking-tight">Everything a check-in table needs</h2>
      <p className="text-slate-500 text-center mt-2 mb-12">Built from real club nights — every feature exists because a volunteer needed it.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FEATURES.map(f => (
          <div key={f.title} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xl" aria-hidden="true">{f.icon}</span>
              <h3 className="font-bold text-slate-900 text-sm">{f.title}</h3>
              {f.isNew && <span className="text-[9px] font-black uppercase tracking-wide bg-brand-600 text-white px-1.5 py-0.5 rounded-full">New in v4</span>}
            </div>
            <p className="text-[13px] text-slate-600 leading-relaxed">{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);
