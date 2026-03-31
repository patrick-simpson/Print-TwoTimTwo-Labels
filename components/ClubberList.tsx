import React from 'react';
import { Clubber } from '../types';

interface ClubberListProps {
  clubbers: Clubber[];
  onSelect: (clubber: Clubber) => void;
}

export const ClubberList: React.FC<ClubberListProps> = ({ clubbers, onSelect }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
      {clubbers.map((clubber) => (
        <div
          key={clubber.id}
          onClick={() => onSelect(clubber)}
          className={`clubber
            relative p-2 border-b border-dotted border-gray-400 cursor-pointer transition-colors duration-150
            ${clubber.gender === 'girl' ? 'bg-[#FDCCCE] hover:bg-pink-300' : 'bg-[#D6DCFF] hover:bg-blue-200'}
            min-h-[60px]
          `}
        >
          <div className="name font-semibold text-gray-800 pr-12 leading-tight">
            {clubber.name}
          </div>
          
          <div className="club absolute top-1 right-1">
            <span className="text-xs bg-white/50 px-1 rounded shadow-sm flex items-center">
                <img src={`/images/clubs/${clubber.club.toLowerCase().replace(/&/g, '').replace(/\s+/g, '')}.png`} alt={clubber.club} className="h-4 w-4 mr-1 hidden" />
                {clubber.club}
            </span>
          </div>

          <div className="mt-1 text-[10px] text-gray-600 opacity-80">
             {clubber.color && clubber.color !== '(Unassigned)' ? `Color: ${clubber.color}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
};