import React from 'react';
import { Clubber } from '../types';

interface CheckinModalProps {
  clubber: Clubber | null;
  onClose: () => void;
  onConfirm: (clubber: Clubber) => void;
}

export const CheckinModal: React.FC<CheckinModalProps> = ({ clubber, onClose, onConfirm }) => {
  if (!clubber) return null;

  const isGirl = clubber.gender === 'girl';
  const borderColor = isGirl ? 'border-[#FD8388]' : 'border-[#8295FF]';
  const headerBg = isGirl ? 'bg-[#FDEBEC]' : 'bg-[#E6EAFF]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded shadow-lg w-full max-w-lg mx-4 overflow-hidden">
        
        {/* Header */}
        <div className={`${headerBg} ${borderColor} border-l-4 border-r-4 border-t-4 p-4 flex justify-between items-start`}>
          <div>
            <h3 className="text-xl font-bold text-gray-800">{clubber.name}</h3>
            <div className="flex gap-4 text-sm mt-1 text-gray-700">
                <span className="font-semibold">{clubber.club}</span>
                <span className="flex items-center gap-1">
                    <span className="italic text-gray-500">Color:</span>
                    <span>{clubber.color}</span>
                </span>
                <span className="flex items-center gap-1">
                    <span className="italic text-gray-500">Group:</span>
                    <span>{clubber.group}</span>
                </span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl leading-none">
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
            <div className="space-y-3">
                <label className="flex items-center space-x-3">
                    <input type="checkbox" defaultChecked className="form-checkbox h-5 w-5 text-blue-600" />
                    <span className="text-gray-700">Bible</span>
                </label>
                <label className="flex items-center space-x-3">
                    <input type="checkbox" defaultChecked className="form-checkbox h-5 w-5 text-blue-600" />
                    <span className="text-gray-700">Kids Club meeting</span>
                </label>
                <label className="flex items-center space-x-3">
                    <input type="checkbox" className="form-checkbox h-5 w-5 text-blue-600" />
                    <span className="text-gray-700">Brought a friend</span>
                </label>
            </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-100 p-4 flex gap-2">
            <button 
                onClick={() => onConfirm(clubber)}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            >
                Checkin
            </button>
            <button className="bg-sky-400 hover:bg-sky-500 text-white font-bold py-2 px-4 rounded">
                Add Payment
            </button>
            <button 
                onClick={onClose}
                className="bg-white hover:bg-gray-200 text-gray-800 font-semibold py-2 px-4 border border-gray-300 rounded"
            >
                Cancel
            </button>
        </div>
      </div>
    </div>
  );
};