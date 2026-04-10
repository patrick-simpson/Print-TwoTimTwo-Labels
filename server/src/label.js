'use strict';

// Label renderer. Given the clubber fields + optional club logo buffer, draws
// a 4"×2" landscape label to a PNG buffer using node-canvas. Pure function —
// the caller decides whether to write the PNG to disk, stream it to a
// response, or pipe it to the printer.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http  = require('http');
const https = require('https');
const { createCanvas, loadImage } = require('canvas');
const { ALLERGY_EMOJI } = require('./enrich');

// ── Label geometry (1 pt = 1/72 inch) ────────────────────────────────────
const PAGE_W  = 4 * 72;  // 288 pt
const PAGE_H  = 2 * 72;  // 144 pt
const INSET   = 6;
const BX = INSET, BY = INSET;
const BW = PAGE_W - INSET * 2;
const BH = PAGE_H - INSET * 2;
const CORNER = 12;

const ICON_COL_W = 84;
const DIVIDER_X  = BX + ICON_COL_W;
const TEXT_X     = DIVIDER_X + 8;
const TEXT_W     = BX + BW - TEXT_X;

const DPI   = 300;
const PX_W  = Math.round(4 * DPI);
const PX_H  = Math.round(2 * DPI);
const SCALE = DPI / 72;

// Each Awana club gets a distinct font personality. Falls back through
// safe generic stacks so labels always render even if a specific face is
// missing on the target machine.
function getClubFontFamily(clubName) {
  const n = (clubName || '').toLowerCase();
  if (n.includes('puggle')) return "'Comic Sans MS', cursive, sans-serif";
  if (n.includes('cubbie')) return "'Comic Sans MS', cursive, sans-serif";
  if (n.includes('spark'))  return "'Trebuchet MS', Arial, sans-serif";
  if (n.includes('t&t') || n.includes('t & t') || n.includes('truth and training')) {
    return "'Arial Black', 'Arial Bold', Arial, sans-serif";
  }
  if (n.includes('trek'))    return "Georgia, 'Times New Roman', serif";
  if (n.includes('journey')) return "'Palatino Linotype', Palatino, Georgia, serif";
  return "Helvetica, Arial, sans-serif";
}

