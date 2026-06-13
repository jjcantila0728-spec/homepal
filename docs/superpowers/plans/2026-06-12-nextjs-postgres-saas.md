# HomePal Next.js + Postgres SaaS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate HomePal to a multi-tenant Next.js + Postgres SaaS with Stripe billing, deployed to Cantila, keeping the current design pixel-identical.

**Architecture:** Next.js App Router + React + TypeScript front-to-back. Existing whole-state `jsonb` persistence in Postgres (`pg`). scrypt+JWT auth in httpOnly cookies + middleware. Stripe subscriptions. CCTV/discovery ported but cloud-gated. Migrations applied at boot.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind (compiled), `pg`, `stripe`, `react-chartjs-2`, `@fortawesome`, `node --test`.

Reference design: `docs/superpowers/specs/2026-06-12-nextjs-postgres-saas-design.md`.

---

## Phase 0 — Scaffold + design system

**Files:** `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/globals.css`, `app/app/layout.tsx`, `components/shell/*`, `lib/cn.ts`.

- [ ] Init Next app deps (`next react react-dom`, dev: `typescript @types/* tailwindcss postcss autoprefixer`), keep `"type":"module"`, Node 24.
- [ ] `tailwind.config.ts`: port the CSS-variable theme (accent/amber/pink/bg/bg2/surface/border/muted/red), fonts `Space Grotesk` + `Plus Jakarta Sans` via `next/font`, dark colorScheme. `content` globs over `app/**` + `components/**`.
- [ ] `app/globals.css`: `@tailwind base/components/utilities` + the entire ported `src/app.css` (ambient orbs, boot, scene splash, navsearch, reduced-motion, focus-visible) verbatim.
- [ ] `app/layout.tsx`: html/head meta (theme-color, manifest, PWA tags from current `index.html`), fonts, `globals.css`, ambient orbs markup.
- [ ] `components/shell/`: `Sidebar`, `Header`, `AmbientOrbs`, `MobileBar`, `Modal`, `Toast`, `Search` — port markup 1:1 from `index.html`, swap inline `onclick` for React handlers.
- [ ] `app/app/layout.tsx`: assembles the shell around `{children}` (the authenticated hub).
- [ ] **Verify:** `npm run dev`, shell renders pixel-identical to current (sidebar, header, orbs). Commit.

## Phase 1 — Postgres + auth + state

**Files:** `lib/db.ts`, `lib/migrate.ts`, `db/migrations/0001_init.sql`, `lib/crypto.ts`, `lib/auth.ts`, `lib/session.ts`, `lib/state.ts`, `lib/seed.ts`, `middleware.ts`, `app/api/auth/{register,login,logout,me}/route.ts`, `app/api/state/route.ts`, `app/api/{members,events,transactions,chores,shopping}/route.ts`, tests under `test/`.

- [ ] `db/migrations/0001_init.sql`: `users` + `households` tables per spec (uuid, pgcrypto `gen_random_uuid`).
- [ ] `lib/db.ts`: `pg.Pool` from `DATABASE_URL`; `query()`, `tx()` helpers.
- [ ] `lib/migrate.ts`: create `_migrations` table, apply unran `db/migrations/*.sql` in order; call once at boot (instrumentation hook / first-request guard).
- [ ] TDD `lib/crypto.ts`: port `server/crypto.js` (AES-256-GCM for RTSP secrets) — reuse existing `test/crypto.test.js`.
- [ ] TDD `lib/auth.ts`: port `server/auth.js` scrypt hash/verify + HS256 JWT sign/verify. Test: hash≠password, verify round-trips, tampered JWT rejected.
- [ ] `lib/session.ts`: `setSessionCookie(res,token)`, `getSessionUser()` (read cookie → verify → load user row). httpOnly, Secure, SameSite=Lax.
- [ ] TDD `lib/seed.ts` + `lib/state.ts`: port `server/seed.js` default household; `loadState(userId)`, `saveState(userId, state)`. Test seed shape + round-trip.
- [ ] Auth routes: `register` (tx: insert user + seeded household, set cookie), `login`, `logout`, `me`.
- [ ] `app/api/state/route.ts`: `GET` returns household state; `PUT` replaces it (auth required, owner-scoped).
- [ ] Read-only REST routes: select into `households.state` jsonb for the session user.
- [ ] `middleware.ts`: guard `/app/*` (redirect→`/login`) and mutating `/api/*` (401) except `/api/auth/*`, `/api/stripe/webhook`.
- [ ] **Verify:** register→cookie set→`/api/state` returns seed→PUT persists→relogin restores. Tests green. Commit.

## Phase 2 — UI port (the seven views)

**Files:** `lib/types.ts`, `lib/format.ts`, `lib/selectors.ts`, `store/household.tsx`, `app/api`-client `lib/client.ts`, `components/ui/*`, `components/views/{Dashboard,Schedule,Finance,Home,Tasks,Family,Automations}.tsx`, `app/(auth)/{login,register}/page.tsx`, `app/app/**/page.tsx`, `lib/voice.ts`.

