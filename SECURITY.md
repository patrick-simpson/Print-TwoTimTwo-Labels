# Security & privacy

This app handles personal data about children: names, birthdates, allergy and
medical-release notes, guardian contact details, and photo-consent flags. This
document describes how that data is protected, what the system deliberately
does **not** protect against, and what you must check if you fork this repo.

## Trust model

The print server (`print-server/server.js`) treats its network surface in three
tiers. The rules live in one place — `print-server/security.js` — and are
enforced by an app-level gate ahead of every route.

| Caller | Trust | What it can reach |
|---|---|---|
| **Loopback** (`127.0.0.1`, `::1`) — the Chrome extension via `http://localhost:3456`, the dashboard, the Electron shell | Trusted | Everything |
| **The LAN** — phones running the check-in page | Untrusted; PIN required on **every** request | Everything except the Pusher secret and the PIN itself |
| **Any website open in the volunteer's browser** | Untrusted | Nothing, unless its origin is on the allowlist |

Three consequences worth stating plainly:

- **By default the server binds `127.0.0.1` only.** A default install is not
  reachable from the network at all — not merely PIN-protected there. LAN
  access requires `lanAccess: true` **and** a PIN; without a PIN the server
  refuses to expose itself and says so at startup and in `/health`.
- **The PIN fails closed.** No PIN configured means no LAN access, not open
  LAN access.
- **CORS is an allowlist, never `*`.** Only the extension, `*.twotimtwo.com`,
  this server's own pages, and any operator-configured `allowedOrigins` may
  read a response. Mutating requests carrying a non-allowlisted `Origin` are
  refused outright, which is what stops a hostile tab from writing to the
  server even on requests a browser would not preflight.

### What this does *not* protect against

Be clear-eyed about the limits:

- **The PIN rides plain HTTP.** It stops a bystander from reading the roster on
  the church WiFi. It does not stop someone who can already sniff or MITM that
  network. There is no TLS on the LAN surface.
- **Loopback is trusted wholesale.** Any program running as the volunteer on
  that laptop can read the roster. The threat model is a shared church laptop,
  not a compromised one.
- **The data at rest is not encrypted.** `clubbers.csv` and `print-history.json`
  are plain files in the data directory, protected only by the OS account. Keep
  the check-in laptop locked and its disk encrypted.

## Data retention

`print-history.json` is capped both by row count (`MAX_HISTORY`, 200) and by age
(`historyRetentionDays`, default 60, clamped to 1–730). Pruning happens on read
as well as write, so lowering the setting shrinks an existing file on the next
run. The roster CSVs are overwritten by each sync and are never versioned.

## Where the sensitive files live

`DATA_DIR` — everything the server writes:

- **Electron app** (the supported install): `%APPDATA%/awana-label-printer/`
  (`AWANA_DATA_DIR` is set to Electron's `userData` before the server loads).
- **Legacy script install**: `print-server/` itself — i.e. **inside the git
  working tree**.

That second case is why `.gitignore` covers `config.json`, `print-history.json`,
`attendance.json` and `events-buffer.json` as well as `clubbers*.csv` (and
`households*.csv`, kept ignored for any legacy install that still has one on
disk). `config.json` holds the **Pusher app secret and the phone PIN**; the
CSVs hold children's and guardians' personal data.

> **If you have ever run the legacy script install from a clone of this repo,
> check `git status` before committing anything.** Prior to v5.3.0 only
> `clubbers*.csv` was ignored, so a `git add -A` could commit the church's
> Pusher secret, the phone PIN, the full household export and every child's
> check-in history.

## Forking this repo

Work through this list before you run a fork in production.

1. **Check nothing sensitive is already committed.**
   ```sh
   git log --all --name-only --diff-filter=A | sort -u | grep -Ei 'clubber|household|history|config\.json|attendance'
   ```
   Anything real that shows up is in your history permanently until you rewrite
   it (`git filter-repo`) **and** rotate the exposed secret. Deleting the file
   in a later commit is not enough — forks and clones keep the old objects.

2. **Rotate anything the upstream repo might have seen.** Generate your own
   Pusher app; never reuse a key or secret from another church's install.

3. **Set your own church identity.** `print-server/church-config.json`
   (`churchName`, `subdomain`, `checkinUrl`, `pusherChannel`, `clubNights`).
   The baked defaults in `server.js` point at KVBC, so a fork that skips this
   opens another church's check-in page.

4. **Point the legacy installer at your fork.** `install-and-run.ps1` derives
   its download URL from `$RepoSlug`, which still defaults to the upstream
   repo. Change it, or pass `-RepoSlug your-org/your-fork`. Otherwise your
   installer downloads upstream's code and silently discards your changes.

5. **Never commit a Pusher app secret**, in `config.json`, in a workflow file,
   or in a README example. The secret allows publishing to your church's
   screens.

6. **Keep the sanitizer contract intact.** `contract-vectors.json` is the
   canonical definition of what may ride the Pusher channel, mirrored
   byte-identically into the display repo. Only first names ever go on the
   wire — never last names, allergies, contact details or birth years. See
   `CONTRACT.md`.

7. **Run the tests.** `npm test` includes `scripts/test-server-security.cjs`,
   which asserts the properties above end to end — including that a default
   install is unreachable on the LAN. If you change the middleware order, the
   bind logic or the dashboard's output escaping, that suite is what tells you
   whether you broke the roster's protection.

## The Pusher channel is public by design

The display app subscribes to a **public** Pusher channel, so its app key is
necessarily readable by anyone who views the signage page's source. That is why
the payload contract is PII-free: the channel carries first names, club names,
aggregate counts, and birthday month/day — nothing that identifies a child to a
stranger. Anyone with the key can subscribe and see that much. Decide
consciously whether that is acceptable for your church; see the display repo's
`SECURITY.md` for the details and the private-channel alternative.

## Reporting a vulnerability

Open a GitHub issue for anything non-sensitive. For something that would expose
children's data, contact the repository maintainer directly rather than filing a
public issue.