function fitFontSize(ctx, text, fontStyle, maxWidth, maxSize, minSize, fontFamily) {
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `${fontStyle} ${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return minSize;
}

function truncateText(ctx, text, font, maxWidth) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '…').width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { timeout: 4000 }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Accepts a data: URL, http(s) URL, or null. Returns a Buffer or null.
async function resolveImageBuffer(clubImageData) {
  if (!clubImageData) return null;
  try {
    if (clubImageData.startsWith('data:')) {
      const b64 = clubImageData.replace(/^data:[^;]+;base64,/, '');
      return Buffer.from(b64, 'base64');
    }
    if (/^https?:\/\//.test(clubImageData)) {
      return await downloadImage(clubImageData);
    }
  } catch (e) {
    console.log(`[icon] Could not load club image: ${e.message}`);
  }
  return null;
}

/**
 * Render a clubber label.
 *
 * @param {object} opts
 * @param {string} opts.firstName
 * @param {string} opts.lastName
 * @param {string} [opts.clubName]
 * @param {Buffer|null} [opts.clubImageBuffer]
 * @param {string[]} [opts.allergyTokens]
 * @param {string} [opts.handbookGroup]
 * @param {boolean} [opts.isBirthday]
 * @param {boolean} [opts.isVisitor]
 * @returns {Promise<{pngPath: string, buffer: Buffer}>}
 */
async function generateLabel(opts) {
  const {
    firstName = '',
    lastName  = '',
    clubName  = '',
    clubImageBuffer = null,
    allergyTokens = [],
    handbookGroup = '',
    isBirthday = false,
    isVisitor  = false,
  } = opts || {};

  const tokens = Array.isArray(allergyTokens) ? allergyTokens : [];
  const group  = (handbookGroup || '').trim();

  const pngPath = path.join(os.tmpdir(), `awana-${Date.now()}-${process.pid}.png`);

  const canvas = createCanvas(PX_W, PX_H);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  const hasIcon = !!clubImageBuffer;
  const textX   = hasIcon ? TEXT_X : BX + 8;
  const textW   = hasIcon ? TEXT_W : BW - 16;

  roundedRect(ctx, BX, BY, BW, BH, CORNER);

  if (hasIcon) {
    ctx.save();
    roundedRect(ctx, BX, BY, BW, BH, CORNER);
    ctx.clip();
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(BX, BY, ICON_COL_W, BH);
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(DIVIDER_X, BY + 12);
    ctx.lineTo(DIVIDER_X, BY + BH - 12);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = '#d0d0d0';
    ctx.stroke();

    const iconSize = 76;
    const iconX = BX + (ICON_COL_W - iconSize) / 2;
    const iconY = BY + (BH - iconSize) / 2;
    try {
      const img = await loadImage(clubImageBuffer);
      const aspect = img.width / img.height;
      let drawW = iconSize, drawH = iconSize;
      if (aspect > 1) drawH = iconSize / aspect; else drawW = iconSize * aspect;
      const dx = iconX + (iconSize - drawW) / 2;
      const dy = iconY + (iconSize - drawH) / 2;
      ctx.drawImage(img, dx, dy, drawW, drawH);
    } catch {
      ctx.beginPath();
      ctx.arc(BX + ICON_COL_W / 2, BY + BH / 2, 20, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#aaa';
      ctx.stroke();
    }
  }

  const hasLast    = lastName.trim().length > 0;
  const hasClub    = clubName.trim().length > 0 && !hasIcon;
  const hasGroup   = group.length > 0;
  const hasAllergy = tokens.length > 0;

  const fontFamily = getClubFontFamily(clubName);
  const fs1 = fitFontSize(ctx, firstName, 'bold', textW, 48, 18, fontFamily);
  const fs2 = 20, fs3 = 12, fs4 = 10, fs5 = 9;
  const GAP = 4, SEP = 9;

  let blockH = fs1;
  if (hasLast)    blockH += GAP + fs2;
  if (hasClub)    blockH += SEP + fs3;
  if (hasGroup)   blockH += GAP + fs4;
  if (isBirthday) blockH += GAP + fs5;

  const centerY = BY + BH / 2;
  let y = centerY - blockH / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const textCenterX = textX + textW / 2;

  const firstFont = `bold ${fs1}px ${fontFamily}`;
  ctx.font = firstFont;
  const safeFirst = truncateText(ctx, firstName, firstFont, textW);
  ctx.fillStyle = '#000000';
  ctx.fillText(safeFirst, textCenterX, y);
  y += fs1;

  if (hasLast) {
    y += GAP;
    const lastFont = `${fs2}px ${fontFamily}`;
    ctx.font = lastFont;
    const safeLast = truncateText(ctx, lastName, lastFont, textW);
    ctx.fillStyle = '#222222';
    ctx.fillText(safeLast, textCenterX, y);
    y += fs2;
  }

  if (hasClub) {
    y += 4;
    const sepMargin = textW * 0.1;
    ctx.beginPath();
    ctx.moveTo(textX + sepMargin, y + 0.5);
    ctx.lineTo(textX + textW - sepMargin, y + 0.5);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = '#cccccc';
    ctx.stroke();
    y += 5;
    const clubFont = `italic ${fs3}px ${fontFamily}`;
    ctx.font = clubFont;
    const safeClub = truncateText(ctx, clubName, clubFont, textW);
    ctx.fillStyle = '#444444';
    ctx.fillText(safeClub, textCenterX, y);
    y += fs3;
  }

  if (hasGroup) {
    y += GAP;
    let groupStr = group.length > 30 ? group.slice(0, 29) + '…' : group;
    const groupFont = `italic ${fs4}px ${fontFamily}`;
    ctx.font = groupFont;
    groupStr = truncateText(ctx, groupStr, groupFont, textW);
    ctx.fillStyle = '#666666';
    ctx.fillText(groupStr, textCenterX, y);
    y += fs4;
  }

  if (isBirthday) {
    y += GAP;
    ctx.font = `bold ${fs5}px ${fontFamily}`;
    ctx.fillStyle = '#c0392b';
    ctx.fillText('Happy Birthday!', textCenterX, y);
  }

  if (isVisitor) {
    const visitorFont = `bold ${fs5}px ${fontFamily}`;
    ctx.font = visitorFont;
    const vText = 'VISITOR';
    const vWidth = ctx.measureText(vText).width;
    const vPad = 4;
    const vX = BX + BW - vPad - vWidth - 8;
    const vY = BY + vPad;
    ctx.fillStyle = '#000000';
    roundedRect(ctx, vX - vPad, vY - 1, vWidth + vPad * 2, fs5 + 4, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(vText, vX, vY + 1);
    ctx.textAlign = 'center';
  }

  if (hasAllergy) {
    const emojiSize = 16;
    ctx.font = `${emojiSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    const emojis = tokens.map(t => ALLERGY_EMOJI[t] || t.charAt(0));
    const spacing = emojiSize + 2;
    const PAD = 6;
    const totalW = emojis.length * spacing - 2;
    let ex = BX + BW - PAD - totalW;
    const ey = BY + BH - PAD;
    emojis.forEach(em => { ctx.fillText(em, ex, ey); ex += spacing; });
    ctx.textBaseline = 'top';
  }

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(pngPath, buffer);
  return { pngPath, buffer };
}

module.exports = {
  generateLabel,
  resolveImageBuffer,
  getClubFontFamily,
  // Exposed for tests
  _geometry: { PAGE_W, PAGE_H, BX, BY, BW, BH, PX_W, PX_H },
};