- [ ] `lib/types.ts`: TS interfaces for the household state (members, events, transactions, budgets, savings, bills, debts, rooms, devices, scenes, automations, chores, shopping, activity).
- [ ] `lib/format.ts` + `lib/selectors.ts`: port formatters + selectors from `src/core.js` (currency, dates, balance, budget rollups, chore points, upcoming events).
- [ ] `store/household.tsx`: `HouseholdProvider` — hydrate from `GET /api/state`, expose `state` + typed actions (port `src/actions.js`/`automations.js`), debounced `PUT /api/state`, `sendBeacon` on unload, toasts/modals context.
- [ ] `components/ui/*`: port pure render helpers from `src/components.js` (Card, Row, Stat) to components (escaping is automatic in JSX).
- [ ] Port views from `src/views.js` 1:1 to components, charts via `react-chartjs-2` fed by selectors. Same Tailwind classes.
- [ ] Auth pages: login/register forms styled on-brand, call auth routes, redirect to `/app`.
- [ ] App route pages mount each view; sidebar nav drives Next routing (replaces in-app router).
- [ ] `lib/voice.ts`: Web Speech hook + `/api/voice` call.
- [ ] **Verify:** click through all seven screens; add/edit/delete persists; charts render; search/notifications work. Commit per view.

## Phase 3 — CCTV + discovery (cloud-aware)

**Files:** `lib/cctv/*` (ported `server/cctv*.js`), `lib/cctv/cloud.ts`, `lib/discovery.ts`, `app/api/cctv/{status,test,config,clips,clip}/route.ts`, `app/api/discover/route.ts`, `components/views/Cctv.tsx`, `components/views/ConnectDevices` (in Automations), tests.

- [ ] TDD `lib/cctv/cloud.ts`: `isCloud()` → true if `HOMEPAL_CLOUD=1` or ffmpeg absent. Test both branches.
- [ ] Port cctv engine modules (`cctv-detect/paths/storage/crypto/controller`) + `discovery.ts` (SSDP/UPnP, SSRF guard) from `server/`.
- [ ] cctv + discover routes: in cloud mode return `{ok:false, reason:"local-agent-required"}`; else run engine. Keep RTSP masking + path guards.
- [ ] `components/views/Cctv.tsx` + Connect-Devices: port UI; render "requires self-hosting" banner on `local-agent-required`.
- [ ] **Verify:** cloud mode shows banner, no crash; tests green. Commit.

## Phase 4 — Stripe billing

**Files:** `lib/stripe.ts`, `lib/entitlements.ts`, `app/api/stripe/{checkout,portal,webhook}/route.ts`, `app/pricing/page.tsx`, `app/app/billing/page.tsx`, `app/page.tsx` (landing), `db/migrations/0002_*.sql` (if needed), middleware gating, tests.

- [ ] `lib/stripe.ts`: stripe client; plan config (`free`, `pro` with `STRIPE_PRICE_PRO`); `getOrCreateCustomer(user)`.
- [ ] `lib/entitlements.ts`: `can(plan, feature)` — Pro gates automations, cctv, voice, discovery. Unit test the matrix.
- [ ] `stripe/checkout`: create Checkout Session → billing success/cancel URLs.
- [ ] `stripe/portal`: Customer Portal session.
- [ ] TDD `stripe/webhook`: verify signature on raw body (`await req.text()`); handle `checkout.session.completed`, `customer.subscription.updated|deleted` → update user plan/status. Test signature rejection + a sample event updates the row.
- [ ] Server-side `can()` checks in Pro-only API routes; UI upgrade prompts on gated views.
- [ ] `app/page.tsx` landing (on-brand hero + fonts/orbs) + `app/pricing` + `app/app/billing` (manage/upgrade).
- [ ] **Verify:** Stripe test-mode checkout upgrades plan via webhook; gated feature unlocks; portal opens. Commit.

## Phase 5 — Deploy to Cantila

- [ ] `Procfile` `web: npm start` (start = `next start`); `build` = `next build`. Confirm migrations run at boot.
- [ ] Provision Postgres (Cantila) → set `DATABASE_URL` + all secrets (`JWT_SECRET`, `HOMEPAL_SECRET`, Stripe keys, `HOMEPAL_CLOUD=1`).
- [ ] `cantila_bootstrap_repo` / `cantila_deploy`; configure Stripe webhook endpoint → deployed URL.
- [ ] **Smoke test:** register → state load/save → checkout (test) → gated feature → CCTV banner. Update README. Commit + tag.

---

## Self-review notes
- Spec coverage: every spec section maps to a phase (stack→P0, db/auth→P1, UI→P2, cctv→P3, stripe→P4, deploy→P5). ✓
- The old `server/` and `src/` trees are replaced by `app/`+`lib/`+`components/`; remove them in P2 once parity is reached (keep `server/cctv*` logic ported into `lib/cctv`).
- `data/` SQLite + `Procfile`/`sw.js`/`manifest` reused or adapted for Next `public/`.
