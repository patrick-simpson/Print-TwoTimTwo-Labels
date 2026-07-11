import React, { useState } from 'react';
import { ClubberList } from './ClubberList';
import { CheckinModal } from './CheckinModal';
import { mockClubbers } from '../data';
import { Clubber } from '../types';

/**
 * A working replica of the TwoTimTwo check-in page. It renders the exact DOM
 * the browser extension watches (#lastCheckin and .clubber rows), so clicking
 * a child here exercises the whole pipeline and prints a real label when the
 * server + extension are installed.
 */
export const Simulator: React.FC = () => {
  const [selectedClubber, setSelectedClubber] = useState<Clubber | null>(null);
  const [lastCheckin, setLastCheckin] = useState<Clubber | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState('');

  const visibleClubbers = [...mockClubbers]
    .filter(c => c.name.toLowerCase().includes(filter.toLowerCase().trim()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleCheckin = (clubber: Clubber) => {
    setSelectedClubber(null);
    setIsLoading(true);
    // Simulate network delay
    setTimeout(() => {
      setIsLoading(false);
      setLastCheckin(clubber);
    }, 600);
  };

  const handleUndo = (e: React.MouseEvent) => {
    e.preventDefault();
    if (confirm('Are you sure you want to undo this checkin?')) {
      setLastCheckin(null);
    }
  };

  return (
    <section id="simulator" className="bg-slate-50 border-y border-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-20">
        <h2 className="text-3xl font-black text-slate-900 text-center tracking-tight">Try it live</h2>
        <p className="text-slate-500 text-center mt-2 mb-10 max-w-2xl mx-auto">
          This is a working replica of a TwoTimTwo check-in page. With the server running and the
          extension loaded, clicking a child below prints a <strong>real label</strong> — exactly
          what happens on club night.
        </p>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Fake site chrome */}
          <div className="bg-slate-100 border-b border-slate-200 px-4 py-2.5 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-300"></span>
            <span className="w-3 h-3 rounded-full bg-amber-300"></span>
            <span className="w-3 h-3 rounded-full bg-green-300"></span>
            <span className="ml-3 text-xs text-slate-400 font-mono truncate">yourchurch.twotimtwo.com/clubber/checkin</span>
          </div>

          <div className="p-5">
            {/* Filters simulation */}
            <div className="flex flex-wrap gap-4 mb-4 items-center bg-slate-50 border border-slate-100 p-3 rounded-lg text-sm">
              <div className="flex items-center gap-2">
                <label className="text-slate-500 font-semibold">Meeting:</label>
                <select className="border border-slate-200 rounded px-2 py-1 text-sm bg-white">
                  <option>2026-07-15</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-slate-500 font-semibold">Only show names that match:</label>
                <input
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  className="border border-slate-200 rounded px-2 py-1 text-sm bg-white"
                  placeholder="Search…"
                />
              </div>
            </div>

            {isLoading && (
              <div className="bg-amber-100 text-amber-800 p-2 mb-4 font-bold animate-pulse rounded">
                Checking in...
              </div>
            )}

            {/* The DOM the extension watches — keep this structure intact */}
            <div
              id="lastCheckin"
              className={lastCheckin && !isLoading ? 'mb-4 bg-slate-100 p-2 rounded flex items-center gap-2' : ''}
              style={!lastCheckin || isLoading ? { display: 'none' } : {}}
            >
              <span className="text-slate-600">Last checked in:</span>
              <div className="bg-amber-100 border border-amber-200 px-3 py-1 font-bold text-green-900 rounded">
                {lastCheckin?.name}
                <a href="#" onClick={handleUndo} className="ml-3 text-xs font-normal text-blue-600 hover:underline bg-white px-2 py-0.5 border rounded">
                  undo
                </a>
              </div>
            </div>

            {/* Clubber grid */}
            <div className="clubbers">
              <ClubberList clubbers={visibleClubbers} onSelect={setSelectedClubber} />
            </div>
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
};
