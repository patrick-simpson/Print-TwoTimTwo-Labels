import React from 'react';

/**
 * The family icon sprite: plain monochrome glyphs drawn for this family (the
 * first block is copied from the family reference page, the rest are drawn in
 * the same 24px, 1.9-stroke style). No third-party icon art, no Awana marks.
 * Rendered once per page; <Icon name="…" /> references a symbol by id.
 */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const IconSprite: React.FC = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
    <defs>
      <symbol id="i-peanut" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M9.2 3.5c-3 0-4.8 2.4-4.4 5 .3 1.8 1.6 2.6 1.5 3.9-.1 1.2-1.6 2-1.6 4 0 2.7 2.3 4.6 5 4.3 3-.3 3.4-2.9 5-3.4 1.6-.5 3.2.1 4.6-1.5 1.9-2.1 1.3-5.4-1-6.6-1.3-.7-2.7-.5-3.6-1.5-.9-1-.8-2.5-1.9-3.4-.9-.6-2-.8-3.6-.8z"/><path fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" d="M8 8.5h.01M11 11h.01M9 15h.01M14 14.5h.01"/></symbol>
      <symbol id="i-cake" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"><path d="M4 21h16v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z"/><path d="M4 16.5c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0 2.7-1 4 0"/><path d="M12 12V8.5"/><path d="M12 3.2c.9 1.1 1.3 1.9 1.3 2.6a1.3 1.3 0 0 1-2.6 0c0-.7.4-1.5 1.3-2.6z" fill="currentColor"/></g></symbol>
      <symbol id="i-nocam" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"><path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.8l1.5-2h6.4l1.5 2h2.8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.4"/><path d="M3.5 3.5l17 17" strokeWidth="2.6"/></g></symbol>
      <symbol id="i-chev" viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></symbol>
      <symbol id="i-arrow" viewBox="0 0 16 16"><path d="M3 8h9.5M8.5 4 12.5 8l-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></symbol>
      <symbol id="i-check" viewBox="0 0 16 16"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></symbol>
      <symbol id="i-shield" viewBox="0 0 24 24"><g {...S}><path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.3 2.3 4.3-4.6"/></g></symbol>
      <symbol id="i-tag" viewBox="0 0 24 24"><g {...S}><rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10.5h6M7 13.5h4"/><circle cx="17" cy="12" r="1.3"/></g></symbol>
      <symbol id="i-screens" viewBox="0 0 24 24"><g {...S}><rect x="2.5" y="4" width="12" height="8" rx="1.5"/><rect x="9.5" y="10" width="12" height="8" rx="1.5"/><path d="M13 21h5"/></g></symbol>
      <symbol id="i-key" viewBox="0 0 24 24"><g {...S}><circle cx="8" cy="14" r="4.5"/><path d="M11.3 10.8 20 2.5M16.5 6l2.5 2.5M14 8.5l2 2"/></g></symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24"><g {...S}><path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5"/><path d="M4 3.5v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 15.5"/><path d="M20 20.5v-5h-5"/></g></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24"><g {...S}><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2"/></g></symbol>
      <symbol id="i-tv" viewBox="0 0 24 24"><g {...S}><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></g></symbol>
      <symbol id="i-play" viewBox="0 0 24 24"><g {...S}><rect x="2.5" y="4" width="19" height="14" rx="2"/><path d="M10 8.5v5.5l4.8-2.75z" fill="currentColor"/></g></symbol>
      <symbol id="i-code" viewBox="0 0 24 24"><g {...S}><path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15"/></g></symbol>
      <symbol id="i-download" viewBox="0 0 24 24"><g {...S}><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></g></symbol>
      <symbol id="i-copy" viewBox="0 0 24 24"><g {...S}><rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/></g></symbol>
      <symbol id="i-phone" viewBox="0 0 24 24"><g {...S}><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.3h2"/></g></symbol>
      <symbol id="i-printer" viewBox="0 0 24 24"><g {...S}><path d="M7 9V3.5h10V9"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/></g></symbol>
      <symbol id="i-alarm" viewBox="0 0 24 24"><g {...S}><path d="M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.2h.01"/></g></symbol>
      <symbol id="i-reprint" viewBox="0 0 24 24"><g {...S}><rect x="3" y="9" width="14" height="10" rx="2"/><path d="M7 9V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2"/><path d="M6.5 13.5h5M6.5 16h3"/></g></symbol>
      <symbol id="i-family" viewBox="0 0 24 24"><g {...S}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9.8" r="2.3"/><path d="M16.2 14.6c2.3.2 3.8 1.8 4.3 4.4"/></g></symbol>
      <symbol id="i-badge" viewBox="0 0 24 24"><g {...S}><rect x="4" y="6.5" width="16" height="14" rx="2.5"/><path d="M9.5 3.5h5v4h-5z"/><path d="M8 13h8M9.5 16.5h5"/></g></symbol>
      <symbol id="i-star" viewBox="0 0 24 24"><g {...S}><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></g></symbol>
      <symbol id="i-rocket" viewBox="0 0 24 24"><g {...S}><path d="M12 2.8c3 2.2 4.5 5.4 4.5 9.2V16h-9v-4c0-3.8 1.5-7 4.5-9.2z"/><circle cx="12" cy="9.8" r="1.6"/><path d="M7.5 12.8 5 16v2.5l2.5-1.3M16.5 12.8 19 16v2.5l-2.5-1.3M10.2 19.5h3.6"/></g></symbol>
      <symbol id="i-leaf" viewBox="0 0 24 24"><g {...S}><path d="M5.5 18.5C4.8 10.4 9.6 4.9 19.5 4.5c.3 9.6-5 14.6-14 14z"/><path d="M4 20.5 14 10.5"/></g></symbol>
      <symbol id="i-sparkle" viewBox="0 0 24 24"><g {...S}><path d="M12 3c.8 4.5 2.5 6.2 7 7-4.5.8-6.2 2.5-7 7-.8-4.5-2.5-6.2-7-7 4.5-.8 6.2-2.5 7-7z"/><path d="M19 16.5v4M17 18.5h4"/></g></symbol>
      <symbol id="i-flame" viewBox="0 0 24 24"><g {...S}><path d="M12 2.8c1 3.6 5.5 5.6 5.5 10.7a5.5 5.5 0 0 1-11 0c0-2.6 1.3-4.2 2.6-5.3.1 1.9.9 3.1 2.1 3.5-.5-3.3-.1-6.3.8-8.9z"/></g></symbol>
      <symbol id="i-music" viewBox="0 0 24 24"><g {...S}><path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></g></symbol>
      <symbol id="i-trophy" viewBox="0 0 24 24"><g {...S}><path d="M8 3.5h8v5.5a4 4 0 0 1-8 0z"/><path d="M8 5.5H4.5c0 3 1.5 4.7 3.8 5M16 5.5h3.5c0 3-1.5 4.7-3.8 5"/><path d="M12 13v3.5M8.5 20.5h7M10 16.5h4l.5 4h-5z"/></g></symbol>
      <symbol id="i-coin" viewBox="0 0 24 24"><g {...S}><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/></g></symbol>
      <symbol id="i-ledger" viewBox="0 0 24 24"><g {...S}><path d="M5 3.5h11.5a2 2 0 0 1 2 2v15H7a2 2 0 0 1-2-2z"/><path d="M5 18.5a2 2 0 0 1 2-2h11.5"/><path d="m8.5 9.5 2 2 3.8-4"/></g></symbol>
      <symbol id="i-id" viewBox="0 0 24 24"><g {...S}><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="2"/><path d="M5.6 15.8c.5-1.5 1.6-2.3 2.9-2.3s2.4.8 2.9 2.3M14 10h4M14 13.5h3"/></g></symbol>
      <symbol id="i-puzzle" viewBox="0 0 24 24"><g {...S}><path d="M9 5a2 2 0 1 1 4 0v1h4a1 1 0 0 1 1 1v4h-1a2 2 0 1 0 0 4h1v4a1 1 0 0 1-1 1h-4v-1a2 2 0 1 0-4 0v1H5a1 1 0 0 1-1-1v-4h1a2 2 0 1 0 0-4H4V7a1 1 0 0 1 1-1h4z"/></g></symbol>
      <symbol id="i-flask" viewBox="0 0 24 24"><g {...S}><path d="M9 3.5h6M10 3.5v5.5L4.8 18.6A1.6 1.6 0 0 0 6.2 21h11.6a1.6 1.6 0 0 0 1.4-2.4L14 9V3.5"/><path d="M7.4 15.5h9.2"/></g></symbol>
      <symbol id="i-search" viewBox="0 0 24 24"><g {...S}><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></g></symbol>
      <symbol id="i-heart" viewBox="0 0 24 24"><g {...S}><path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></g></symbol>
      <symbol id="i-chart" viewBox="0 0 24 24"><g {...S}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7.5 16v-3M11.5 16V9M15.5 16v-5"/></g></symbol>
    </defs>
  </svg>
);

export type IconName =
  | 'peanut' | 'cake' | 'nocam' | 'chev' | 'arrow' | 'check' | 'shield' | 'tag' | 'screens' | 'key'
  | 'refresh' | 'lock' | 'tv' | 'play' | 'code' | 'download' | 'copy' | 'phone' | 'printer' | 'alarm'
  | 'reprint' | 'family' | 'badge' | 'star' | 'rocket' | 'leaf' | 'sparkle' | 'flame' | 'music'
  | 'trophy' | 'coin' | 'ledger' | 'id' | 'puzzle' | 'flask' | 'search' | 'heart' | 'chart';

export const Icon: React.FC<{ name: IconName; className?: string }> = ({ name, className }) => (
  <svg className={className} aria-hidden="true" focusable="false"><use href={`#i-${name}`} /></svg>
);
