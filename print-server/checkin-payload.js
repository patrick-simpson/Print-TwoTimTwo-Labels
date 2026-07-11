// Awana Check-in Broadcast Contract v1 — payload builder.
// See CONTRACT.md. The payload sent to the welcome-screen display must
// contain EXACTLY these four fields and nothing else: the display side
// (Awana-Check-in-Display) enforces the same allowlist in sanitize().
// Never add allergy info, last names, contact info, or any other PII.

'use strict';

const CHECKIN_CHANNEL = 'awana-channel';
const CHECKIN_EVENT = 'checkin';

function buildCheckinPayload({ firstName, clubName, birthday, visitor }) {
  return {
    firstName: typeof firstName === 'string' ? firstName.trim() : '',
    club: typeof clubName === 'string' ? clubName.trim() : '',
    isBirthday: !!birthday,
    isFirstTimer: !!visitor,
  };
}

module.exports = { CHECKIN_CHANNEL, CHECKIN_EVENT, buildCheckinPayload };
