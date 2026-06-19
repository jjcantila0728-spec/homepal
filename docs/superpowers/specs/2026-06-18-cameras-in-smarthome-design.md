# Cameras in Smart Home — Design

**Date:** 2026-06-18
**Status:** Proposed (awaiting review)
**Sub-project 2 of 2** (sub-project 1 is "Deako Lights Integration", specced/planned separately)

## 1. Goal

Remove the standalone **CCTV** top-level view and re-present cameras as a
**Cameras section inside Smart Home**, with a brand-aware "Add camera" flow that
supports **Tapo** (local RTSP/ONVIF) cleanly and **ADT / generic ONVIF** cameras
on a best-effort basis. The real recording engine (`lib/cctv/*`) is reused
unchanged — this is a restructure + an input-adapter, not a rewrite.

## 2. Constraints & decisions (from brainstorming)

- **Self-hosted on the home LAN** — the existing engine already targets this
  (`isCloud()` gates recording when ffmpeg/LAN are absent). Cloud stays config-only.
- **Tapo first, ADT best-effort** — Tapo exposes local RTSP
  (`rtsp://user:pass@ip:554/stream1|stream2`, port 554) and ONVIF Profile S
  (port 2020). ADT has no official API and is largely cloud-locked, so it is
  handled through a **generic ONVIF/RTSP** adapter labelled experimental.
- **Reuse the engine.** `lib/cctv/*` consumes an encrypted `rtspUrl`. We add an
  adapter that *produces* that URL from friendly per-brand fields; the engine,
  retention, clip browser, and crypto-at-rest are untouched.

## 3. What changes vs. what stays

