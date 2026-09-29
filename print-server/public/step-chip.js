/*
 * The brand kit's stepped chip (catalog p.63 "GRADES / 9-12"): a small label
 * on a pill-shaped tier, a big value on a wider block that steps out beneath
 * it, a plate printed slightly out of register with its white keyline. On the
 * printer it carries the one status lockup, "PRINTER / ONLINE", on the
 * dashboard header and the Windows status window.
 *
 * The geometry is a straight port of chipGeometry() in the signage repo
 * (Awana-Check-in-Display src/lib/brand.js), same proportions, so the chip is
 * the same shape on every screen in the family. The plate is built around its
 * own text, and each text is pinned to its measured width with SVG textLength,
 * so a font that has not loaded yet can squeeze but never spill.
 *
 * A plain script with no imports on purpose: the dashboard loads it with a
 * <script> tag (no bundler), and the Electron renderer imports it for its side
 * effect, so both read this one copy. It only draws; it never fetches.
 */
(function (root) {
  'use strict';

  // Proportions in units of the value's font size (1em). Keep in step with
  // CHIP in the signage repo's src/lib/brand.js.
  var CHIP = {
    labelSize: 0.56,
    pillHeight: 1.15,
    pillPad: 0.42,
    pillMin: 2.2,
    blockLeft: 0.84,
    blockTop: 1.05,
    blockHeight: 1.38,
    blockPad: 0.5,
    step: 0.5,
    radiusBR: 0.39,
    radiusBL: 0.27
  };

  function n(v) { return Number(v.toFixed(3)); }

  function geometry(labelEm, valueEm) {
    var lw = Math.max(0, labelEm) * CHIP.labelSize;
    var vw = Math.max(0, valueEm);
    var H1 = CHIP.pillHeight;
    var r1 = H1 / 2;
    var W1 = Math.max(lw + CHIP.pillPad * 2, CHIP.pillMin);
    var bx0 = CHIP.blockLeft;
    var by0 = CHIP.blockTop;
    var by1 = by0 + CHIP.blockHeight;
    var bx1 = bx0 + vw + CHIP.blockPad * 2;
    // The value block always steps out past the label pill: that step is the
    // chip's whole silhouette.
    if (bx1 < W1 + CHIP.step) bx1 = W1 + CHIP.step;
    var rBR = CHIP.radiusBR;
    var rBL = CHIP.radiusBL;
    var d = [
      'M' + n(r1) + ',0', 'L' + n(W1 - r1) + ',0', 'A' + n(r1) + ',' + n(r1) + ' 0 0 1 ' + n(W1) + ',' + n(r1),
      'L' + n(W1) + ',' + n(by0), 'L' + n(bx1) + ',' + n(by0), 'L' + n(bx1) + ',' + n(by1 - rBR),
      'A' + rBR + ',' + rBR + ' 0 0 1 ' + n(bx1 - rBR) + ',' + n(by1), 'L' + n(bx0 + rBL) + ',' + n(by1),
      'A' + rBL + ',' + rBL + ' 0 0 1 ' + n(bx0) + ',' + n(by1 - rBL), 'L' + n(bx0) + ',' + n(H1), 'L' + n(r1) + ',' + n(H1),
      'A' + n(r1) + ',' + n(r1) + ' 0 0 1 0,' + n(r1), 'A' + n(r1) + ',' + n(r1) + ' 0 0 1 ' + n(r1) + ',0', 'Z'
    ].join(' ');
    return {
      d: d,
      label: { x: W1 / 2, y: H1 / 2 + 0.02, size: CHIP.labelSize, width: lw },
      value: { x: (bx0 + bx1) / 2, y: by0 + CHIP.blockHeight / 2 + 0.03, size: 1, width: vw },
      // Room for the plate's out-of-register offset (below and right).
      width: bx1 + 0.2,
      height: by1 + 0.14
    };
  }

  // A rough advance width for when no canvas is available.
  function rough(text) {
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      w += (ch === ' ' || ch === ':' || ch === '.') ? 0.3 : 0.64;
    }
    return w;
  }

  var ctx;
  // The advance width of `text` in em, in the kit's shout face (Paytone One).
  function measureEm(text, family) {
    if (ctx === undefined) {
      try {
        ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
      } catch (e) {
        ctx = null;
      }
    }
    if (!ctx) return rough(text);
    ctx.font = '100px "' + (family || 'Paytone One') + '", "Arial Rounded MT Bold", sans-serif';
    var w = ctx.measureText(text).width / 100;
    return isFinite(w) && w > 0 ? w : rough(text);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // The chip as an SVG string, sized in em so the caller scales it with
  // font-size. `plate` is any CSS colour (default: the kit's chip charcoal at
  // 50%, any CSS colour or var() otherwise); the keyline and the text are
  // always white.
  function svg(label, value, opts) {
    opts = opts || {};
    var l = String(label);
    var v = String(value);
    var g = geometry(measureEm(l), measureEm(v));
    // As a style, not a fill attribute, so a CSS var() works as the plate.
    var plate = opts.plate ? 'style="fill:' + esc(opts.plate) + '"' : 'fill="#030404" fill-opacity="0.5"';
    var text = 'fill="#fff" text-anchor="middle" dominant-baseline="central" lengthAdjust="spacingAndGlyphs"'
      + ' style="font-family:var(--brand-font-display, \'Paytone One\', sans-serif)"';
    return '<svg viewBox="-0.04 -0.04 ' + g.width.toFixed(3) + ' ' + g.height.toFixed(3) + '"'
      + ' width="' + g.width.toFixed(3) + 'em" height="' + g.height.toFixed(3) + 'em"'
      + ' aria-hidden="true" focusable="false" style="display:block;overflow:visible">'
      + '<path d="' + g.d + '" ' + plate + ' transform="translate(0.12 0.07)"/>'
      + '<path d="' + g.d + '" fill="none" stroke="#fff" stroke-width="0.045"/>'
      + '<text ' + text + ' x="' + n(g.label.x) + '" y="' + n(g.label.y) + '" font-size="' + g.label.size + '"'
      + ' textLength="' + g.label.width.toFixed(3) + '">' + esc(l) + '</text>'
      + '<text ' + text + ' x="' + n(g.value.x) + '" y="' + n(g.value.y) + '" font-size="' + g.value.size + '"'
      + ' textLength="' + g.value.width.toFixed(3) + '">' + esc(v) + '</text>'
      + '</svg>';
  }

  root.StepChip = { geometry: geometry, measureEm: measureEm, svg: svg };
})(typeof window !== 'undefined' ? window : this);
