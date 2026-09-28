import React, { useCallback, useState } from 'react';
import { ClubberList } from './ClubberList';
import { CheckinModal } from './CheckinModal';
import { mockClubbers } from '../data';
import { Clubber } from '../types';

/**
 * A working replica of the TwoTimTwo check-in page. It renders the exact DOM
 * the browser extension watches (#lastCheckin and .clubber rows with .name and
 * .club img, plus #checkin-modal / button#checkin — see src/constants.ts
 * DOM_SELECTORS and chrome-extension/content.js). The extension's content
 * script only runs on *.twotimtwo.com (manifest.json content_scripts), so no
 * label prints from this page on github.io: it shows a volunteer what the
 * table looks like, and keeps the DOM contract documented in one place.
 * Restyle freely around it; never change that DOM.
 *
 * The replica keeps TwoTimTwo's own light colours in both themes, because it
 * is a picture of somebody else's website.
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

  const closeModal = useCallback(() => setSelectedClubber(null), []);

  const handleUndo = (e: React.MouseEvent) => {
    e.preventDefault();
    if (confirm('Are you sure you want to undo this checkin?')) {
      setLastCheckin(null);
    }
  };

  return (
    <section id="simulator" className="lbl-part" aria-labelledby="sim-title">
      <div className="fam-wrap">
        <div className="lbl-part__head">
          <p className="fam-kicker">Try it</p>
          <h2 className="lbl-part__title" id="sim-title">A check-in page you can click</h2>
          <p className="lbl-part__lede">
            This is a replica of a TwoTimTwo check-in page, built with the same page structure the
            extension watches. Click a child to see what a volunteer sees at the table; on club night, the
            same click on your church’s own TwoTimTwo check-in page is what prints the label.
          </p>
        </div>

        <div className="lbl-sim">
          {/* Fake site chrome */}
          <div className="lbl-sim__chrome" aria-hidden="true">
            <span></span><span></span><span></span>
            <code>yourchurch.twotimtwo.com/clubber/checkin</code>
          </div>

          <div className="p-4 sm:p-5">
            {/* Filters simulation */}
            <div className="flex flex-wrap gap-x-5 gap-y-3 mb-4 items-center bg-[#f8fafc] border border-[#e2e8f0] p-3 rounded-md text-sm">
              <div className="flex items-center gap-2">
                <label htmlFor="sim-meeting" className="text-[#475569] font-semibold">Meeting:</label>
                <select id="sim-meeting" className="border border-[#cbd5e1] rounded-sm px-2 py-1 text-sm bg-white text-[#1e293b]">
                  <option>2026-07-15</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <label htmlFor="sim-filter" className="text-[#475569] font-semibold">Only show names that match:</label>
                <input
                  id="sim-filter"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  className="border border-[#cbd5e1] rounded-sm px-2 py-1 text-sm bg-white text-[#1e293b] placeholder:text-[#64748b] min-w-0 w-44"
                  placeholder="Search…"
                />
              </div>
            </div>

            <div aria-live="polite">
              {isLoading && (
                <div className="bg-[#fef3c7] text-[#92400e] p-2 mb-4 font-bold animate-pulse rounded-sm">
                  Checking in...
                </div>
              )}
            </div>

            {/* The DOM the extension watches — keep this structure intact */}
            <div
              id="lastCheckin"
              className={lastCheckin && !isLoading ? 'mb-4 bg-[#f1f5f9] p-2 rounded-sm flex flex-wrap items-center gap-2 text-[#334155]' : ''}
              style={!lastCheckin || isLoading ? { display: 'none' } : {}}
            >
              <span className="text-[#475569]">Last checked in:</span>
              <div className="bg-[#fef3c7] border border-[#fde68a] px-3 py-1 font-bold text-[#14532d] rounded-sm">
                {lastCheckin?.name}
                <a href="#" onClick={handleUndo} className="ml-3 text-xs font-normal text-[#1d4ed8] hover:underline bg-white px-2 py-0.5 border border-[#cbd5e1] rounded-sm">
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
        <p className="fam-frame__caption">
          <b>Fig. 7</b> A working replica of a TwoTimTwo check-in page, with the same page structure the extension watches for.
          <span className="fam-frame__recreated">Recreated for illustration. Names are examples.</span>
        </p>
      </div>

      <CheckinModal
        clubber={selectedClubber}
        onClose={closeModal}
        onConfirm={handleCheckin}
      />
    </section>
  );
};