**Stays (no change):** `lib/cctv/index.ts` (engine, controller, ffmpeg adapters,
retention, `sanitizeCamerasForClient`), `lib/cctv/{detect,paths,storage,cloud}.ts`,
`lib/crypto.ts`, all `app/api/cctv/*` routes' transport/security behavior, the
`cctv` entitlement *key* (kept so Stripe/`PLAN_FEATURES` don't break).

**Changes:**
1. **Brand adapter** (new, pure): build an `rtsp://` URL from brand + fields.
2. **Camera config** gains optional non-secret brand metadata; the `config` and
   `test` routes accept brand fields and derive the rtspUrl.
3. **UI restructure:** delete the standalone view/route, remove the nav item,
   render a `CamerasPanel` inside Smart Home, and replace the `window.prompt`
   add-flow (audit finding) with a brand-aware modal.
4. **Relabel** "CCTV" → "Cameras" in user-facing strings (`FEATURE_LABELS.cctv`,
   page-title map, banners).

## 4. Brand adapter

New pure module `lib/cameras/brands.ts` (no I/O, fully unit-testable):

```ts
export type CameraBrand = 'tapo' | 'onvif' | 'generic';

export interface BrandFields {
  brand: CameraBrand;
  host?: string;        // LAN IP / hostname
  username?: string;    // Tapo "camera account" user (not the Tapo app login)
  password?: string;
  streamQuality?: 'hd' | 'sd';  // tapo: stream1 | stream2
  rtspUrl?: string;     // generic/onvif: full URL pass-through
  rtspPath?: string;    // optional path for generic when only host is known
}

export interface BuiltStream {
  rtspUrl: string;            // plaintext rtsp:// — caller encrypts at rest
  warnings: string[];         // e.g. ADT/experimental note
}

export function buildRtspUrl(f: BrandFields): BuiltStream;
```

Rules:
- **tapo:** require `host`, `username`, `password`; `rtsp://user:pass@host:554/` +
  (`streamQuality==='sd' ? 'stream2' : 'stream1'`). Credentials are the Tapo
  *camera account* (documented requirement), surfaced as helptext in the UI.
- **generic / onvif (incl. ADT):** if `rtspUrl` given, validate `rtsp://` and pass
  through; else build `rtsp://[user:pass@]host[/rtspPath]`. Always append a
  warning: "ADT and other proprietary cameras may not expose RTSP/ONVIF; this is
  best-effort."
- Throws a typed error with a clear message on missing required fields (host etc.).

The route encrypts `BuiltStream.rtspUrl` via the existing `encryptSecret` exactly
as `app/api/cctv/config/route.ts` does today, so secrets-at-rest behavior is
unchanged. Brand + host + streamQuality (non-secret) persist on the camera for
display/edit; **username/password never persist outside the encrypted URL**.

## 5. Data model

Extend the engine's `Camera` (in `lib/cctv/index.ts`) and `SanitizedCamera` with
optional non-secret brand metadata:

```ts
// added to Camera and persisted config
brand?: 'tapo' | 'onvif' | 'generic';
host?: string;
streamQuality?: 'hd' | 'sd';
```

`sanitizeCamerasForClient` additionally returns `brand`, `host`, `streamQuality`
(all non-secret) so the UI can pre-fill the edit form. The masked URL
(`rtspMasked`) continues to be the only stream string sent to the client.

## 6. API changes

- **`POST /api/cctv/config`** (`app/api/cctv/config/route.ts`): when a raw camera
  carries `brand`/`host`/`username`/`password`/`streamQuality` and **no** literal
  `rtspUrl`, call `buildRtspUrl(...)` to derive the plaintext URL, then encrypt as
  today. Persist `brand/host/streamQuality`. Existing literal-`rtspUrl` path stays
  for backward compatibility. Keep the `isPrivateHost` discipline for `host`.
- **`POST /api/cctv/test`** (`app/api/cctv/test/route.ts`): accept brand fields,
  build the URL the same way, then run the existing `validateRtspUrl` probe.
- No route renames (avoids churn / broken bookmarks); these are internal paths.

## 7. UI restructure

1. **Remove the standalone view:** delete `app/app/cctv/page.tsx`; remove the
   `{ id:'cctv', … href:'/app/cctv' }` entry from `VIEWS` (`lib/constants.ts:84`)
   and the `'/app/cctv': 'Cameras & Storage'` line in `AppShell.tsx:17`. Add a
   redirect from `/app/cctv` → `/app/home` so old links/bookmarks still resolve.
2. **Refactor the view into a panel:** move the body of `components/views/Cctv.tsx`
   into `components/views/cameras/CamerasPanel.tsx` (same logic), and render
   `<CamerasPanel />` as a **"Cameras" section within the Smart Home view**
   (`components/views/Home.tsx`), consistent with how Home already groups lights /
   devices / scenes. Keep the Pro gate (`UpgradePrompt feature="cctv"`) scoped to
   the panel, not the whole Smart Home page.
3. **Brand-aware Add flow:** replace `cctvAddCamera`'s two `window.prompt` calls
   with an in-app modal (use the app's existing modal + `.toggle`/`input`
   components) offering **Brand: Tapo / ADT (experimental) / Generic ONVIF** and
   the matching fields (Tapo → host + camera-account user/pass + HD/SD; Generic →
   full RTSP URL or host+path). Submit runs `/test` then `/config` as today.
4. **Relabel** banner/title copy from "CCTV" to "Cameras"; replace the raw
   `<input type="checkbox">` enable control with the app `.toggle` (audit nit).

## 8. Security & entitlements

- `cctv` entitlement key unchanged (Stripe-safe); only `FEATURE_LABELS.cctv`
  relabels to "Cameras". Recording remains Pro-gated; config is saveable on any
  plan (matches current behavior).
- `host` validated with `isPrivateHost` (no SSRF). Credentials only ever leave the
  client to be encrypted server-side and embedded in the ciphertext URL — never
  persisted or returned in plaintext (existing `sanitizeCamerasForClient`
  allowlist already guarantees this; we keep it).
- `rtspMasked` remains the only stream string returned to clients.

## 9. Testing

- **`brands.ts` unit tests** (`test/camera-brands.test.js`, `node --test`): Tapo HD
  vs SD URL building; missing-field errors; generic pass-through + `rtsp://`
  validation; ADT/generic warning present; credentials URL-encoded safely.
- **Config-route behavior:** a test (or manual) confirming brand fields produce an
  encrypted URL and that `sanitizeCamerasForClient` echoes `brand/host` but never
  plaintext creds.
- **Manual:** standalone `/app/cctv` redirects to Smart Home; Cameras section
  renders inside Smart Home; cloud shows the self-host banner; Tapo add flow on the
  self-hosted box records from a real camera (user validation).

## 10. Out of scope (v1)

- ONVIF auto-discovery of cameras (the existing SSDP discovery already tags ONVIF
  devices as `camera`; wiring discovery → add-form is a follow-up), PTZ control,
  two-way audio, merging the engine `Camera` config with the smart-home `Device`
  (type:'camera') model, ADT cloud/Nest integration, live (non-recorded) RTSP
  preview in the browser.

## 11. Risks & open questions

- **ADT viability is genuinely uncertain** — many ADT cameras expose no RTSP/ONVIF.
  The generic adapter + experimental labelling sets honest expectations; if the
  user's specific ADT model is cloud-only, no local integration is possible and the
  UI says so rather than failing silently.
- **Tapo camera-account confusion** — users frequently use their Tapo *app* login
  instead of the required *camera account*. Mitigation: explicit helptext + the
  `/test` probe surfacing auth failures before save.
- **Open question:** should `/app/cctv` redirect (chosen) or 404 after removal?
  Plan assumes a redirect to `/app/home` for link safety.
