# Web-Scrape Connectors — guided login + cloud browser + auto-replay

**Date:** 2026-06-19
**Status:** Approved (design); implement Phase 1 first

Let a member connect an **arbitrary** workplace scheduling portal (Kronos/UKG,
Deputy web, a hospital roster, etc.) — not just the curated provider list. The
member drives a **streamed cloud browser** to log in once; HomePal captures the
authenticated session, runs the **existing AI extractor** on the schedule page,
and imports the shifts. Credentials are stored encrypted so a scheduled job can
**auto-replay** the login and re-sync, pausing for the member when it hits MFA.

This extends the now-live AI-import Connectors with a third ingestion mode.

## Decisions (locked during brainstorming)

- **Runtime:** cloud, via a **managed remote-browser provider** (Browserbase /
  Steel / Browserless) behind a swappable adapter, env-gated like `OPENAI_API_KEY`.
- **Credentials:** store username + password **encrypted at rest**, plus the
  captured session cookies; a scheduled job auto-replays login. On MFA / bot
  challenge it **pauses and notifies** the member with a live-view link to finish.
- **Scrape → shifts:** reuse `extractShifts` (`lib/ai/extract.ts`, `kind:'calendar'`)
  on the captured page text/screenshot. No new AI code.

## Honest constraints (documented, not hidden)

- Unattended auto-replay **cannot pass MFA by itself** — hence the pause-and-notify
  fallback. Sites with mandatory per-login MFA effectively require a human step
  each sync; sites with "remember this device" / long-lived sessions can run
  unattended via stored cookies.
- Scraping a portal may violate its ToS and trip anti-bot defenses. This is the
  member's **own account** (authorized self-use); we rate-limit syncs and keep
  one session per connection.
- Concrete provider selection (Browserbase vs Steel vs Browserless) is finalized
  at implementation behind the adapter interface; the design does not hard-depend
  on one.

## Security model (the spine of this feature)

**Secrets never enter client-synced state.** The household state JSON is sent to
every signed-in client of the household. Therefore encrypted credentials and
cookies live **only** in a new server-only Postgres table, keyed by connection
id, and are read exclusively by the API routes. The household state holds only
**non-secret** connection metadata.

- AES-256-GCM (`node:crypto`) in `lib/scrape/vault.ts`; key from `HOMEPAL_SECRET`
  (32-byte, derived via SHA-256 if needed). Ciphertext stores `{ username,
  password, cookies }`. IV + auth tag stored alongside.
- Remote-browser API key is server-only (`REMOTE_BROWSER_API_KEY`,
  `REMOTE_BROWSER_PROVIDER`).
- Live-view URLs are per-session and short-lived; sessions are closed after
  capture.
- Authorization: only the owning member (or an admin) can create, sync, or
  disconnect a web-scrape connection — mirroring existing per-member rules.

## Architecture

| File | Responsibility |
|------|----------------|
| `lib/scrape/browser/types.ts` (new) | `RemoteBrowser` adapter interface: `createSession() → { sessionId, liveViewUrl, cdpUrl }`, `closeSession(id)`. Provider-agnostic. |
| `lib/scrape/browser/index.ts` (new) | `getRemoteBrowser()` — selects the concrete adapter from `REMOTE_BROWSER_PROVIDER`; returns null when unconfigured (feature disabled, like AI). |
| `lib/scrape/browser/browserbase.ts` (new) | Concrete adapter for the chosen managed provider (REST create/close session + live-view + CDP endpoint). |
| `lib/scrape/vault.ts` (new, pure) | AES-256-GCM `seal(obj)` / `open(blob)` with `HOMEPAL_SECRET`. Unit-tested round-trip. |
| `lib/scrape/capture.ts` (new, pure) | `toExtractInput(page)` builds an `ExtractInput` from captured text/screenshot; `detectChallenge(text)` heuristically flags MFA/login walls. Unit-tested. |
| `lib/scrape/secrets.ts` (new, server-only) | DB accessors for the `connector_secrets` table: `saveSecret`, `loadSecret`, `deleteSecret`. Stores only sealed blobs. |
| `lib/scrape/driver.ts` (new, server-only) | Orchestrates Playwright-over-CDP against an adapter session: `gotoAndCapture(cdpUrl, url)` → `{ text, screenshot, cookies }`; `restoreCookies`, `replayLogin(creds)`. |
| `lib/migrate.ts` (modify) | Add migration creating `connector_secrets (connection_id int primary key, sealed text not null, updated_at timestamptz default now())`. |
| `lib/types.ts` (modify) | Add `'web-scrape'` to the provider `auth` union; add non-secret web fields to `Connection`: `scheduleUrl?`, `siteUrl?`, `syncStatus?: 'ok' \| 'needs_attention'`. |
| `lib/constants.ts` (modify) | Add a calendar provider `{ id:'workplace-web', name:'Workplace Portal', auth:'web-scrape', blurb:'Log in once in a guided browser — AI reads your shifts' }`. |
| `app/api/connectors/web/session/route.ts` (new) | POST → create a remote session, return `{ sessionId, liveViewUrl }`. Auth-protected. |
| `app/api/connectors/web/capture/route.ts` (new) | POST `{ sessionId }` → capture current page (cookies+text+screenshot), run `extractShifts`, return `{ rows, scheduleUrl, challenge }`. Does **not** persist yet. |
| `app/api/connectors/web/save/route.ts` (new) | POST `{ sessionId, providerId, credentials?, scheduleUrl, rows }` → seal credentials+cookies into `connector_secrets`, create the Connection (non-secret), import rows via the existing event-mapping path. |
| `app/api/connectors/web/sync/route.ts` (new) | POST `{ connectionId }` → load secret, restore cookies (or `replayLogin` if expired), `gotoAndCapture(scheduleUrl)`, extract, import new rows. On challenge → set `syncStatus:'needs_attention'`, push alert, return a fresh live-view link. |
| `app/api/connectors/web/cron/route.ts` (new) | Header-secret-protected; iterates auto-sync web connections and runs the sync path. Scheduled externally. |
| `components/views/connectors/WebConnectModal.tsx` (new) | Live-view iframe + steps (open → log in → Capture schedule → preview rows → optional "save my login for auto-sync" → Import). Reuses `PreviewRow`. |
| `components/views/Connectors.tsx` (modify) | Route `auth:'web-scrape'` providers to `WebConnectModal`; web connection rows show `syncStatus` + "Finish login" when attention is needed. |
| `test/web-scrape.test.js` (new) | Pure unit tests. |

