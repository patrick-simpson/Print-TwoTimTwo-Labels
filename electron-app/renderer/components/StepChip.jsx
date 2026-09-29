import React, { useEffect, useState } from 'react';
// The one copy of the kit's stepped-chip geometry, shared with the dashboard
// (it sets window.StepChip; see the file's header).
import '../../../print-server/public/step-chip.js';

// The catalog's stepped chip, "PRINTER / ONLINE": a small label tier over a
// wider value block, a plate out of register with its white keyline. Built
// around its own text and pinned with textLength, so a late font squeezes and
// never spills. `plate` is any CSS colour or var().
export default function StepChip({ label, value, plate }) {
  const [, setFontsReady] = useState(0);
  useEffect(() => {
    // Measured in Paytone One: draw again once the face has loaded.
    let alive = true;
    document.fonts?.load?.('400 24px "Paytone One"')
      .then(() => { if (alive) setFontsReady((n) => n + 1); })
      .catch(() => { /* keep the fallback measurement */ });
    return () => { alive = false; };
  }, []);

  const kit = window.StepChip;
  const l = String(label);
  const v = String(value);
  if (!kit) return <span className="chip-fallback" role="img" aria-label={`${l} ${v}`}>{l} · {v}</span>;

  const g = kit.geometry(kit.measureEm(l), kit.measureEm(v));
  const text = {
    fill: '#fff',
    textAnchor: 'middle',
    dominantBaseline: 'central',
    lengthAdjust: 'spacingAndGlyphs',
    style: { fontFamily: 'var(--f-shout)' },
  };
  return (
    <span className="step-chip" role="img" aria-label={`${l} ${v}`}>
      <svg
        viewBox={`-0.04 -0.04 ${g.width.toFixed(3)} ${g.height.toFixed(3)}`}
        width={`${g.width.toFixed(3)}em`}
        height={`${g.height.toFixed(3)}em`}
        aria-hidden="true"
        focusable="false"
      >
        <path d={g.d} style={{ fill: plate || 'rgba(3, 4, 4, 0.5)' }} transform="translate(0.12 0.07)" />
        <path d={g.d} fill="none" stroke="#fff" strokeWidth="0.045" />
        <text {...text} x={g.label.x} y={g.label.y} fontSize={g.label.size} textLength={g.label.width.toFixed(3)}>{l}</text>
        <text {...text} x={g.value.x} y={g.value.y} fontSize={g.value.size} textLength={g.value.width.toFixed(3)}>{v}</text>
      </svg>
    </span>
  );
}
