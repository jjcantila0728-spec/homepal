# HomePal — Family Hub

A multi-tenant SaaS family hub: shared **calendar**, **finances** (budgets, savings, debts,
recurring bills), **smart-home** control (lights, locks, cameras, climate, scenes, automations),
**chores & shopping**, and **family management** — behind real accounts, a Postgres database, and
Stripe billing. Installable as a PWA.

## Stack

| Layer | Tech |
|-------|------|
| Framework | **Next.js 15** (App Router) + **React 19** + **TypeScript**, front-to-back |
| Database | **Postgres** (`pg`) — whole household state stored as `jsonb` |
| Auth | `node:crypto` scrypt password hashing + HS256 JWT in an httpOnly cookie, guarded by `middleware.ts` |
| Billing | **Stripe** subscriptions (`free` / `pro`), Checkout + Customer Portal, webhook-synced plan |
| Charts | `react-chartjs-2` / `chart.js` |
| Styling | Tailwind (compiled) + CSS variables; `Space Grotesk` + `Plus Jakarta Sans` |
| Tests | `node --test` over `test/**/*.test.js`, exercising the shipping `lib/` modules |

Data flow: the authenticated app layout loads household state server-side from Postgres and hydrates
the client store, which persists changes back with a debounced `PUT /api/state`.

## Plans & entitlements

- **Free** — the core hub: calendar, finance, chores & shopping, family, up to 4 members.
- **Pro** ($9/mo) — unlocks smart-home control, **automations & scenes**, **CCTV recording**,
  **voice control**, and **device discovery**, plus unlimited members.

Entitlements are enforced server-side in the API routes via `lib/entitlements.ts#can(plan, feature)`
and reflected in the UI (gated views render an upgrade prompt). See [lib/entitlements.ts](lib/entitlements.ts).

## API

All routes are App Router handlers under [app/api/](app/api/). Non-auth, non-webhook routes require a
valid session cookie (enforced by [middleware.ts](middleware.ts)).

| Route | Purpose |
|-------|---------|
| `POST /api/auth/{register,login,logout}`, `GET /api/auth/me` | Account + session lifecycle |
| `GET/PUT /api/state` | Read / replace the household state (owner-scoped) |
| `POST /api/stripe/checkout` | Stripe Checkout session → Pro upgrade |
| `POST /api/stripe/portal` | Stripe Customer Portal session |
| `POST /api/stripe/webhook` | Signature-verified plan sync (raw body) |
| `GET /api/cctv/status`, `POST /api/cctv/{test,config}`, `GET /api/cctv/{clips,clip}` | CCTV (Pro; self-host) |
| `GET/POST /api/discover` | LAN device discovery (Pro; self-host) |

## CCTV & device discovery (self-hosting)

CCTV recording and LAN discovery need HomePal running on your home network with `ffmpeg` installed —
a cloud host can't reach cameras or devices behind your router. The hosted app detects this
(`HOMEPAL_CLOUD=1` or absent ffmpeg) and degrades to a "requires self-hosting" banner while still
letting you pre-configure cameras and storage. RTSP credentials are encrypted at rest (AES-256-GCM,
[lib/crypto.ts](lib/crypto.ts)) and only ever returned to the UI masked.

## Run locally

```sh
npm install
npm run dev        # → http://localhost:3000
```

Set the required environment, then open <http://localhost:3000> and create an account.

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection string (required) |
| `JWT_SECRET` | Session token signing key (required) |
| `HOMEPAL_SECRET` | Pins the AES key for RTSP secrets (recommended) |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_WEBHOOK_SECRET` | Stripe billing |
| `NEXT_PUBLIC_APP_URL` | Public base URL for Stripe redirect URLs |
| `HOMEPAL_CLOUD` | Set to `1` on a hosted deploy to disable local-only features |

Migrations in [db/migrations/](db/migrations/) are applied at boot via [instrumentation.ts](instrumentation.ts).

## Scripts

```sh
npm run dev      # next dev
npm run build    # next build
npm start        # next start (production)
npm test         # node --test "test/**/*.test.js"
npm run lint     # next lint
```

## Deploy

Needs a Node.js host and a Postgres database. Set the environment above (with `HOMEPAL_CLOUD=1`),
point the Stripe webhook at `<APP_URL>/api/stripe/webhook`, and run `npm run build` then `npm start`.
The [Procfile](Procfile) declares `web: npm start`.

## Layout

| Path | Purpose |
|------|---------|
| `app/` | App Router: pages, the authenticated `/app/*` hub, and `/api/*` routes |
| `components/` | Shell, views (Dashboard, Schedule, Finance, Home, CCTV, Tasks, Family), UI + billing |
| `lib/` | Server + shared logic: db, auth, session, state, seed, stripe, entitlements, crypto, cctv engine, discovery |
| `store/` | Client household store (hydrate + debounced persist) |
| `hooks/` | `useActions` — every user action and modal |
| `db/migrations/` | SQL migrations applied at boot |
| `test/` | `node --test` suites over `lib/` |
| `public/` | PWA `manifest.webmanifest` + `icon.svg` |
