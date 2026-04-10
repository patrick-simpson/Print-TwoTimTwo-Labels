'use strict';

// CSV parser + header normalization for TwoTimTwo and manual clubber exports.
//
// Handles both the TwoTimTwo export format (quoted fields, spaces in headers
// like "First Name", values can contain embedded newlines) and the manual
// `clubbers-template.csv` format ("FirstName"). Pure function: given a raw
// CSV string it returns an array of row objects keyed by canonical field
// names. Never throws — returns [] for empty or malformed input so a bad
// upload can never crash the print server.

// Map every known header variation to a canonical key. Add new mappings
// here if TwoTimTwo ever renames a column.
const HEADER_MAP = {
  'firstname':      'FirstName',
  'first name':     'FirstName',
  'first_name':     'FirstName',
  'lastname':       'LastName',
  'last name':      'LastName',
  'last_name':      'LastName',
  'birthdate':      'Birthdate',
  'birth date':     'Birthdate',
  'birthday':       'Birthdate',
  'date of birth':  'Birthdate',
  'dob':            'Birthdate',
  'allergies':      'Allergies',
  'allergy':        'Allergies',
  'notes':          'Notes',
  'handbookgroup':  'HandbookGroup',
  'handbook group': 'HandbookGroup',
  'handbook_group': 'HandbookGroup',
  'club':           'Club',
  'group':          'Group',
  'color':          'Color',
  'grade':          'Grade',
  'gender':         'Gender',
  'clubber id':     'ClubberID',
  'clubberid':      'ClubberID',
  'inactive':       'Inactive',
  'book':           'Book',
  'primarycontact':  'PrimaryContact',
  'primary contact': 'PrimaryContact',
  'guardian':        'Guardian',
  'guardians':       'Guardian',
  'parent':          'Guardian',
  'parents':         'Guardian',
  'householdid':     'HouseholdID',
  'household id':    'HouseholdID',
  'familyid':        'HouseholdID',
  'family id':       'HouseholdID',
  'family':          'HouseholdID',
  'address':         'Address',
  'streetaddress':   'Address',
  'street address':  'Address',
  'homeaddress':     'Address',
  'home address':    'Address',
};

function normalizeHeader(raw) {
  const key = raw.toLowerCase().replace(/[_\s]+/g, ' ').trim();
  return HEADER_MAP[key] || raw;
}

function parseCSV(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    const rows = [];
    let headers = [];
    let headerParsed = false;
    let pos = 0;
    const len = raw.length;

    function nextField() {
      while (pos < len && raw[pos] === ' ') pos++;
      if (pos >= len) return '';

      if (raw[pos] === '"') {
        pos++; // skip opening quote
        let val = '';
        while (pos < len) {
          if (raw[pos] === '"') {
            if (pos + 1 < len && raw[pos + 1] === '"') {
              val += '"';
              pos += 2;
            } else {
              pos++;
              break;
            }
          } else {
            val += raw[pos];
            pos++;
          }
        }
        while (pos < len && raw[pos] === ' ') pos++;
        return val.trim();
      } else {
        let val = '';
        while (pos < len && raw[pos] !== ',' && raw[pos] !== '\n' && raw[pos] !== '\r') {
          val += raw[pos];
          pos++;
        }
        return val.trim();
      }
    }

    function parseRecord() {
      const fields = [];
      while (pos < len) {
        fields.push(nextField());
        if (pos < len && raw[pos] === ',') {
          pos++;
        } else {
          break;
        }
      }
      while (pos < len && (raw[pos] === '\r' || raw[pos] === '\n')) pos++;
      return fields;
    }

    while (pos < len) {
      while (pos < len && (raw[pos] === '\r' || raw[pos] === '\n' || raw[pos] === ' ')) pos++;
      if (pos >= len) break;

      // Stop at TwoTimTwo footer lines like "Clubber Count=116" or "FILTER,VALUE"
      const lineEnd = raw.indexOf('\n', pos) === -1 ? len : raw.indexOf('\n', pos);
      const restOfLine = raw.slice(pos, lineEnd);
      if (/^Clubber Count=/i.test(restOfLine) || /^FILTER,/i.test(restOfLine)) break;

      const fields = parseRecord();
      if (fields.length === 0 || (fields.length === 1 && !fields[0])) continue;

      if (!headerParsed) {
        headers = fields.map(normalizeHeader);
        headerParsed = true;
        continue;
      }

      const obj = {};
      headers.forEach((h, i) => { obj[h] = fields[i] !== undefined ? fields[i] : ''; });
      rows.push(obj);
    }

    return rows;
  } catch (e) {
    console.warn('[csv] Unexpected parse error:', e.message);
    return [];
  }
}

// Case-insensitive, whitespace-trimmed match on FirstName + LastName.
function findClubber(rows, firstName, lastName) {
  const fn = (firstName || '').toLowerCase().trim();
  const ln = (lastName  || '').toLowerCase().trim();
  return rows.find(r =>
    (r.FirstName || '').toLowerCase().trim() === fn &&
    (r.LastName  || '').toLowerCase().trim() === ln
  ) || null;
}

// Group clubbers by the best available family identifier and return a
// reverse map of lowercased "First Last" → array of sibling full-names.
function buildFamilyIndex(rows) {
  const groups = new Map();
  rows.forEach(r => {
    const full = ((r.FirstName || '') + ' ' + (r.LastName || '')).trim();
    if (!full) return;
    const groupKey = (r.HouseholdID || r.PrimaryContact || r.Guardian || r.Address || r.LastName || '').trim();
    if (!groupKey) return;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(full);
  });

  const index = new Map();
  groups.forEach(members => {
    if (members.length < 2) return;
    members.forEach(name => {
      index.set(name.toLowerCase(), members.filter(m => m !== name));
    });
  });
  return index;
}

module.exports = { parseCSV, normalizeHeader, findClubber, buildFamilyIndex, HEADER_MAP };
