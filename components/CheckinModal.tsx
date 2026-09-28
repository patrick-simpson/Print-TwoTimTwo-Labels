import React, { useEffect, useRef } from 'react';
import { Clubber } from '../types';

interface CheckinModalProps {
  clubber: Clubber | null;
  onClose: () => void;
  onConfirm: (clubber: Clubber) => void;
}

// A replica of TwoTimTwo's check-in modal. The extension looks for
// #checkin-modal and the button#checkin inside it; keep both ids.
export const CheckinModal: React.FC<CheckinModalProps> = ({ clubber, onClose, onConfirm }) => {
  const checkinRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clubber) return;
    const opener = document.activeElement as HTMLElement | null;
    checkinRef.current?.focus();
    // aria-modal promises the page behind is out of reach, so keep Tab inside
    // the dialog and stop the page scrolling underneath it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items: HTMLElement[] = Array.prototype.slice.call(dialogRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      const inside = !!active && dialogRef.current.contains(active);
      if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [clubber, onClose]);

  if (!clubber) return null;

  const isGirl = clubber.gender === 'girl';
  const borderColor = isGirl ? 'border-club-girlBorder' : 'border-club-boyBorder';
  const headerBg = isGirl ? 'bg-[#fdebec]' : 'bg-[#e6eaff]';

  return (
    <div id="checkin-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="bg-white rounded-md shadow-lg w-full max-w-lg overflow-hidden text-[#1f2937]"
        role="dialog" aria-modal="true" aria-labelledby="checkin-modal-title">

        {/* Header */}
        <div className={`${headerBg} ${borderColor} border-l-4 border-r-4 border-t-4 p-4 flex justify-between items-start gap-4`}>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-[#1f2937]" id="checkin-modal-title">{clubber.name}</h3>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-1 text-[#374151]">
                <span className="font-semibold">{clubber.club}</span>
                <span className="flex items-center gap-1">
                    <span className="italic text-[#4b5563]">Color:</span>
                    <span>{clubber.color}</span>
                </span>
                <span className="flex items-center gap-1">
                    <span className="italic text-[#4b5563]">Group:</span>
                    <span>{clubber.group}</span>
                </span>
            </div>
          </div>
          {/* Checkboxes to the right of child info */}
          <div className="flex flex-col gap-2 flex-shrink-0">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" defaultChecked className="h-4 w-4 accent-[#2563eb]" />
              <span className="text-sm text-[#374151] font-medium">Bible</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 accent-[#2563eb]" />
              <span className="text-sm text-[#374151] font-medium">Friend</span>
            </label>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[#4b5563] hover:text-[#111827] text-2xl leading-none flex-shrink-0">
            &times;
          </button>
        </div>

        {/* Footer */}
        <div className="bg-[#f3f4f6] p-4 flex flex-wrap gap-2">
            <button
                id="checkin"
                ref={checkinRef}
                onClick={() => onConfirm(clubber)}
                className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold py-2 px-4 rounded-sm"
            >
                Checkin
            </button>
            <button className="bg-[#0369a1] hover:bg-[#075985] text-white font-bold py-2 px-4 rounded-sm">
                Add Payment
            </button>
            <button
                onClick={onClose}
                className="bg-white hover:bg-[#e5e7eb] text-[#1f2937] font-semibold py-2 px-4 border border-[#d1d5db] rounded-sm"
            >
                Cancel
            </button>
        </div>
      </div>
    </div>
  );
};
