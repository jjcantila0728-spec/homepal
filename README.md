# HomePal — Family Hub

A full-stack family hub web app: shared **calendar**, **finances** (budgets, savings, transactions),
**smart-home** control (lights, locks, cameras, climate, scenes, energy), **chores & shopping**, and
**family management** — behind real accounts, a REST API, and a SQLite database. Installable as an
offline-capable PWA.

## Features

- **Accounts** — register/sign-in (scrypt-hashed passwords, JWT sessions). Each account is its own
  household with isolated data, seeded with a sample family to explore.
- **Dashboard** — greeting, weather, quick scenes, balance & chore-point snapshots, upcoming events.
- **Schedule** — month calendar with per-member, color-coded events.
- **Finance** — income/expense tracking, live monthly budgets, savings goals, **recurring bills & income**, **debts & credit cards** (utilization, payoff, per-account payments), Chart.js visualizations driven by real transactions.
- **Home** — room-by-room light/device control, locks, cameras, thermostat, energy charts, scenes. **Add any device type** (light, lock, camera, sensor, media, appliance, climate) and create rooms on the fly.
- **Connect Devices** — **real local-network discovery**: a zero-dependency SSDP/UPnP scan (`/api/discover`) finds WiFi/UPnP devices on your LAN, detects each one's type, and adds it with one tap; plus manual add-by-IP with a live reachability check. Works when HomePal runs on the same network as your devices (a cloud host can't reach gear behind your router — that's networking, not a limitation we can code around).
- **Automations** — a real rules engine (**triggers → actions**): run at a set time, when security is armed/disarmed, or when the family leaves/returns. Families build their own rules, and every household ships with sensible **defaults** (Good Night, Wake Up, Secure-when-everyone-leaves, Welcome Home). Runs in-app and stays in sync for everyone.
- **CCTV recording → UGREEN NAS** — real **motion-triggered** recording: HomePal pulls each camera's RTSP stream with `ffmpeg`, detects motion via scene-change analysis, and writes clips (with pre/post-roll) to a mounted **UGREEN NAS** path. Free-space-based retention prunes the oldest clips automatically, and a built-in clip browser plays recordings back. Camera credentials are **encrypted at rest**. See [CCTV setup](#cctv--ugreen-nas-recording).
- **Voice** — hands-free control via the Web Speech API in-app, plus a secure `/api/voice` command endpoint so **Alexa, Google Assistant, and Siri Shortcuts** can drive the home.
- **Tasks** — weekly chores with a points leaderboard, and a shared shopping list.
- **Family** — member profiles, roles (admin/member), status, and an activity log.
- Global search (`Ctrl/⌘ + K`), notifications, member switching, and toast feedback.

## Architecture

**Zero npm dependencies** — built entirely on the Node.js standard library (Node ≥ 24). The optional
CCTV recording feature additionally shells out to the external **`ffmpeg`/`ffprobe`** binaries.

| Layer | Tech |
|-------|------|
| Server | `node:http` — REST API + static host ([server/index.js](server/index.js)) |
| Database | `node:sqlite` — file-backed SQLite at `data/homepal.db` ([server/db.js](server/db.js)) |
| Auth | `node:crypto` — scrypt password hashing + HS256 JWT ([server/auth.js](server/auth.js)) |
| Discovery | `node:dgram` — real SSDP/UPnP LAN scan + type inference ([server/discovery.js](server/discovery.js)) |
| Frontend | Native **ES modules** under [src/](src/) (no build step) + `app.css`; Tailwind/Chart.js/Font Awesome via CDN |

Data flow: the browser hydrates from `GET /api/state` on load, then persists the full household
state with a debounced `PUT /api/state` (and a `sendBeacon` on unload). All writes are transactional
and scoped to the authenticated household.

### API

| Method & path | Purpose |
|---------------|---------|
| `POST /api/auth/register` | Create a household + admin account → `{ token }` |
| `POST /api/auth/login` | Authenticate → `{ token }` |
| `GET /api/auth/me` | Current user (auth required) |
| `GET /api/state` | Full household state (auth required) |
| `PUT /api/state` | Replace household state, transactional (auth required) |
| `POST /api/voice` | Run a natural-language command (`{ command }`) → applies it & returns `{ speech }` — the Alexa/Google/Siri bridge (auth required) |
| `GET /api/discover` | Scan the local network for smart devices (SSDP/UPnP) → `{ ok, devices[], reason? }` (auth required) |
| `POST /api/discover` | `{ check: "host[:port]" }` → `{ reachable }` — probe a single **private/LAN** device (public/link-local hosts refused to prevent SSRF) |
| `GET /api/cctv/status` | ffmpeg availability, NAS storage writability + free space, cameras (RTSP URLs masked) |
| `POST /api/cctv/test` | `{ rtspUrl }` → `{ ok, reason? }` — probe a camera stream before enabling |
| `POST /api/cctv/config` | Save storage path, free-space floor, and cameras (new RTSP URLs encrypted at rest) |
| `GET /api/cctv/clips` | List recorded clips (`?camera=&date=` filters) |
| `GET /api/cctv/clip?path=` | Stream a clip (HTTP Range), path-guarded to the storage root |
| `GET /api/{members,events,transactions,chores,shopping}` | Read-only REST over the tables |
| `GET /api/health` | Liveness check |