## Data flow — first connect (Phase 1)

1. Member selects themselves, opens the **Workplace Portal** connector →
   `WebConnectModal`.
2. Modal calls `/session`; server asks the adapter for a remote browser and
   returns a `liveViewUrl`. The modal embeds it in an iframe.
3. Member navigates to their portal and logs in (MFA included) **inside the
   streamed browser**. HomePal does not see keystrokes; it only later reads
   cookies + the rendered page.
4. Member clicks **Capture schedule**. `/capture` drives the session via
   `driver.gotoAndCapture` (current URL), pulls cookies + page text/screenshot,
   records the `scheduleUrl`, runs `extractShifts`, and returns preview rows
   (and a `challenge` flag if the page still looks like a login/MFA wall).
5. Member reviews rows (reused preview UI). Optionally ticks **"Save my login so
   HomePal can re-sync automatically"** (captures username/password from a small
   form in the modal — the only place credentials are entered, sent once to
   `/save` over HTTPS).
6. `/save` seals `{ username?, password?, cookies }` into `connector_secrets`,
   creates the non-secret `Connection` (`providerId:'workplace-web'`, account
   label = portal host, `scheduleUrl`, `syncStatus:'ok'`), and imports the rows
   via the existing `mapToEvents` path. Session is closed.

## Data flow — re-sync (manual or scheduled, Phase 2)

1. `/sync` (or `/cron`) loads the sealed secret, opens an adapter session.
2. `driver.restoreCookies(cookies)` → `gotoAndCapture(scheduleUrl)`.
3. If `detectChallenge` says the cookies expired **and** credentials are stored →
   `driver.replayLogin(creds)`, then capture again.
4. If still challenged (MFA) → set `syncStatus:'needs_attention'`, push an alert,
   and surface a **"Finish login"** action that opens a fresh live-view restoring
   the session; the member completes MFA and re-captures.
5. Otherwise extract + import only **new** shifts (dedupe by date+start+title
   against existing connector-owned events for this connection), refresh cookies
   in the vault, update `lastSync`.

## Disconnect

Extend the existing `disconnect`: in addition to removing the connection and its
managed events, call `/web/sync`'s sibling cleanup to `deleteSecret(connectionId)`
so no sealed credentials linger.

## Error handling

- `REMOTE_BROWSER_*` unset → provider returns null; the Workplace Portal card
  shows "Guided web import isn't configured on this server" (same pattern as the
  AI key).
- `HOMEPAL_SECRET` unset → `/save` refuses to store credentials (offers
  session-only mode where re-sync re-prompts login).
- Adapter/session errors, capture timeouts → typed reasons surfaced in the modal;
  the session is always closed in a `finally`.
- `extractShifts` failure / empty → show "No shifts found on that page; navigate
  to your schedule and capture again."

## Testing / verification

- Pure `node --test` (`test/web-scrape.test.js`):
  - `vault.seal`/`open` round-trip; tampered blob fails the GCM auth tag.
  - `capture.detectChallenge` flags login/MFA text and passes a real schedule.
  - `capture.toExtractInput` chooses text vs image input correctly.
  - adapter selection returns null when env is unset.
- Route tests with a **mock** `RemoteBrowser` adapter and mock DB: session →
  capture → save imports rows; sync dedupes; challenge sets `needs_attention`;
  disconnect deletes the secret.
- Typecheck + build green.
- Manual: connect a real portal via live view, log in, capture, import; trigger a
  re-sync; confirm secrets never appear in the client household-state payload.

## Phasing (build order)

- **Phase 1 — Guided interactive import.** Adapter + live-view modal + capture +
  reuse extractor + import; store **session cookies only** + `scheduleUrl` for
  manual "Sync now". Delivers the core "log in once, AI reads my shifts" value
  with the least risk.
- **Phase 2 — Stored credentials + scheduled auto-replay + MFA pause/notify.**
  Adds the credential vault write path, `replayLogin`, `/cron`, and the
  needs-attention UX.

## Out of scope (YAGNI)

- Bank-portal scraping (this design is calendar/schedule first; the adapter and
  vault generalize later).
- Full action-by-action macro recording/replay (cookie restore + single login
  replay covers the real cases).
- Building our own browser-streaming stack (managed provider only).
