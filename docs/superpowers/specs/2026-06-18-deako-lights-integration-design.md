# Deako Lights Integration — Design

**Date:** 2026-06-18
**Status:** Proposed (awaiting review)
**Sub-project 1 of 2** (the second is "Cameras in Smart Home", specced separately)

## 1. Goal

Make HomePal's Smart Home lights drive **real Deako switches/dimmers** over the
local network. Today, toggling a light only flips a boolean in household state
and never reaches hardware (`hooks/useActions.tsx` `toggleLight`/`setBrightness`/
`allLights`). After this work, a light that is *linked* to a Deako device sends a
real power/dim command to that device on the LAN, and reflects state changes
made physically at the switch.

## 2. Constraints & decisions (from brainstorming)

- **Self-hosted on the home LAN.** HomePal runs on a box that shares the network
  with the Deako switches, so it can talk to them directly. The cloud (Cantila)
  deploy cannot reach LAN devices and will degrade gracefully (see §9).
- **Deako Smart hardware (no Pro line).** Contrary to the initial assumption,
  Deako's *local* API works with all smart Deako devices — it's the same
  Local-Polling API that Home Assistant's built-in `deako` integration uses via
  the open-source `pydeako` library. No cloud account or Pro model required.
- **Native TypeScript port**, not a Home-Assistant bridge. We implement the Deako
  local socket protocol directly so HomePal needs no second runtime. `pydeako`
  is the reference implementation for message formats.

## 3. Deako local protocol (what we port)

Verified from `pydeako` / the HA `deako` integration:

- **Transport:** raw TCP socket, **port 23**, newline-framed JSON messages.
- **Gateway model:** Deako switches form a mesh; connecting to *any one* device's
  IP exposes the whole household's device list. So a single gateway IP is enough.
- **Messages** (envelope: `{transactionId, dst:"deako", src:"homepal", type, ...}`):
  - `DEVICE_LIST` request → response enumerates devices (uuid, name, and current
    `state: { power: bool, dim: 0–100 }`).
  - `DEVICE_PING` / `PING` keepalive.
  - Control message sets a device's `state` (power on/off, dim level).
  - Unsolicited state-change events arrive on the same socket when a switch is
    operated physically or by another controller.
- **Exact field names/shapes are taken from `pydeako`'s message constructors at
  implementation time** — this spec does not freeze them. The TS client mirrors
  `pydeako`'s `_request`/`_response` modules.

## 4. Architecture

New self-contained module `lib/integrations/deako/`, mirroring the style of the
existing zero-/low-dependency `lib/discovery.ts` and `lib/cctv/*`:

```
lib/integrations/deako/
  protocol.ts   # pure: build/parse JSON messages (no I/O) — fully unit-testable
  client.ts     # DeakoClient: one TCP socket to a gateway IP; connect, list,
                #   control, keepalive, reconnect; emits device-state events
  manager.ts    # process-singleton (like getPool() in lib/db.ts): owns the
                #   active DeakoClient per gateway, lazy-connect, exposes
                #   listDevices() / setDevice(uuid, {power,dim}) / status()
  types.ts      # DeakoDevice, DeakoState, connection status enums
  index.ts      # public surface re-export
```

**Why a server-side singleton:** the socket is long-lived and stateful; it must
live in the Node process, not per-request. `manager.ts` follows the exact pattern
already used for the pg pool (`globalForDb._hpPool` in `lib/db.ts`) so it survives
dev hot-reloads and is created lazily on first use.

## 5. Data model changes

`lib/types.ts`:

- Extend `Light` with an optional link to a Deako device:
  ```ts
  export interface Light {
    id: number; name: string; room: string; on: boolean; brightness: number;
    deakoUuid?: string;   // when set, this light controls a real Deako device
    source?: 'manual' | 'deako';
  }
  ```
- Add an integrations config block to `HouseholdState`:
  ```ts
  export interface DeakoConfig {
    enabled?: boolean;
    gatewayIp?: string;        // LAN IP of any Deako device (the mesh entry point)
    lastConnectedAt?: string;
    devices?: { uuid: string; name: string; room?: string }[]; // last seen roster
  }
  export interface HouseholdState { /* … */ integrations?: { deako?: DeakoConfig }; }
  ```
  Stored in the same `households.state` jsonb blob via `loadState`/`saveState`,
  matching how `cctv` config is persisted. **No secrets** are involved (local
  network, no credentials), so unlike CCTV we do **not** need `lib/crypto`.

## 6. API routes

All under `app/api/integrations/deako/`, `runtime = 'nodejs'`, auth via
`getSessionUser()` (401 if absent), and wrapped so `isDbConnectivityError` → 503
and any LAN/socket failure → a clean JSON error (never a raw 500/stack):

