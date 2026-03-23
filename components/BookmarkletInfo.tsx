import React, { useState } from 'react';

export const BookmarkletInfo: React.FC = () => {
  const [copied, setCopied] = useState(false);

  // This is the actual JavaScript that will run in the user's browser
  const bookmarkletCode = `javascript:(function(){
    var lastCheckinDiv = document.querySelector('#lastCheckin div');
    if(!lastCheckinDiv) {
      var manual = prompt("Could not find a recent check-in. Enter name manually:");
      if(manual) printLabel(manual, "");
      return;
    }
    
    var clone = lastCheckinDiv.cloneNode(true);
    var undoLink = clone.querySelector('a');
    if(undoLink) undoLink.remove();
    var name = clone.innerText.trim();
    
    if(!name) { alert('Name is empty.'); return; }
    
    var clubName = "";
    var clubberDivs = document.querySelectorAll('.clubber');
    for (var i = 0; i < clubberDivs.length; i++) {
        var n = clubberDivs[i].querySelector('.name');
        if (n && n.innerText.trim() === name) {
            var img = clubberDivs[i].querySelector('.club img');
            if (img) {
                clubName = img.getAttribute('alt').trim();
                clubName = clubName.replace(/&amp;/g, '&');
            }
            break;
        }
    }
    
    printLabel(name, clubName);

    function printLabel(nameText, clubText) {
        var w = window.open('', '_blank', 'width=400,height=250');
        w.document.write('<html><head><title>Label</title><style>');
        w.document.write('@page { size: 4in 2in; margin: 0; }');
        w.document.write('body { margin: 0; padding: 0; width: 4in; height: 2in; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: sans-serif; text-align: center; overflow: hidden; }');
        w.document.write('h1 { font-size: 38pt; font-weight: bold; margin: 0; line-height: 1.1; }');
        w.document.write('h2 { font-size: 24pt; font-weight: normal; margin: 10px 0 0 0; color: #555; }');
        w.document.write('</style></head><body>');
        w.document.write('<h1>' + nameText + '</h1>');
        if (clubText) {
            w.document.write('<h2>' + clubText + '</h2>');
        }
        w.document.write('</body></html>');
        w.document.close();
        w.focus();
        setTimeout(function() { 
            w.print(); 
            w.close(); 
        }, 500);
    }
})();`;

  // Minify lightly for the href attribute
  const hrefCode = bookmarkletCode.replace(/\s+/g, ' ').replace(/\/\//g, '');

  const handleCopy = () => {
    navigator.clipboard.writeText(hrefCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-8 border-l-4 border-blue-600">
      <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
        <i className="fa fa-print mr-2 text-blue-600"></i>
        1. Install Label Printer Bookmarklet
      </h2>
      
      <p className="mb-4 text-gray-600">
        Drag the blue button below to your browser's bookmarks bar. When you are on the check-in page, click this bookmark <strong>immediately after</strong> checking a child in.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-4 mb-6">
        <a 
          href={hrefCode}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded shadow cursor-grab active:cursor-grabbing flex items-center"
          title="Drag me to your bookmarks bar"
          onClick={(e) => e.preventDefault()}
        >
          <i className="fa fa-tag mr-2"></i>
          Print Check-in Label
        </a>
        
        <span className="text-gray-400 italic text-sm hidden sm:inline">← Drag this to bookmarks bar</span>
      </div>

      <div className="bg-gray-100 p-4 rounded text-sm font-mono overflow-x-auto border border-gray-200">
        <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-gray-500 uppercase font-bold">Source Code</span>
            <button 
                onClick={handleCopy}
                className="text-blue-600 hover:text-blue-800 text-xs font-bold"
            >
                {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
        </div>
        <pre className="whitespace-pre-wrap break-all text-xs text-gray-700">
            {hrefCode}
        </pre>
      </div>
    </div>
  );
};