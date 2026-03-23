import React from 'react';

export const ExtensionInfo: React.FC = () => {
  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-8 border-l-4 border-blue-600">
      <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
        <i className="fa fa-puzzle-piece mr-2 text-blue-600"></i>
        1. Install the Chrome Extension
      </h2>
      
      <p className="mb-4 text-gray-600">
        To enable automatic label printing, you need to install the custom Chrome Extension. This extension will add a printer selection dropdown to the check-in page and automatically print labels when a child is checked in.
      </p>

      <div className="bg-gray-100 p-4 rounded text-sm text-gray-700 border border-gray-200 mb-4">
        <h3 className="font-bold mb-2">Installation Steps:</h3>
        <ol className="list-decimal list-inside space-y-2">
          <li>Open Google Chrome and navigate to <code>chrome://extensions/</code></li>
          <li>Enable <strong>Developer mode</strong> using the toggle switch in the top right corner.</li>
          <li>Click the <strong>Load unpacked</strong> button in the top left.</li>
          <li>Select the <code>chrome-extension</code> folder from this project's directory.</li>
          <li>The "Twotimtwo Auto Printer" extension should now appear in your list of extensions.</li>
        </ol>
      </div>

      <div className="bg-blue-50 p-4 rounded text-sm text-blue-800 border border-blue-200">
        <p>
          <strong>Note:</strong> Once installed, you will see a "🖨️ Auto-Print" dropdown appear in the top right corner of the simulator below (and on the real Twotimtwo website). Select your label printer from this list to enable auto-printing.
        </p>
      </div>
    </div>
  );
};