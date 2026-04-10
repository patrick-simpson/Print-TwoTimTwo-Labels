'use strict';

// Enrichment pipeline: given a clubber row from the CSV, derive the
// rendering-ready fields (allergy tokens, handbook group, birthday flag).
// All helpers fail-soft and return safe defaults so a malformed cell can
// never crash the print pipeline.

const ALLERGY_EMOJI = {
  'NUTS':   '\uD83E\uDD5C',  // 🥜
  'DAIRY':  '\uD83E\uDD5B',  // 🥛
  'GLUTEN': '\uD83C\uDF3E',  // 🌾
  'EGG':    '\uD83E\uDD5A',  // 🥚
  'DYE':    '\uD83D\uDCA7',  // 💧 food dye / artificial colouring sensitivity
};

// Converts a free-text Allergies/Notes field into compact tokens that the
// label renderer knows how to draw. Returns [] for null/blank.
function parseAllergies(allergiesStr) {
  if (!allergiesStr || !String(allergiesStr).trim()) return [];
  const s = String(allergiesStr);
  const tokens = [];
  if (/nut|peanut|tree.?nut/i.test(s))   tokens.push('NUTS');
  if (/dairy|milk|lactose/i.test(s))     tokens.push('DAIRY');
  if (/gluten|wheat/i.test(s))           tokens.push('GLUTEN');
  if (/\begg\b/i.test(s))                tokens.push('EGG');
  if (/dye|color/i.test(s))              tokens.push('DYE');
  return tokens;
}

// Returns true if the child's next birthday falls within the next 7 days
// (inclusive). Handles year-wrapping (Dec 30 → Jan 2). Safe against blank,
// "N/A", or any unparseable date string.
function isBirthdayWeek(birthdateStr, now = new Date()) {
  if (!birthdateStr || String(birthdateStr).trim() === '' || birthdateStr === 'N/A') {
    return false;
  }
  try {
    let normalised = String(birthdateStr).trim();
    const slashMatch = normalised.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      normalised = `${slashMatch[3]}-${slashMatch[1].padStart(2, '0')}-${slashMatch[2].padStart(2, '0')}`;
    }
    const bday = new Date(normalised);
    if (isNaN(bday.getTime())) return false;

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    let next = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
    if (next < today) {
      next = new Date(today.getFullYear() + 1, bday.getMonth(), bday.getDate());
    }

    const diffDays = Math.round((next.getTime() - today.getTime()) / 86400000);
    return diffDays >= 0 && diffDays <= 6;
  } catch {
    return false;
  }
}

// Given a clubber row and the raw request data, return the enrichment
// fields the label renderer needs. Returns safe defaults if `record` is
// null so the caller can print a basic label.
function enrichClubber(record) {
  if (!record) {
    return { allergyTokens: [], handbookGroup: '', isBirthday: false };
  }
  const allergySource = record.Allergies || record.Notes || '';
  const rawGroup = record.HandbookGroup || '';
  return {
    allergyTokens: parseAllergies(allergySource),
    handbookGroup: rawGroup.trim().toLowerCase() === 'all' ? '' : rawGroup,
    isBirthday:    isBirthdayWeek(record.Birthdate),
  };
}

module.exports = { parseAllergies, isBirthdayWeek, enrichClubber, ALLERGY_EMOJI };
