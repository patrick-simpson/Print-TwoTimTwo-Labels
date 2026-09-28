import React from 'react';
import awanaMark from '../../../print-server/public/brand/logos/awana-clubs-white.svg';

// The status window's and the setup wizard's shared header: the white Awana
// Clubs mark and "Club Label Printer" on the Awana blue, a Londrina sub line,
// and whatever sits on the right (the status window's stepped chip).
export default function BrandHeader({ sub, subTone, children }) {
  return (
    <header className="app-header">
      <img className="brand-mark" src={awanaMark} alt="Awana Clubs" width="91" height="38" />
      <div className="titles">
        <h1>Club Label Printer</h1>
        {sub ? <span className={`sub${subTone ? ` ${subTone}` : ''}`}>{sub}</span> : null}
      </div>
      {children}
    </header>
  );
}
