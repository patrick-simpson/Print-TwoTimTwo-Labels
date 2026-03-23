import React, { useState, useEffect } from 'react';
import { ClubberList } from './components/ClubberList';
import { mockClubbers } from './data';
import { Clubber } from './types';
import { BookmarkletInfo } from './components/BookmarkletInfo';
import { PrintServerInfo } from './components/PrintServerInfo';
import { CheckinModal } from './components/CheckinModal';

const App: React.FC = () => {
  const [selectedClubber, setSelectedClubber] = useState<Clubber | null>(null);
  const [lastCheckin, setLastCheckin] = useState<Clubber | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Initial sort
  const sortedClubbers = [...mockClubbers].sort((a, b) => a.name.localeCompare(b.name));

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
    if(confirm('Are you sure you want to undo this checkin?')) {
        setLastCheckin(null);
    }
  };

  return (
    <div className="min-h-screen pb-12">
      {/* Simulation Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
           <div className="flex items-center gap-4">
                <img src="https://picsum.photos/40/40" alt="Logo" className="rounded shadow-sm" />
                <h1 className="text-xl font-bold text-gray-800 hidden sm:block">KVBC Checkin Clubber</h1>
           </div>
           <div className="text-sm text-gray-500">
             Simulated Environment
           </div>
        </div>
      </div>

      <div className="container mx-auto px-4 mt-6">
        
        {/* Bookmarklet Section */}
        <BookmarkletInfo />

        {/* Print Server Section */}
        <PrintServerInfo />

        <div className="border-t-2 border-dashed border-gray-300 my-8"></div>

        {/* 2. Test Area Instructions */}
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
            <h2 className="text-lg font-bold text-yellow-800 mb-2">
                <i className="fa fa-vial mr-2"></i>
                2. Test It Here
            </h2>
            <p className="text-sm text-yellow-700">
                This section simulates your actual Awana Check-in page. 
                <br />
                <strong>Step A:</strong> Click your bookmarklet once to arm it — a red badge appears in the corner.
                <br />
                <strong>Step B:</strong> Click any child below to "Check In" — the label prints automatically.
            </p>
        </div>

        {/* Filters Simulation */}
        <div className="flex flex-wrap gap-4 mb-4 items-center bg-gray-100 p-3 rounded">
            <div className="flex items-center gap-2">
                <label className="text-gray-600 font-semibold text-sm">Meeting:</label>
                <select className="form-select border-gray-300 rounded text-sm py-1">
                    <option>2025-12-03</option>
                </select>
            </div>
            <div className="flex items-center gap-2">
                 <label className="text-gray-600 font-semibold text-sm">Sort:</label>
                 <select className="form-select border-gray-300 rounded text-sm py-1">
                    <option>First Name</option>
                </select>
            </div>
        </div>

        {/* The DOM element expected by the bookmarklet */}
        {isLoading && (
            <div className="bg-yellow-100 text-yellow-800 p-2 mb-4 font-bold animate-pulse rounded">
                Checking in...
            </div>
        )}

        {lastCheckin && !isLoading && (
            <div id="lastCheckin" className="mb-4 bg-gray-200 p-2 rounded flex items-center gap-2">
                <span className="text-gray-700">Last checked in:</span>
                {/* This internal DIV structure matches the provided HTML exactly for the selector '#lastCheckin div' */}
                <div className="bg-yellow-100 border border-yellow-200 px-3 py-1 font-bold text-green-900 rounded">
                    {lastCheckin.name} 
                    <a href="#" onClick={handleUndo} className="ml-3 text-xs font-normal text-blue-600 hover:underline bg-white px-2 py-0.5 border rounded">
                        undo
                    </a>
                </div>
            </div>
        )}
        
        {/* Empty placeholder if nothing checked in, to ensure ID exists but is empty (mimicking initial state if needed, though usually hidden) */}
        {!lastCheckin && !isLoading && (
            <div id="lastCheckin" style={{display: 'none'}}><div></div></div>
        )}

        {/* Filter Box Simulation */}
        <div className="bg-green-100 border border-green-200 p-3 rounded mb-4 flex items-center gap-4">
             <label className="text-sm font-bold text-gray-700">Only show names that match:</label>
             <input className="border border-gray-300 rounded px-2 py-1 text-sm flex-1 max-w-xs" />
        </div>

        {/* Clubber Grid */}
        <div className="clubbers">
            <ClubberList 
                clubbers={sortedClubbers} 
                onSelect={setSelectedClubber} 
            />
        </div>
      </div>

      {/* Modals */}
      <CheckinModal 
        clubber={selectedClubber}
        onClose={() => setSelectedClubber(null)}
        onConfirm={handleCheckin}
      />
      
      <footer className="mt-12 text-center text-gray-400 text-sm">
        <p>This is a simulation tool. Data is mock data based on provided HTML.</p>
      </footer>
    </div>
  );
};

export default App;