| Route | Method | Purpose |
|-------|--------|---------|
| `/connect` | POST | Body `{ gatewayIp }`. Reachability-check port 23 (reuse `checkReachable(host,23)`), open the socket, pull `DEVICE_LIST`, persist `integrations.deako` (enabled, ip, device roster). Returns the device roster. |
| `/devices` | GET | Current Deako device list + live state from the connected client; `{ connected:false }` if not connected (e.g. cloud). |
| `/control` | POST | Body `{ uuid, power?, dim? }`. Sends the control message; returns the resulting state. 409 if not connected. |
| `/status` | GET | Connection status (connected / connecting / error + last error message). |

Server-side gateway IP is validated with `isPrivateHost()` (already in
`lib/discovery.ts`) to keep this from becoming an SSRF lever.

## 7. Client wiring (Smart Home UI)

- **Linking:** in the existing "Manage device" / light modal flow
  (`useActions.tsx` `openManageDevice`/`saveManage`), add a "Link to Deako device"
  picker populated from `GET /api/integrations/deako/devices`. Selecting one sets
  `light.deakoUuid` + `source:'deako'`.
- **Control:** `toggleLight`, `setBrightness`, and `allLights` keep their
  optimistic local `update(...)` (instant UI), then — for any affected light with
  a `deakoUuid` — fire `POST /api/integrations/deako/control`. On failure, toast
  an error and revert that light's optimistic change.
- **Settings:** a small "Deako" panel in Smart Home settings to enter/auto-detect
  the gateway IP (calls `/connect`) and show connection status.
- **Inbound sync (optional, phase 2):** poll `GET /api/integrations/deako/devices`
  while the Smart Home view is open to reflect physical switch changes. Real-time
  push (SSE) is out of scope for v1.

## 8. Discovery

- **Primary: manual gateway IP entry.** Because connecting to any one device
  returns the whole roster, a single IP is sufficient and avoids an mDNS
  dependency. This is the reliable v1 path.
- **Optional: mDNS auto-detect** of `_deako._tcp` over UDP 5353. Deferred unless
  cheap — the existing SSDP discovery is UDP/zero-dep precedent, but Deako uses
  mDNS specifically, which is more code. Manual IP ships first; auto-detect is a
  follow-up.

## 9. Connection lifecycle & error handling

- **Lazy connect** on first `/connect` or first control after boot; reconnect with
  capped backoff on socket drop; periodic keepalive ping. A wedged/half-open
  socket fails fast and surfaces via `/status`.
- **Cloud / no-LAN:** on Cantila there is no route to the gateway. `manager.ts`
  detects connect failure and the routes return `{ connected:false }` /
  actionable errors; the UI shows "Deako control requires HomePal running on your
  home network" (same self-host framing the camera engine already uses). Lights
  still toggle locally (state-only) so the app never breaks.
- **No stack/internal leakage** to clients (addresses reliability-audit finding
  on error leakage); detailed errors are logged server-side only.

## 10. Security & entitlements

- Gateway IP restricted to private IPv4 (`isPrivateHost`) — no SSRF.
- Routes require an authenticated session and operate only on the caller's own
  household state (tenant isolation as elsewhere).
- **Entitlement:** lights are not Pro-gated today; v1 keeps Deako control
  available on all plans to match current behavior. (If Smart Home later becomes a
  Pro feature — a separate audit finding — gating is a one-line `can()` add.)

## 11. Testing strategy

- **`protocol.ts` unit tests** (`node --test`, matching existing `test/`): build a
  `DEVICE_LIST` request, parse a captured `DEVICE_LIST` response, build a control
  message, parse a state-change event. Pure functions, no I/O — high value, zero
  flake.
- **`client.ts` integration tests against a local fake Deako server**: a tiny TCP
  server in the test that speaks the recorded protocol, so connect → list →
  control → reconnect are tested without hardware.
- **Manual hardware validation** by the user on their self-hosted box with the
  real switches — the one step that genuinely needs the devices.

## 12. Out of scope (v1)

- mDNS auto-discovery (follow-up), real-time SSE push, scene/automation
  integration with Deako groups, Deako motion sensors, multi-gateway redundancy,
  any Deako *cloud* path.

## 13. Risks & open questions

- **Protocol drift:** `pydeako` message shapes can change across Deako firmware.
  Mitigation: isolate all wire formats in `protocol.ts`, pin behavior with tests
  against captured fixtures.
- **No hardware in the dev loop:** final correctness depends on the user's
  switches; the fake-server tests reduce but don't eliminate this risk.
- **Open question:** should a light's *physical* state changes (someone flips the
  switch) update HomePal in v1 via polling, or is that strictly phase 2? Current
  plan: phase 2 (poll-on-view), to keep v1 focused on outbound control.
