import React, { useState } from 'react';
import { ClubberList } from './components/ClubberList';
import { CheckinModal } from './components/CheckinModal';
import { mockClubbers } from './data';
import { Clubber } from './types';

// ── Setup steps ──────────────────────────────────────────────────────────
// Rendered as a numbered accordion in §3. Each step has a title, a short
// body, and optional command-line content that gets a copy button.
const SETUP_STEPS = [
  {
    title: 'Install Node.js (one-time, ~30s)',
    body: 'Download the LTS installer from nodejs.org, run it, and accept the defaults. The print server runs on Node — this is the only system prerequisite.',
    link: { label: 'Download Node.js LTS', href: 'https://nodejs.org/en/download' },
  },
  {
    title: 'Download and unzip the print server',
    body: 'Grab the latest release zip, extract it anywhere (Desktop is fine), and double-click start.bat. The first run installs dependencies; subsequent runs start instantly.',
    link: { label: 'Latest release', href: 'https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/releases/latest' },
  },
  {
    title: 'Install the browser extension',
    body: 'Chrome / Edge: open chrome://extensions, enable Developer mode, click "Load unpacked" and select the extension folder from the same zip. The extension talks to the print server on localhost:3456.',
  },
  {
    title: 'Open your TwoTimTwo check-in page',
    body: 'Navigate to your church\'s TwoTimTwo check-in URL as you normally would. When a child checks in, a label prints automatically. No dialogs, no clicks.',
  },
];

