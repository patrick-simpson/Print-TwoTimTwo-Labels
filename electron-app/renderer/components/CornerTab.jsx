import React from 'react';
import tabSvg from '../../../print-server/public/brand/shapes/tab-b-sparks.svg?raw';

// The kit's wavy corner tab, drawn inline from the mirror's own shape file.
// Inline rather than a CSS mask on purpose: this window is a file:// page, and
// Chromium refuses a mask image from file:// (it needs CORS), which would
// leave white type on a white card. The shape is read out of the kit file at
// build time, so there is still one copy of it.
const viewBox = (tabSvg.match(/viewBox="([^"]+)"/) || [])[1];
const d = (tabSvg.match(/\sd="([^"]+)"/) || [])[1];

export default function CornerTab({ tone = '', children }) {
  return (
    <span className={`corner-tab${tone ? ` ${tone}` : ''}`}>
      {viewBox && d ? (
        <svg className="corner-tab__shape" viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d={d} />
        </svg>
      ) : null}
      {children}
    </span>
  );
}
