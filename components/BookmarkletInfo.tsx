import React, { useState } from 'react';

export const BookmarkletInfo: React.FC = () => {
  const [copied, setCopied] = useState(false);

  // This is the actual JavaScript that will run in the user's browser
  const bookmarkletCode = `javascript:(function(){
    var lastCheckinDiv = document.querySelector('#lastCheckin div');
    if(!lastCheckinDiv) {
      var manual = prompt("Could not find a recent check-in. Enter name manually:");
      if(manual) printLabel(manual, "", "");
      return;
    }

    var clone = lastCheckinDiv.cloneNode(true);
    var undoLink = clone.querySelector('a');
    if(undoLink) undoLink.remove();
    var name = clone.innerText.trim();

    if(!name) { alert('Name is empty.'); return; }

    var clubName = "";
    var clubLogoSrc = "";
    var clubberDivs = document.querySelectorAll('.clubber');
    for (var i = 0; i < clubberDivs.length; i++) {
        var n = clubberDivs[i].querySelector('.name');
        if (n && n.innerText.trim() === name) {
            var img = clubberDivs[i].querySelector('.club img');
            if (img) {
                clubName = img.getAttribute('alt').trim().replace(/&amp;/g, '&');
                clubLogoSrc = img.src;
            }
            break;
        }
    }

    printLabel(name, clubName, clubLogoSrc);

    function printLabel(nameText, clubText, logoSrc) {
        try {
        var parts = nameText.trim().split(' ');
        var firstName = parts[0];
        var lastName = parts.slice(1).join(' ');
        var kvbcLogo = 'https://kvbchurch.twotimtwo.com/images/logos/kvbchurch2.jpg';
        var w = window.open('', '_blank', 'width=400,height=200');
        if (!w) { alert('Popup blocked! Please allow popups for this site and try again.'); return; }
        w.document.write('<html><head><title>Label</title><style>');
        w.document.write('@page { size: 4in 2in; margin: 0; }');
        w.document.write('* { box-sizing: border-box; }');
        w.document.write('body { margin: 0; padding: 0.1in 0.15in 0.05in; width: 4in; height: 2in; display: flex; flex-direction: column; font-family: Arial, sans-serif; overflow: hidden; }');
        w.document.write('.main { flex: 1; display: flex; align-items: center; gap: 0.12in; }');
        w.document.write('.club-logo { height: 0.7in; width: auto; flex-shrink: 0; }');
        w.document.write('.first { font-size: 34pt; font-weight: bold; line-height: 1; margin: 0; }');
        w.document.write('.last { font-size: 19pt; line-height: 1.2; margin: 0; color: #222; }');
        w.document.write('.footer { display: flex; justify-content: center; padding-bottom: 0.05in; }');
        w.document.write('.kvbc-logo { height: 0.45in; width: auto; }');
        w.document.write('</style></head><body>');
        w.document.write('<div class="main">');
        if (logoSrc) {
            w.document.write('<img class="club-logo" src="' + logoSrc + '" onerror="this.style.display=\'none\'" />');
        }
        w.document.write('<div><div class="first">' + firstName + '</div>');
        if (lastName) {
            w.document.write('<div class="last">' + lastName + '</div>');
        }
        w.document.write('</div></div>');
        w.document.write('<div class="footer"><img class="kvbc-logo" src="' + kvbcLogo + '" /></div>');
        w.document.write('</body></html>');
        w.document.close();
        w.focus();
        setTimeout(function() {
            w.print();
            w.close();
        }, 500);
        } catch(e) { alert('Label error: ' + e.message); }
    }
})();`;

  // Minify lightly for the href attribute
  const hrefCode = bookmarkletCode.replace(/\s+/g, ' ');

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