// ── Troubleshooting Q&A ──────────────────────────────────────────────────
const TROUBLESHOOTING = [
  {
    q: 'Nothing prints when a child checks in',
    a: 'Make sure start.bat is running (you should see "Waiting for check-ins" in the window). Then open http://localhost:3456/health in your browser — it should return JSON. If it doesn\'t, the server isn\'t running.',
  },
  {
    q: 'Printer not found',
    a: 'Open the dashboard at http://localhost:3456/ and pick your printer from the dropdown. The server remembers the choice in config.json.',
  },
  {
    q: 'Port 3456 already in use',
    a: 'Another copy of the server is running (or some other app is using the port). Close the other copy, or edit "port" in config.json to a free port like 3457.',
  },
  {
    q: 'Chrome extension isn\'t detecting check-ins',
    a: 'Open DevTools (F12) on the TwoTimTwo check-in page and check the Console tab. If you see a "selectors are no longer matching" warning, TwoTimTwo changed their page — file a GitHub issue.',
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="ml-2 text-xs font-semibold px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 transition"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Hero() {
  return (
    <div className="bg-gradient-to-br from-[#4672b3] to-[#2d4f8a] text-white">
      <div className="max-w-5xl mx-auto px-6 py-20 text-center">
        <div className="inline-block px-3 py-1 rounded-full bg-white/15 text-xs font-semibold tracking-wider uppercase mb-4">
          For TwoTimTwo.com check-in
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 leading-tight">
          Print Awana check-in labels<br />
          <span className="text-[#ffd65c]">automatically</span>
        </h1>
        <p className="text-lg sm:text-xl text-white/90 max-w-2xl mx-auto mb-8">
          When a child checks in on TwoTimTwo, a 4×2 label prints silently to your DYMO or Brother label printer. Zero dialogs, zero clicks.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <a
            href="https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/releases/latest"
            className="inline-flex items-center gap-2 bg-[#ffd65c] hover:bg-[#ffc938] text-[#2d4f8a] font-bold px-6 py-3 rounded-lg shadow-lg transition"
          >
            Download print server
          </a>
          <a
            href="https://github.com/patrick-simpson/Print-TwoTimTwo-Labels#chrome-extension"
            className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/30 text-white font-semibold px-6 py-3 rounded-lg transition"
          >
            Install browser extension
          </a>
        </div>
        <div className="mt-6 text-sm text-white/70">
          Free • Open source • MIT license • Windows 10/11
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { icon: '👶', title: 'Check-in happens', body: 'A child checks in on the TwoTimTwo page as normal.' },
    { icon: '👀', title: 'Extension detects it', body: 'The browser extension watches the page and sees the new check-in within milliseconds.' },
    { icon: '🖨️', title: 'Server renders label', body: 'Local print server draws a 4×2 label with name, club, and allergy icons.' },
    { icon: '✨', title: 'Label prints silently', body: 'Windows sends it to your configured label printer — no dialog, no interruption.' },
  ];
  return (
    <section className="max-w-5xl mx-auto px-6 py-20">
      <h2 className="text-3xl font-extrabold text-center mb-3 text-gray-900">How it works</h2>
      <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
        Two small pieces — a browser extension and a local print server — working together on your check-in laptop.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {steps.map((step, i) => (
          <div key={i} className="relative bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition">
            <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-[#4672b3] text-white font-bold flex items-center justify-center text-sm">
              {i + 1}
            </div>
            <div className="text-4xl mb-3" aria-hidden="true">{step.icon}</div>
            <div className="font-bold text-gray-900 mb-1">{step.title}</div>
            <div className="text-sm text-gray-600 leading-relaxed">{step.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SetupGuide() {
  const [expanded, setExpanded] = useState<number | null>(0);
  return (
    <section className="bg-gray-50 border-y border-gray-200">
      <div className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-extrabold text-center mb-3 text-gray-900">Setup guide</h2>
        <p className="text-center text-gray-600 mb-10">
          Four steps. No PowerShell, no terminal. ~5 minutes start to finish.
        </p>
        <div className="space-y-3">
          {SETUP_STEPS.map((step, i) => {
            const open = expanded === i;
            return (
              <div key={i} className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                <button
                  onClick={() => setExpanded(open ? null : i)}
                  className="w-full flex items-center gap-4 p-5 text-left hover:bg-gray-50 transition"
                >
                  <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-bold ${open ? 'bg-[#4672b3] text-white' : 'bg-gray-100 text-gray-700'}`}>
                    {i + 1}
                  </div>
                  <div className="font-semibold text-gray-900 flex-1">{step.title}</div>
                  <div className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</div>
                </button>
                {open && (
                  <div className="px-5 pb-5 pl-[4.5rem] text-sm text-gray-600 leading-relaxed">
                    <p>{step.body}</p>
                    {step.link && (
                      <a
                        href={step.link.href}
                        className="inline-block mt-3 text-[#4672b3] hover:text-[#2d4f8a] font-semibold"
                      >
                        {step.link.label} →
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function LabelPreview() {
  const [selectedClubber, setSelectedClubber] = useState<Clubber | null>(null);
  const [lastCheckin, setLastCheckin] = useState<Clubber | null>(null);

  const sortedClubbers = [...mockClubbers].sort((a, b) => a.name.localeCompare(b.name));

  const handleCheckin = (clubber: Clubber) => {
    setSelectedClubber(null);
    setLastCheckin(clubber);
  };

  return (
    <section className="max-w-5xl mx-auto px-6 py-20">
      <h2 className="text-3xl font-extrabold text-center mb-3 text-gray-900">Try the check-in flow</h2>
      <p className="text-center text-gray-600 mb-10 max-w-2xl mx-auto">
        This is a live mini-version of the TwoTimTwo check-in page. Click any child — if you have the print server running, a label will actually print.
      </p>
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-[#f8f8f8] border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-700">Kids Club Check-in (demo)</div>
          <div className="text-xs text-gray-400">mock data</div>
        </div>
        <div className="p-4">
          <div
            id="lastCheckin"
            className={lastCheckin ? 'mb-4 bg-gray-100 p-2 rounded inline-flex items-center gap-2' : 'hidden'}
          >
            <span className="text-gray-700 text-sm">Last checked in:</span>
            <div className="bg-yellow-100 border border-yellow-200 px-3 py-1 font-bold text-green-900 rounded text-sm">
              {lastCheckin?.name}
            </div>
          </div>
          <div className="clubbers">
            <ClubberList clubbers={sortedClubbers} onSelect={setSelectedClubber} />
          </div>
        </div>
      </div>
      <CheckinModal
        clubber={selectedClubber}
        onClose={() => setSelectedClubber(null)}
        onConfirm={handleCheckin}
      />
    </section>
  );
}

function Troubleshooting() {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <section className="bg-gray-50 border-y border-gray-200">
      <div className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-extrabold text-center mb-10 text-gray-900">Troubleshooting</h2>
        <div className="space-y-2">
          {TROUBLESHOOTING.map((item, i) => {
            const open = expanded === i;
            return (
              <div key={i} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpanded(open ? null : i)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition"
                >
                  <div className="font-semibold text-gray-900 text-sm">{item.q}</div>
                  <div className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</div>
                </button>
                {open && (
                  <div className="px-4 pb-4 text-sm text-gray-600 leading-relaxed">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-8 text-center text-sm text-gray-500">
          Still stuck?{' '}
          <a
            href="https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/issues"
            className="text-[#4672b3] hover:text-[#2d4f8a] font-semibold"
          >
            Open a GitHub issue →
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-[#1a2a45] text-white/80 text-sm">
      <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div>
          <div className="font-bold text-white">Awana Label Printer</div>
          <div className="text-xs text-white/60 mt-1">
            Not affiliated with TwoTimTwo.com — a community-built tool. MIT licensed.
          </div>
        </div>
        <div className="flex gap-6">
          <a href="https://github.com/patrick-simpson/Print-TwoTimTwo-Labels" className="hover:text-white">GitHub</a>
          <a href="https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/issues" className="hover:text-white">Issues</a>
          <a href="https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/releases" className="hover:text-white">Releases</a>
        </div>
      </div>
    </footer>
  );
}

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-white text-gray-800 antialiased" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, 'Segoe UI', sans-serif" }}>
      <Hero />
      <HowItWorks />
      <SetupGuide />
      <LabelPreview />
      <Troubleshooting />
      <Footer />
    </div>
  );
};

export default App;
