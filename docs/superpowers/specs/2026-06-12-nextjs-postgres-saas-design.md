# HomePal → SaaS on Next.js + Postgres — Design

**Date:** 2026-06-12
**Status:** Approved (build it, top-tier)

## Goal

Migrate the existing HomePal "Family Hub" (a zero-dependency `node:http` + `node:sqlite`
SPA) into a production, multi-tenant **SaaS** on **Next.js + Postgres**, deployed to
**Cantila**, with **Stripe** subscription billing — while keeping the current visual design
pixel-identical.

## Decisions (locked)

- **Frontend:** Full port of the seven views from vanilla DOM rendering to **React + TypeScript**
  components inside Next.js (App Router). Reuse the exact Tailwind classes + `app.css` so the
  design does not drift.
- **Styling:** Replace the Tailwind **CDN** with a compiled Tailwind/PostCSS build; bundle Font
  Awesome and fonts (no CDN `<script>` in production).
- **Database:** **Postgres** via `pg` (thin query layer + SQL migrations, no heavy ORM).
- **Auth:** Keep scrypt password hashing + HS256 JWT, but move the token to an **httpOnly cookie**
  with Next **middleware** route-guarding (replaces Bearer-in-localStorage).
- **Local-only features (CCTV + LAN discovery):** UI fully ported; in cloud mode the API returns a
  `local-agent-required` state and the UI shows a "requires self-hosting" banner. The ffmpeg
  recording engine stays in the repo as a self-host worker — no working code deleted.
- **Billing:** **Stripe** subscriptions now — Free + Pro plans, Checkout + Customer Portal + webhook.

## Architecture

### Project structure

```
app/
  layout.tsx                  root layout (fonts, globals.css)
  globals.css                 Tailwind directives + ported app.css
  page.tsx                    marketing landing (on-brand: same fonts/colors/orbs)
  pricing/page.tsx            plans + Stripe checkout entry
  (auth)/login, register      auth screens
  app/                        authenticated hub (protected by middleware)
    layout.tsx                sidebar + header shell (client)
    page.tsx                  Dashboard
    schedule|finance|home|tasks|family|automations|cctv|billing/page.tsx
  api/
    auth/{register,login,logout,me}/route.ts
    state/route.ts            GET + PUT (whole-state jsonb)
    {members,events,transactions,chores,shopping}/route.ts   read-only
    voice/route.ts
    discover/route.ts         cloud-aware
    cctv/{status,test,config,clips,clip}/route.ts  cloud-aware
    stripe/{checkout,portal,webhook}/route.ts
lib/
  db.ts        pg pool + query/transaction helpers
  migrate.ts   run pending SQL migrations (invoked at server boot)
  auth.ts      scrypt + JWT + cookie session helpers
  session.ts   getSessionUser() for route handlers
  stripe.ts    stripe client + plan/price config + entitlements
  state.ts     load/save household state; seed default household
  cctv/         engine (self-host) + isCloud() detection
components/
  shell/*      Sidebar, Header, AmbientOrbs, MobileBar, Modal, Toast, Search, Notif
  views/*      Dashboard, Schedule, Finance, Home, Tasks, Family, Automations, Cctv, Billing
  ui/*         Card, Row, Stat, Chart wrappers (ported components.js)
store/
  household.tsx   React context: state + actions + debounced PUT persistence
db/migrations/*.sql
middleware.ts     auth guard + plan gating
tailwind.config.ts, postcss.config.mjs, next.config.ts
```

### Data model (Postgres)

Keep the app's existing **whole-state-blob** persistence — faithful, low-risk:

```sql
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text UNIQUE NOT NULL,
  password_hash         text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  stripe_customer_id    text,
  plan                  text NOT NULL DEFAULT 'free',     -- 'free' | 'pro'
  subscription_status   text,                              -- stripe status
  current_period_end    timestamptz
);

CREATE TABLE households (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state         jsonb NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON households (owner_user_id);
```