All non-auth routes require `Authorization: Bearer <token>`.

## Run locally

```sh
npm start        # → http://localhost:3000
# or: npm run dev   (auto-restart on change)
```

Open <http://localhost:3000>, create an account, and explore. The database and signing secret are
created automatically under `data/` (gitignored). Override the port with `PORT`, and the JWT secret
with `JWT_SECRET`.

## CCTV → UGREEN NAS recording

HomePal can record your IP cameras to a UGREEN NAS (or any mounted share). It captures
motion-triggered clips with `ffmpeg` and prunes them by free-space so the NAS never fills.

**One-time setup**

1. **Install `ffmpeg`** on the machine running HomePal (it must be on `PATH`, or set `FFMPEG_PATH`).
   HomePal detects it and shows a warning banner until it's present.
2. **Mount the UGREEN share** (SMB or NFS) as a folder/drive on that machine — e.g. `Z:\cctv` on
   Windows or `/mnt/ugreen/cctv` on Linux. HomePal writes clips to that path; the OS handles auth.
3. In the app, open **CCTV → Cameras & Storage**, enter the mount path and a **Keep free (GB)** floor,
   and **Save storage**.
4. **Add camera** with its full RTSP URL (e.g. `rtsp://user:pass@192.168.1.50:554/stream1`). HomePal
   tests the stream, then records on motion. Tune **sensitivity** per camera.

**How it works** — per enabled camera, a cheap `-c copy` segmenter keeps a short rolling buffer while a
downscaled detector watches for scene changes; when motion fires, the overlapping segments (plus
pre/post-roll) are stitched into one MP4 under `<storagePath>/<camera>/<date>/clip_<time>.mp4`. A
periodic sweep deletes the oldest clips whenever free space drops below the floor.

**Security** — RTSP URLs carry credentials, so they're encrypted at rest (AES-256-GCM) and only ever
returned to the UI **masked**. For production, set `HOMEPAL_SECRET` to pin the encryption key (otherwise
a key is generated once and stored at `data/.cctv-key`). ffmpeg is invoked without a shell, and clip
serving + retention are confined to the configured storage root.

## Progressive Web App

- Installable on desktop & mobile (`manifest.webmanifest` + `icon.svg`).
- Offline-capable via `sw.js` — the app shell and CDN assets are cached; `/api/*` always hits the network.

## Files

| Path | Purpose |
|------|---------|
| `index.html` | App shell (markup only) — loads `src/app.css` + `src/main.js`. |
| `src/main.js` | Entry: wires the handler surface, keyboard/a11y, boot. |
| `src/{constants,core}.js` | Static data/art; state, formatters, selectors, toasts/modals, a11y. |
| `src/components.js` | Pure card/row render helpers (all output escaped). |
| `src/views.js` | The seven screens + `render()` + charts. |
| `src/actions.js` | Every user action (toggles, add/edit/delete, search, notifications). |
| `src/automations.js` | Automation engine + rule builder + Connect-Devices UI. |
| `src/{voice,api}.js` | Voice/assistants; API client, auth, persistence, discovery client. |
| `src/cctv.js` | Cameras & Storage view — NAS config, camera cards, clip browser. |
| `src/app.css` | All styles (incl. reduced-motion + focus-visible). |
| `server/index.js` | HTTP server, routing, REST API, static host. |
| `server/db.js` | SQLite schema, queries, state read/write. |
| `server/auth.js` | Password hashing + JWT. |
| `server/discovery.js` | Zero-dep SSDP/UPnP LAN discovery + reachability. |
| `server/seed.js` | Default household data (rooms, scenes, automations) for new accounts. |
| `manifest.webmanifest`, `sw.js`, `icon.svg` | PWA shell. |

## Deploy

Needs a Node.js host (the app runs a server and writes a SQLite file). Set `JWT_SECRET` and a
persistent volume for `data/`. For [Cantila](https://cantila.app), `npm start` is the entry point.
