# AI-powered Connectors (OpenAI)

**Date:** 2026-06-19
**Status:** Approved, implementing (Phase 1)

Turns the cosmetic Connectors mock into real AI-powered data ingestion. A member
links an external work-schedule or bank source; an LLM extracts structured shifts
or transactions; the results land in the household **Schedule** / **Finance** as
**managed, read-only** items tagged to the connection.

## Non-negotiable: no stored credentials

We do **not** store login credentials or auto-login to scrape banks/employers.
That pattern is what Plaid/OAuth exist to replace, violates provider ToS, breaks
on 2FA/CAPTCHA, and turns the household state into a catastrophic breach target.
Instead the AI works on **data the user provides** (Phase 1) or data pulled via
proper **OAuth/open-banking** (Phase 2). No password field ever appears.

## Provider model

`ConnectorProvider` (in `lib/constants.ts`) gains `auth: 'ai-import' | 'oauth'`.
The connect flow branches on it. Phase 1 implements `ai-import` end-to-end; Phase 2
implements `oauth` and is env-gated.

| Provider | kind | auth (P1) |
|----------|------|-----------|
| Google Calendar | calendar | oauth (P2) |
| Outlook / Apple / Workday / Deputy | calendar | ai-import |
| Link a Bank (Plaid) | bank | oauth (P2) |
| Chase / BofA / Wise / PayPal | bank | ai-import |

Until Phase 2 ships, `oauth` providers show a "coming soon — use an import-capable
provider" note rather than a broken flow.

## Phase 1 — AI import (deliverable now)

### Connect flow (`components/views/Connectors.tsx`)
- The connect modal for an `ai-import` provider offers three inputs, **no password**:
  *paste text*, *upload a file* (screenshot / PDF / CSV — roster, payslip, statement),
  or a *public URL*.
- Submitting calls `POST /api/connectors/extract`, which returns **proposed** items.
- A preview step shows "Found N shifts / N transactions"; the user confirms.
- On confirm, the client `update()`s state: it creates the `Connection` (if new) and
  inserts the items tagged `source: 'connector'`, `connectionId`. `Connection.synced`
  is the real count.
- "Sync now" for an `ai-import` connection re-opens the import dialog ("import more");
  it does not silently re-pull. `autoSync` is hidden for `ai-import` (nothing to pull).

### Server extraction (`lib/ai/extract.ts`)
- Calls the **OpenAI** REST API via `fetch` (no SDK dependency). Key from
  `OPENAI_API_KEY` (server-only); model from `OPENAI_MODEL`, default a current
  GPT-4-class **vision** model so images/PDFs work. Uses structured outputs
  (`response_format: json_schema`) so the model returns schema-valid JSON.
- Split into **pure** and **impure** halves so the logic is unit-testable without
  the network:
  - `parseShiftsResponse(raw, ctx)` / `parseTxnsResponse(raw, ctx)` — pure: validate
    the model JSON, normalize dates (`YYYY-MM-DD`) and times (`HH:MM`) / amounts
    (positive numbers, income vs expense), drop malformed rows, clamp counts.
  - `mapToEvents(rows, conn, memberId)` / `mapToTxns(rows, conn, memberId)` — pure:
    convert validated rows into `CalEvent` / `Transaction` tagged to the connection.
  - `extractShifts(input, ctx)` / `extractTransactions(input, ctx)` — async: build the
    prompt, call OpenAI, then run the pure parser.

### Route (`app/api/connectors/extract/route.ts`)
- `runtime = 'nodejs'`, auth required (`getSessionUser`).
- Body: `{ kind, providerId, text?, fileBase64?, mime?, url? }`.
- Guards: payload size cap; for `url`, reuse the SSRF guard from `lib/discovery.ts`
  (no localhost/private ranges); if `OPENAI_API_KEY` is unset, return
  `{ ok:false, reason:'ai-unavailable' }` (mirrors the CCTV cloud-gate pattern).
- Returns `{ ok:true, items }` — proposed, validated items only. Never writes state
  itself; the client inserts on confirm (keeps the whole-state persistence model).

### Type & model changes (`lib/types.ts`)
- `CalEvent` and `Transaction` each gain `source?: 'connector'` and `connectionId?: number`.
- Existing manual items leave both undefined — fully backward-compatible.

### Read-only guards
- **Schedule** (`components/views/Schedule.tsx`): synced events in the day panel and
  the `ViewEventModal` (`hooks/useActions.tsx`) show a provider badge; the modal's
  Delete button is replaced with "Managed by {provider} — disconnect in Connectors".
  `deleteEvent` early-returns on a connector-sourced event (defense-in-depth).
- **Finance** (`components/views/Finance.tsx`): synced transaction rows show the badge
  and hide their delete control; `deleteTx` early-returns on connector-sourced txns.

### Disconnect
- `disconnect(c)` removes the connection **and** every `events` / `transactions` item
  whose `connectionId === c.id`.

## Phase 2 — OAuth / open-banking (scaffold, env-gated)

- Google Calendar via OAuth, banks via Plaid — real token flows, no passwords.
- Needs registered client IDs/secrets (`GOOGLE_*`, `PLAID_*`); flow is hidden unless
  those env vars are present. AI's role shifts to categorize/dedupe pulled data.
- `autoSync` (re-pull on app load) applies only to `oauth` connections.
- Interfaces are stubbed in Phase 1 so provider registration never blocks the core.

## Testing / verification

- Unit-test the **pure** extraction layer (`test/connector-extract.test.js`):
  - A well-formed mocked model response → correctly typed `CalEvent[]` / `Transaction[]`.
  - Garbage / missing fields rejected; malformed rows dropped, not crashed.
  - Date/time/amount normalization; income vs expense sign; count clamping.
  - `mapTo*` tags `source`/`connectionId` and assigns the member.
- Typecheck + `npm run build` green.
- Manual: paste a roster for a member → read-only shifts appear in Schedule; upload a
  statement image → transactions appear in Finance and the balance moves; disconnect
  → all imported items vanish; an `oauth` provider shows the coming-soon note.
</content>
</invoke>
