import React from 'react';
import { Clubber } from '../types';

interface ClubberListProps {
  clubbers: Clubber[];
  onSelect: (clubber: Clubber) => void;
}

// Each row keeps TwoTimTwo's own structure (.clubber > .name + .club img):
// the extension reads the name from .name and the club from the img's alt.
// The img carries no src: the replica has no club art, and the extension's
// capture treats an unloaded image exactly like a missing one (monogram).
export const ClubberList: React.FC<ClubberListProps> = ({ clubbers, onSelect }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
      {clubbers.map((clubber) => (
        <div
          key={clubber.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(clubber)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(clubber); }
          }}
          className={`clubber
            relative p-2 border-b border-dotted border-[#9ca3af] cursor-pointer transition-colors duration-150
            ${clubber.gender === 'girl' ? 'bg-club-girl hover:bg-[#f9a8b4]' : 'bg-club-boy hover:bg-[#bfc9ff]'}
            min-h-[60px]
          `}
        >
          <div className="name font-semibold text-[#1f2937] pr-14 leading-tight">
            {clubber.name}
          </div>

          <div className="club absolute top-1 right-1">
            <span className="text-xs text-[#1f2937] bg-[rgba(255,255,255,0.6)] px-1 rounded-sm shadow-xs flex items-center">
                <img alt={clubber.club} className="h-4 w-4 mr-1 hidden" />
                {clubber.club}
            </span>
          </div>

          <div className="mt-1 text-[11px] text-[#374151]">
             {clubber.color && clubber.color !== '(Unassigned)' ? `Color: ${clubber.color}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
};
