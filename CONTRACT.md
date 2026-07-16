# Awana Event Bus Contract (v2)

This document pins the payload schemas for every event on the shared Pusher
channel **`awana-channel`**. The **print server in this repo is the ONLY
publisher** (it holds the Pusher secret); the consumer apps —
[Awana-Check-in-Display](https://github.com/patrick-simpson/Awana-Check-in-Display)
and [KVBC-Awana-Countdown](https://github.com/patrick-simpson/KVBC-Awana-Countdown) —
subscribe with the public key only.

The machine-readable version of this contract is
[`contract-vectors.json`](./contract-vectors.json) — **this repo holds the
canonical copy**, mirrored byte-identical into each consumer repo. Each repo's
tests validate against its own copy, so any drift breaks a build somewhere.

## The privacy rule

> **Only first names ever ride the channel.** No last names, no allergies, no
> contact info, no birth years, no photos. The payload builders in
> [`print-server/events.js`](./print-server/events.js) enforce this
> structurally (they never accept those fields), and every consumer runs each
> event through its own strict allowlist sanitizer before anything reaches a
> screen.

## Events

### `checkin` — one child checked in (v2)

Published on every successful label print (canary test prints excluded).

| Field | Type | Notes |
|---|---|---|
| `id` | string (uuid) | NEW in v2 — consumers dedupe live vs recap delivery on this. Optional for consumers (deploy-order safety). |
| `at` | string (ISO 8601) | NEW in v2 — lets consumers age out stale replays. Optional for consumers. |
| `firstName` | string | First name only, ≤40 chars |
| `club` | string | Club display name as TwoTimTwo reports it |
| `isBirthday` | boolean | Birthday-week flag |
| `isFirstTimer` | boolean | Visitor flag |

### `recap` — replay buffer (every ~2 min during club hours)

The last ≤15 `checkin` payloads (same shape, `id`+`at` required per entry) so
a display that reconnects mid-event can celebrate the kids it missed.

| Field | Type |
|---|---|
| `entries` | array of `checkin` payloads (consumers cap at 30) |
| `at` | string (ISO 8601) |

### `tally` — per-club checked-in counts (each check-in + every ~60 s)

Zero PII — numbers only. Keys are club display names exactly as the check-in
system reports them; each consumer normalizes through its own alias map.

| Field | Type |
|---|---|
| `counts` | object `{ "<club name>": int ≥ 0 }` (≤30 clubs) |
| `total` | int ≥ 0 |
| `at` | string (ISO 8601) |

### `birthdays` — this week's birthday kids (startup + every ~10 min on club night)

First names only, ever. `month`/`day` are the birthday's calendar month/day
(ints, **no year**) so the countdown app reuses its pure week-matching.

| Field | Type |
|---|---|
| `entries` | array of `{ firstName, club, month (1-12), day (1-31) }` (≤40) |
| `at` | string (ISO 8601) |

### `ops` — operator telemetry (never a public banner)

| Field | Type | Notes |
|---|---|---|
| `type` | `"print-failure" \| "canary" \| "selector-fail"` | |
| `club` | string (optional) | Club only — **never a name** |
| `at` | string (ISO 8601) | |

### `canary` — end-to-end pipe test (POST /canary)

| Field | Type |
|---|---|
| `at` | string (ISO 8601) |
| `nonce` | string (optional, ≤64) |

## Validation

```bash
npm run test:contracts   # → node scripts/test-contracts.cjs
```

Validates every builder in `print-server/events.js` against the vectors:
exact key sets, correct types, PII structurally impossible, plus the
`isClubNightNow()` scheduling gate.

## Changing the contract

1. Update `contract-vectors.json` **here first** (canonical copy).
2. Update the builders + `test-contracts.cjs`, keep them green.
3. Mirror the vectors file byte-identical into both consumer repos and update
   their sanitizers/tests in the same change.
4. New fields must be optional for consumers for at least one release cycle so
   deploy order never matters.
