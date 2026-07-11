# Awana Check-in Broadcast Contract v1

**This file is the canonical definition.** A mirror copy lives in the
display repo ([Awana-Check-in-Display](https://github.com/patrick-simpson/Awana-Check-in-Display)
→ `CONTRACT.md`). If you change anything here, update the mirror and both
repos' contract tests in the same change.

## Purpose

When a label prints, the print server broadcasts a small event so the
"Joyful Welcome Screen" (the Awana-Check-in-Display signage app) can
celebrate the kid on the lobby TV. This contract pins down exactly what
travels between the two systems.

## Transport

- **Pusher Channels**, channel **`awana-channel`**, event **`checkin`**.
- The print server's `config.json` (`pusherAppId`, `pusherKey`,
  `pusherSecret`, `pusherCluster`) and the display's settings
  (`pusherAppKey`, `pusherCluster`) **must reference the same Pusher app
  and cluster** — that's the whole pairing.
- Producer code: `checkin-payload.js` (payload builder) +
  `broadcastCheckin()` in `server.js`.
- Consumer code: `src/hooks/useSocket.js` in the display repo.

## Payload — exactly four fields, never more

```json
{ "firstName": "Amelia", "club": "Sparks", "isBirthday": false, "isFirstTimer": true }
```

| Field | Type | Meaning |
|---|---|---|
| `firstName` | string, required, non-empty | Kid's first name (display truncates to 40 chars) |
| `club` | string, optional | Club name; the display maps Puggles/Cubbies/Sparks/T&T/Trek/Journey (and aliases) to color palettes, unknown values get the default Awana orange |
| `isBirthday` | strict boolean | `true` = birthday **week** (computed from the roster CSV `Birthdate` via `isBirthdayWeek`) |
| `isFirstTimer` | strict boolean | `true` = the visitor checkbox was ticked at check-in |

**Privacy invariant — do not relax.** Allergy info, last names, contact
info, photos, med-release status, and any future roster fields must NEVER
be added to this payload. The display enforces the same allowlist in its
`sanitize()` function, and both repos have contract tests (here:
`test/checkin-payload.test.js`) that fail if the shape drifts. The
canonical test fixture, used verbatim on both sides, is the JSON above.

## Semantics

- Fired **once per successful new print** (`POST /print`).
- Duplicate prints are suppressed server-side (25-second window per full
  name), so duplicates never reach the display.
- **`POST /reprint` deliberately does NOT broadcast** — the kid already got
  their banner, and reprints bypass the duplicate gate.
- `POST /test-checkin` fires a contract-shaped test event
  (`firstName: "Test"`) for end-to-end pairing verification.
- Pusher does not replay missed events: if the display is offline when an
  event fires, that event is simply gone. The display is a celebration
  surface, not a system of record — print history lives on the server.
- Broadcasting requires the **standalone print server**
  (`print-server/server.js`). The Electron app's embedded server does not
  broadcast.

## Observability

- `GET /health` → `pusher: { configured, cluster, triggerCount, lastTriggerAt, lastError }`
- `GET /diagnostics` → "Welcome screen broadcast" check
- Dashboard → Settings tab → "Test Welcome Screen" button
