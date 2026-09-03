# Club Event Bus Contract (v5)

This document pins the payload schemas for every event on the shared Pusher
channel **`awana-channel`**. The **print server in this repo is the ONLY
publisher** (it holds the Pusher secret); the consumer is
[Awana-Check-in-Display](https://github.com/patrick-simpson/Awana-Check-in-Display) —
both its signage page and its presentation page (`/countdown.html`, which
absorbed the retired KVBC-Awana-Countdown app) — subscribing with the
public key only.

The machine-readable version of this contract is
[`contract-vectors.json`](./contract-vectors.json) — **this repo holds the
canonical copy**, mirrored byte-identical into the consumer repo at
`src/lib/__fixtures__/contract-vectors.json`. Each repo's tests validate
against its own copy, and the consumer repo's CI byte-compares its mirror
against this repo's canonical file, so any drift breaks a build somewhere.

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
| `isFirstTimer` | boolean | Welcome flag: the operator's explicit visitor mark, or (when the publisher's `connectCardAutoFirstTimer` setting is on) an auto-detected first-ever check-in. Same field, same type — consumers need no change. |
| `welcomeBack` | OPTIONAL literal `true` — a RETURNING kid's first night of the season (#9). Sealed with the rest of the payload; fits the fixed 512-byte pad with wide headroom. |
| `milestone` | OPTIONAL int 1–999 — the season night-count on a label-milestone night (5/10/25/50), for the display's milestone wall (#10). Sealed; per-child data never rides plaintext. |

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
| `season` | OPTIONAL string, lowercase slug (e.g. `christmas`) — the printer's unified-theming broadcast (#18); absent when seasonal art is off. Zero PII. |
| `rehearsal` | OPTIONAL literal `true` — present only while rehearsal mode (#19) is armed, so displays watermark themselves. Absent otherwise. |

Both optional fields stay optional forever: consumers drop unknown fields, so
deploy order between the repos never matters.

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
| `type` | `"print-failure" \| "canary" \| "selector-fail" \| "update-ok"` | `update-ok` NEW: the opt-in update health beacon (#5) — the first boot of a freshly-updated print server announces it came back cleanly. |
| `club` | string (optional) | Club only — **never a name** |
| `version` | string (optional) | Bare semver (`5.27.0`), only on `update-ok`. Version + the ok that the event exists at all — nothing else ever rides this. |
| `at` | string (ISO 8601) | |

### `canary` — end-to-end pipe test (POST /canary)

| Field | Type |
|---|---|
| `at` | string (ISO 8601) |
| `nonce` | string (optional, ≤64) |

### `slides` — the operator's typed lobby slide deck (v5, sealed, chunked)

Published by the print server when the operator publishes the typed slide
deck (dashboard "Lobby slides" card, or the display app's slide editor
POSTing to `/api/lobby-slides`), then rebroadcast whole every ~5 minutes
while the server runs so a rebooted screen converges without a handshake.

**TEXT ONLY.** The display app's video slides reference bytes in one
device's own storage, so the publisher strips them and every consumer's
sanitizer drops them. The deck is arbitrary operator-authored copy, which is
why this event rides **sealed** like the name-bearing four.

One publish is split into chunks to stay under Pusher's per-message ceiling.
Every chunk of a publish carries identical `deckRev` + `publishedAt`:

| Field | Type | Notes |
|---|---|---|
| `deckRev` | int ≥ 1 | Operator-facing counter. Chunk grouping only — **never** the ordering authority; it may restart at 1 if the server loses its state file. |
| `publishedAt` | string (ISO 8601) | **The** ordering + anti-replay authority. A consumer commits an assembled deck iff its `publishedAt` is strictly newer than the committed one. Rebroadcasts reuse it byte-identically. |
| `seq` | int, `0 ≤ seq < total` | Chunk index. |
| `total` | int, 1–12 | Chunk count for this publish. |
| `slides` | array | `{ id? (≤64), eyebrow (≤60), text (required, ≤500, multi-line), theme (whitelist else "auto"), textSize (whitelist else "auto"), durationSec (0 or 3–600) }`. ≤50 per deck. `slides: []` is legal only when `total` is 1 — an explicitly cleared deck propagates. |

The publisher refuses — at publish time, before committing anything — any
deck that cannot be broadcast within the 12-chunk ceiling (greedy packing
can strand slack per chunk, so a raw byte cap alone is not a guarantee),
and also caps a whole deck's serialized JSON at 40 000 bytes. Every chunk
of an accepted publish seals into the `slides` pad ladder (`[2048, 4096]`,
**fail closed** above — the 8192 rung would base64-inflate past Pusher's
ceiling, so it must not exist for this event).

### `update` — laptop-internal release ping (NOT part of the display contract)

Published once by the release workflow (`.github/workflows/build-electron.yml`)
after a new Windows build's installer + `latest.yml` are already live on the
GitHub Release, so the Electron shell can auto-update within a minute or two
of a release instead of waiting on its periodic poll.

| Field | Type | Notes |
|---|---|---|
| `version` | string | The released semver, e.g. `"5.8.0"` — no `v` prefix. |
| `at` | string (ISO 8601) | Publish time. Logged only, never used for any decision. |

**This event is consumed only by the Electron print-server app itself**
(`electron-app/main.js` subscribes to it and calls `checkForUpdates()`), not
by any display. It rides the same public channel as every other event above
purely because that channel and its key already exist — a fork's displays
bind only the event names they know about, so an extra event name on the
channel is invisible to them by construction, but the rule is stated here
explicitly rather than left implicit:

- **Never anything but a version string and a timestamp.** No child or
  household data is even reachable from the release workflow that publishes
  this, but the same discipline applies as every other event: if a future
  change ever wants to put more on this event, it still may not carry PII.
- **Displays MUST ignore it.** No display-side sanitizer or contract vector
  covers `update`, and none should ever be added — a display binding this
  event would be relying on undocumented behaviour outside this contract.
- **It cannot forge a release.** The channel is public, so anyone can see or
  even publish a fake `update` event with a bogus version — but all that
  triggers is a normal `checkForUpdates()`, which electron-updater then
  verifies independently against the real GitHub Releases feed. Worst case is
  one harmless extra check, not a forced install of anything.

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
3. Mirror the vectors file byte-identical into Awana-Check-in-Display
   (`src/lib/__fixtures__/contract-vectors.json`) and update its
   sanitizers/tests in the same change.
4. New fields must be optional for consumers for at least one release cycle so
   deploy order never matters.

## The transport: sealed envelopes

The Pusher channel is **public**, and Pusher public channels have no
server-side authorization primitive — subscription is granted by possession of
the app key, which must ship in the display's public bundle. So the four
name-bearing events (`checkin`, `recap`, `birthdays`, `checkout`) and the
operator-authored `slides` deck are **encrypted** with AES-256-GCM before
publish; the remaining events ride in the clear on purpose.

This is a **transport** layer, strictly outside the contract above:

- No payload vector changes. A sealed frame is opened and then handed to the
  same allowlist sanitizer a plaintext one would be — decryption sits *in front
  of* the privacy boundary, never beside it. A frame that authenticates is
  authenticated, not trusted.
- The framing (envelope version, AAD construction, padding sizes, ciphertext
  layout) and a cross-implementation interop fixture live in
  **`envelope-vectors.json`**, mirrored byte-identically into the display repo
  exactly like this file. Both repos assert they can open every envelope in it,
  which is what stops the Node seal and the WebCrypto open from drifting.
- **Changing the framing is a bigger deal than adding a field.** There is no
  partial failure: either the two sides agree or no child's name renders
  anywhere. Bump `ENVELOPE_VERSION` (which changes the AAD, so old frames stop
  authenticating rather than silently misparsing), regenerate the fixture with
  `npm run gen:envelope-fixture`, mirror it, and land both repos together.
- Padding is part of the spec, not an optimisation. GCM adds no padding, so an
  unpadded envelope reveals `len(firstName) + len(club)` — and club is inferable
  by correlating the **plaintext** `tally`. `npm run test:envelope` fails the
  build if two `checkin` frames ever differ in length.

See the display repo's SECURITY.md for what remains exposed (timing and
headcount, irreducibly) and for the operator-facing setup and rollback.

### `provision` — display login (device provisioning, NOT a display event)

A second, separate channel carries one more sealed frame so a screen can be
provisioned by typing a passphrase instead of pasting keys:

- **Channel:** `cache-<channel>-provision` (a Pusher *cache* channel — a new
  subscriber receives the last published frame immediately, or
  `pusher:cache_miss`). With the default channel that is
  `cache-awana-channel-provision`.
- **Event:** `provision`. Published at startup, on every config save that
  touches the display key / publish token / passphrase, and every 5 minutes
  (Pusher's cache keeps a frame ~30 minutes, so the heartbeat is the delivery
  path). Published **only** when both a passphrase and a display key exist.
- **Frame:** `{ v: 1, kdf: { name: "PBKDF2-SHA256", iterations, salt },
  envelope: { v: 1, kid, iv, ct } }`. The envelope is the standard framing
  above, sealed under `PBKDF2-SHA256(NFKC(trim(passphrase)), salt,
  iterations, 32 bytes)` with AAD `utf8("1:provision")`, padded on the
  standard ladder; `kid` is the wrapping key's fingerprint.
- **Bundle (inside `ct`):** `{ v: 1, displayKey, slidesPublishToken, issuedAt }`
  — `displayKey` base64 of 32 bytes, `slidesPublishToken` either `""` or
  24–64 URL-safe characters, `issuedAt` ISO 8601. A display rejects any bundle
  that fails those shapes and applies nothing; it ignores a bundle whose
  `issuedAt` is older than the last one it applied (replay).
- **It is not one of the display-contract events.** It is never routed through
  the event sanitizers, never rendered, and not in the encrypted-events set
  (it is sealed under the wrapping key, not the display key). Opening it only
  ever writes the display key and publish token into their own storage on the
  device. Displays that predate it never subscribe to the channel.
- **Fixture:** the `provision` section of `envelope-vectors.json` pins the
  KDF parameters and a deterministic passphrase → derived key → kid vector plus
  a sealed frame both implementations must open to the same bundle.