The whole family-hub state lives in `households.state` (mirrors today's `GET/PUT /api/state`).
Read-only REST endpoints query into the `jsonb`. One account = one household (as today).

### State flow (React)

`store/household.tsx` provides a `HouseholdProvider` (context) holding `state` + typed actions.
On mount it hydrates from `GET /api/state`; a debounced effect persists via `PUT /api/state`;
`navigator.sendBeacon` flushes on unload. `actions.js`/`automations.js`/`voice.js` logic ports to
typed handlers that update context. Views read derived data via selectors ported from `core.js`.
Charts use `react-chartjs-2` fed by the same selectors. **All rendered strings stay escaped (React
default), preserving the current XSS-safe posture.**

### Auth

- `register`: create `users` row + seeded `households` row in one transaction; set httpOnly JWT cookie.
- `login`: verify scrypt; set cookie. `logout`: clear cookie. `me`: verify cookie → user + plan.
- `middleware.ts`: protect `/app/*` and mutating `/api/*` (except `/api/auth/*`, `/api/stripe/webhook`);
  redirect unauthenticated browser navigations to `/login`.

### Stripe billing

- `lib/stripe.ts`: plan/entitlement config; price IDs from env.
- **Plans (tunable):**
  - **Free** — core hub: Dashboard, Schedule, Finance, Tasks, Family, Shopping.
  - **Pro** — everything in Free **plus** the Automations engine, CCTV (self-host), the Voice/assistant
    bridge, and LAN device discovery.
- `stripe/checkout`: create Checkout Session (create customer if missing) → `/app/billing` success/cancel.
- `stripe/portal`: Customer Portal session.
- `stripe/webhook`: verify signature on the **raw** body; handle `checkout.session.completed`,
  `customer.subscription.updated|deleted` → update `users.plan/subscription_status/current_period_end`.
- **Gating:** server-side entitlement checks in Pro-only API routes + UI upgrade prompts; pricing
  screen on-brand.

### CCTV + LAN discovery (cloud-aware)

`lib/cctv/isCloud()` returns true when `HOMEPAL_CLOUD=1` or ffmpeg is absent. In cloud mode the
`cctv/*` and `discover` routes return `{ ok:false, reason:"local-agent-required" }`; the React views
render a "requires self-hosting" banner. Self-host mode runs the ported ffmpeg engine unchanged.

### Deploy (Cantila)

- Provision Postgres add-on → `DATABASE_URL`.
- Env: `JWT_SECRET`, `HOMEPAL_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_PRO`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `HOMEPAL_CLOUD=1`.
- Build `next build`; run `next start` (Procfile `web: npm start`).
- **Migrations run at server boot** (`lib/migrate.ts` applies pending `db/migrations/*.sql` idempotently),
  so deploys are self-applying.

## Build order (each phase independently verifiable)

0. **Scaffold + design system** — Next/TS, compiled Tailwind replicating the theme + fonts + orbs,
   React shell (sidebar/header/modals/toasts). Verify shell is pixel-identical to current.
1. **Postgres + auth** — schema/migrations, `pg` layer, register/login/logout/me, cookie sessions,
   middleware, `state` GET/PUT, seed-on-register, read-only REST.
2. **UI port** — the seven views + actions + automations + voice in React, charts via react-chartjs-2.
3. **Local-only features** — CCTV + discovery views + cloud-aware API.
4. **Stripe billing** — plans, checkout, portal, webhook, gating, pricing + billing screens.
5. **Deploy to Cantila** — provision Postgres, set env, build, deploy, smoke-test.

## Testing

- Keep `node --test`. Port/keep unit tests for `lib/auth`, `lib/crypto`, `lib/state`, cctv engine.
- Add route-handler tests for auth, state, stripe webhook signature handling.
- Smoke test post-deploy: register → load state → save → upgrade (Stripe test mode) → gated feature.

## Non-goals

- No re-modeling of the seven features into relational tables (jsonb blob is intentional).
- No new product features beyond billing; the visual design is preserved, not redesigned.
- CCTV/discovery are not made to work from the cloud (physically impossible across the user's LAN).
