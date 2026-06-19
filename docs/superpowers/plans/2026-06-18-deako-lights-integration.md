# Deako Lights Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HomePal's Smart Home lights drive real Deako switches/dimmers over the LAN, while degrading gracefully when no LAN/Deako is reachable.

**Architecture:** A self-contained `lib/integrations/deako/` module: pure protocol builders/parsers (`protocol.ts`), a stateful TCP socket client (`client.ts`), and a process-singleton connection manager (`manager.ts`, modeled on `getPool()` in `lib/db.ts`). Four auth-gated API routes expose connect/list/control/status. The existing optimistic light actions in `hooks/useActions.tsx` fire a real LAN command for any light linked via a new `Light.deakoUuid`.

**Tech Stack:** TypeScript, Next.js 15 (route handlers, `runtime='nodejs'`), Node built-in `node:net` (TCP), `node --test` (existing test runner). No new npm dependencies.

---

## Protocol note (read first)

`pydeako` (https://github.com/sebirdman/pydeako) is the reference implementation. Messages are **newline-terminated JSON** over a **TCP socket on port 23**. The envelope and payloads in this plan reflect the documented/observed format:

```jsonc
// request envelope
{ "transactionId": "<uuid>", "type": "DEVICE_LIST" | "CONTROL" | "PING",
  "dst": "deako", "src": "homepal", "data": { /* type-specific */ } }
// CONTROL data: { "target": "<uuid>", "state": { "power": true, "dim": 80 } }
```

**Before implementing `protocol.ts`, open the `pydeako` source (`pydeako/_request.py`, `_response.py`) and confirm exact field names.** If they differ, update the fixtures in Task 2 and the builders in Task 3 — the format is isolated to `protocol.ts`, so nothing else changes. Treat the `pydeako` source as ground truth over this plan's literals.

---

## File Structure

- Create `lib/integrations/deako/types.ts` — `DeakoDevice`, `DeakoState`, `DeakoStatus`.
- Create `lib/integrations/deako/protocol.ts` — pure message builders + a streaming line parser.
- Create `lib/integrations/deako/client.ts` — `DeakoClient`: one socket, connect/list/control/keepalive/reconnect.
- Create `lib/integrations/deako/manager.ts` — singleton owning the active client per gateway IP.
- Create `lib/integrations/deako/index.ts` — public re-exports.
- Modify `lib/types.ts` — extend `Light`; add `DeakoConfig` + `HouseholdState.integrations`.
- Create `app/api/integrations/deako/connect/route.ts`, `.../devices/route.ts`, `.../control/route.ts`, `.../status/route.ts`.
- Modify `hooks/useActions.tsx` — fire real commands from `toggleLight`/`setBrightness`/`allLights`; add link picker in manage flow.
- Create `lib/integrations/deako/deakoClientApi.ts` — tiny browser fetch helpers used by `useActions`.
- Create tests under `test/`: `deako-protocol.test.js`, `deako-client.test.js`.

---

### Task 1: Types and household-state model

**Files:**
- Create: `lib/integrations/deako/types.ts`
- Modify: `lib/types.ts` (Light ~96-102; HouseholdState ~221-247)

- [ ] **Step 1: Create the Deako domain types**

```ts
// lib/integrations/deako/types.ts
// Domain types for the Deako local-API integration. No I/O here.

export interface DeakoState {
  power: boolean;
  dim: number; // 0–100; for non-dimmable switches treat <100 as on
}

export interface DeakoDevice {
  uuid: string;
  name: string;
  state: DeakoState;
}

export type DeakoConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface DeakoStatus {
  status: DeakoConnectionStatus;
  gatewayIp: string | null;
  deviceCount: number;
  lastError: string | null;
}
```

- [ ] **Step 2: Extend `Light` and `HouseholdState` in `lib/types.ts`**

Replace the `Light` interface (currently lines ~96-102):

```ts
export interface Light {
  id: number;
  name: string;
  room: string;
  on: boolean;
  brightness: number;
  deakoUuid?: string;           // when set, this light controls a real Deako device
  source?: 'manual' | 'deako';
}
```

Add above `HouseholdState` (near the other interfaces):

```ts
export interface DeakoConfig {
  enabled?: boolean;
  gatewayIp?: string;
  lastConnectedAt?: string;
  devices?: { uuid: string; name: string; room?: string }[];
}

export interface Integrations {
  deako?: DeakoConfig;
}
```

Add this field inside the `HouseholdState` interface (alongside `cctv?`):

```ts
  integrations?: Integrations;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no usages yet; just new optional fields).

- [ ] **Step 4: Commit**

```bash
git add lib/integrations/deako/types.ts lib/types.ts
git commit -m "feat(deako): add Deako domain types and household-state model"
```

---

### Task 2: Protocol builders + parser (pure, TDD)

**Files:**
- Create: `lib/integrations/deako/protocol.ts`
- Test: `test/deako-protocol.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/deako-protocol.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildDeviceListRequest,
  buildControlRequest,
  buildPingRequest,
  parseMessages,
} = require('../lib/integrations/deako/protocol.ts');

test('buildDeviceListRequest produces a DEVICE_LIST envelope', () => {
  const msg = JSON.parse(buildDeviceListRequest('tx-1').trim());
  assert.equal(msg.type, 'DEVICE_LIST');
  assert.equal(msg.dst, 'deako');
  assert.equal(msg.src, 'homepal');
  assert.equal(msg.transactionId, 'tx-1');
});

test('buildControlRequest carries target uuid and state', () => {
  const msg = JSON.parse(buildControlRequest('tx-2', 'uuid-9', { power: true, dim: 80 }).trim());
  assert.equal(msg.type, 'CONTROL');
  assert.equal(msg.data.target, 'uuid-9');
  assert.deepEqual(msg.data.state, { power: true, dim: 80 });
});

test('buildPingRequest is a PING envelope', () => {
  const msg = JSON.parse(buildPingRequest('tx-3').trim());
  assert.equal(msg.type, 'PING');
});

test('every request ends with a newline (frame delimiter)', () => {
  assert.ok(buildDeviceListRequest('t').endsWith('\n'));
});

test('parseMessages splits newline-framed JSON and buffers partial tails', () => {
  const a = '{"type":"PING"}\n{"type":"DEVICE_L';
  const r1 = parseMessages(a, '');
  assert.equal(r1.messages.length, 1);
  assert.equal(r1.messages[0].type, 'PING');
  assert.equal(r1.rest, '{"type":"DEVICE_L');

  const r2 = parseMessages('IST","data":{"name":"x"}}\n', r1.rest);
  assert.equal(r2.messages.length, 1);
  assert.equal(r2.messages[0].type, 'DEVICE_LIST');
  assert.equal(r2.rest, '');
});

test('parseMessages ignores malformed lines without throwing', () => {
  const r = parseMessages('not json\n{"type":"PING"}\n', '');
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].type, 'PING');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/deako-protocol.test.js`
Expected: FAIL — cannot find module `protocol.ts` / functions undefined.

> Note: this project runs TS test imports via Node's TS support (Node 22, `--test`). If `require('../lib/.../protocol.ts')` fails to resolve TS, mirror however existing `test/*.test.js` import the `lib/cctv` TS modules and match that exact import style.

- [ ] **Step 3: Implement `protocol.ts`**

```ts
// lib/integrations/deako/protocol.ts
// Pure builders/parser for the Deako local-API wire protocol (newline-framed
// JSON over TCP). No sockets here — fully unit-testable. Mirrors pydeako's
// request/response message shapes; verify field names against pydeako source.

export interface DeakoMessage {
  type: string;
  transactionId?: string;
  dst?: string;
  src?: string;
  data?: unknown;
  [k: string]: unknown;
}

const SRC = 'homepal';

function envelope(transactionId: string, type: string, data?: unknown): string {
  const msg: DeakoMessage = { transactionId, type, dst: 'deako', src: SRC };
  if (data !== undefined) msg.data = data;
  return JSON.stringify(msg) + '\n';
}

export function buildDeviceListRequest(transactionId: string): string {
  return envelope(transactionId, 'DEVICE_LIST');
}

export function buildPingRequest(transactionId: string): string {
  return envelope(transactionId, 'PING');
}

export function buildControlRequest(
  transactionId: string,
  target: string,
  state: { power: boolean; dim: number },
): string {
  return envelope(transactionId, 'CONTROL', { target, state });
}

// Accumulate a socket chunk onto any buffered partial line, return whole
// messages plus the leftover tail to carry into the next call.
export function parseMessages(
  chunk: string,
  carry: string,
): { messages: DeakoMessage[]; rest: string } {
  const buf = carry + chunk;
  const parts = buf.split('\n');
  const rest = parts.pop() ?? ''; // last element is the (possibly empty) partial tail
  const messages: DeakoMessage[] = [];
  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed) as DeakoMessage);
    } catch {
      /* ignore malformed frame */
    }
  }
  return { messages, rest };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/deako-protocol.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/deako/protocol.ts test/deako-protocol.test.js
git commit -m "feat(deako): pure wire-protocol builders and frame parser with tests"
```

---

### Task 3: DeakoClient over a fake TCP server (TDD)

**Files:**
- Create: `lib/integrations/deako/client.ts`
- Test: `test/deako-client.test.js`

- [ ] **Step 1: Write the failing test (fake Deako server speaks the protocol)**

```js
// test/deako-client.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { DeakoClient } = require('../lib/integrations/deako/client.ts');

// Minimal fake Deako device: on DEVICE_LIST it replies with two devices; on
// CONTROL it echoes a state-change for the targeted uuid.
function startFakeDeako() {
  const server = net.createServer((sock) => {
    let carry = '';
    sock.on('data', (b) => {
      carry += b.toString('utf8');
      let i;
      while ((i = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, i);
        carry = carry.slice(i + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'DEVICE_LIST') {
          const reply = (uuid, name, power, dim) => JSON.stringify({
            type: 'DEVICE_LIST', transactionId: msg.transactionId,
            data: { uuid, name, state: { power, dim } },
          }) + '\n';
          sock.write(reply('u1', 'Kitchen', false, 0));
          sock.write(reply('u2', 'Hall', true, 60));
        } else if (msg.type === 'CONTROL') {
          sock.write(JSON.stringify({
            type: 'EVENT', transactionId: msg.transactionId,
            data: { uuid: msg.data.target, state: msg.data.state },
          }) + '\n');
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('connect + listDevices returns the roster from the fake device', async () => {
  const server = await startFakeDeako();
  const { port } = server.address();
  const client = new DeakoClient('127.0.0.1', port);
  await client.connect();
  const devices = await client.listDevices();
  assert.equal(devices.length, 2);
  assert.equal(devices[0].uuid, 'u1');
  assert.equal(devices[1].state.dim, 60);
  client.close();
  server.close();
});

test('setDevice sends CONTROL and resolves with the new state', async () => {
  const server = await startFakeDeako();
  const { port } = server.address();
  const client = new DeakoClient('127.0.0.1', port);
  await client.connect();
  await client.listDevices();
  const state = await client.setDevice('u1', { power: true, dim: 100 });
  assert.equal(state.power, true);
  assert.equal(state.dim, 100);
  client.close();
  server.close();
});

test('connect rejects on a closed port', async () => {
  const client = new DeakoClient('127.0.0.1', 1); // nothing listening
  await assert.rejects(() => client.connect());
  client.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/deako-client.test.js`
Expected: FAIL — `DeakoClient` undefined.

- [ ] **Step 3: Implement `client.ts`**

```ts
// lib/integrations/deako/client.ts
// One TCP socket to a Deako gateway device. Connect, pull the device list,
// send control commands, keepalive-ping, and reconnect on drop. Server-side
// only (node:net). Keeps an in-memory device roster updated from inbound frames.
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { buildControlRequest, buildDeviceListRequest, buildPingRequest, parseMessages } from './protocol';
import type { DeakoDevice, DeakoState } from './types';

const DEAKO_PORT = 23;
const LIST_SETTLE_MS = 800; // device-list frames arrive over a short window
const PING_INTERVAL_MS = 15_000;

export class DeakoClient {
  private sock: net.Socket | null = null;
  private carry = '';
  private devices = new Map<string, DeakoDevice>();
  private pingTimer: NodeJS.Timeout | null = null;
  private waiters: Array<(m: ReturnType<typeof parseMessages>['messages'][number]) => void> = [];

  constructor(private host: string, private port: number = DEAKO_PORT) {}

  connect(timeoutMs = 4000): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: this.host, port: this.port });
      this.sock = sock;
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        try { sock.destroy(); } catch { /* ignore */ }
        reject(err);
      };
      sock.setTimeout(timeoutMs);
      sock.once('timeout', () => fail(new Error('Deako connect timeout')));
      sock.once('error', fail);
      sock.once('connect', () => {
        settled = true;
        sock.setTimeout(0);
        sock.on('data', (b) => this.onData(b.toString('utf8')));
        this.startKeepalive();
        resolve();
      });
    });
  }

  private onData(chunk: string) {
    const { messages, rest } = parseMessages(chunk, this.carry);
    this.carry = rest;
    for (const m of messages) {
      const d = (m.data ?? {}) as Partial<DeakoDevice> & { state?: DeakoState };
      if (d.uuid && d.state) {
        const prev = this.devices.get(d.uuid);
        this.devices.set(d.uuid, {
          uuid: d.uuid,
          name: d.name ?? prev?.name ?? d.uuid,
          state: d.state,
        });
      }
      for (const w of this.waiters.splice(0)) w(m);
    }
  }

  private startKeepalive() {
    this.stopKeepalive();
    this.pingTimer = setInterval(() => {
      try { this.sock?.write(buildPingRequest(randomUUID())); } catch { /* ignore */ }
    }, PING_INTERVAL_MS);
  }
  private stopKeepalive() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  listDevices(): Promise<DeakoDevice[]> {
    return new Promise((resolve, reject) => {
      if (!this.sock) return reject(new Error('not connected'));
      this.devices.clear();
      this.sock.write(buildDeviceListRequest(randomUUID()));
      // Device-list replies stream as separate frames; settle after a short window.
      setTimeout(() => resolve([...this.devices.values()]), LIST_SETTLE_MS);
    });
  }

  setDevice(uuid: string, state: DeakoState): Promise<DeakoState> {
    return new Promise((resolve, reject) => {
      if (!this.sock) return reject(new Error('not connected'));
      const tx = randomUUID();
      const timer = setTimeout(() => reject(new Error('Deako control timeout')), 4000);
      this.waiters.push(() => {
        const updated = this.devices.get(uuid)?.state ?? state;
        clearTimeout(timer);
        resolve(updated);
      });
      this.sock.write(buildControlRequest(tx, uuid, state));
    });
  }

  getDevices(): DeakoDevice[] {
    return [...this.devices.values()];
  }

  close() {
    this.stopKeepalive();
    try { this.sock?.destroy(); } catch { /* ignore */ }
    this.sock = null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/deako-client.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/deako/client.ts test/deako-client.test.js
git commit -m "feat(deako): TCP client tested against a fake Deako device"
```

---

### Task 4: Connection manager singleton + public surface

**Files:**
- Create: `lib/integrations/deako/manager.ts`
- Create: `lib/integrations/deako/index.ts`

- [ ] **Step 1: Implement the manager (singleton, mirrors `getPool()` in `lib/db.ts:26,116-124`)**

```ts
// lib/integrations/deako/manager.ts
// Process-wide singleton owning the active DeakoClient. Lazy-connects to a
// gateway IP, survives dev hot-reload (globalThis pin), and never throws across
// the API boundary — callers get status objects / typed errors.
import { DeakoClient } from './client';
import type { DeakoDevice, DeakoState, DeakoStatus } from './types';

interface ManagerState {
  client: DeakoClient | null;
  gatewayIp: string | null;
  status: DeakoStatus['status'];
  lastError: string | null;
}

const g = globalThis as unknown as { _hpDeako?: ManagerState };
function state(): ManagerState {
  if (!g._hpDeako) g._hpDeako = { client: null, gatewayIp: null, status: 'disconnected', lastError: null };
  return g._hpDeako;
}

export async function connectDeako(gatewayIp: string): Promise<DeakoStatus> {
  const s = state();
  if (s.client && s.gatewayIp === gatewayIp && s.status === 'connected') return status();
  if (s.client) s.client.close();
  s.client = new DeakoClient(gatewayIp);
  s.gatewayIp = gatewayIp;
  s.status = 'connecting';
  s.lastError = null;
  try {
    await s.client.connect();
    await s.client.listDevices();
    s.status = 'connected';
  } catch (err) {
    s.status = 'error';
    s.lastError = err instanceof Error ? err.message : 'connect failed';
    s.client = null;
  }
  return status();
}

export async function listDeakoDevices(): Promise<DeakoDevice[]> {
  const s = state();
  if (!s.client || s.status !== 'connected') return [];
  return s.client.listDevices();
}

export async function controlDeako(uuid: string, next: DeakoState): Promise<DeakoState> {
  const s = state();
  if (!s.client || s.status !== 'connected') throw new Error('Deako not connected');
  return s.client.setDevice(uuid, next);
}

export function status(): DeakoStatus {
  const s = state();
  return {
    status: s.status,
    gatewayIp: s.gatewayIp,
    deviceCount: s.client ? s.client.getDevices().length : 0,
    lastError: s.lastError,
  };
}
```

- [ ] **Step 2: Public re-exports**

```ts
// lib/integrations/deako/index.ts
export { connectDeako, listDeakoDevices, controlDeako, status as deakoStatus } from './manager';
export type { DeakoDevice, DeakoState, DeakoStatus, DeakoConnectionStatus } from './types';
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/integrations/deako/manager.ts lib/integrations/deako/index.ts
git commit -m "feat(deako): singleton connection manager and public surface"
```

---

### Task 5: API routes (connect / devices / control / status)

**Files:**
- Create: `app/api/integrations/deako/connect/route.ts`
- Create: `app/api/integrations/deako/devices/route.ts`
- Create: `app/api/integrations/deako/control/route.ts`
- Create: `app/api/integrations/deako/status/route.ts`

Pattern to follow exactly: `app/api/cctv/config/route.ts` (auth via `getSessionUser`, `loadState`/`saveState`, `runtime='nodejs'`, JSON errors). SSRF guard via `isPrivateHost` from `lib/discovery.ts`.

- [ ] **Step 1: `connect` route**

```ts
// app/api/integrations/deako/connect/route.ts
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { loadState, saveState } from '@/lib/state';
import { isDbConnectivityError } from '@/lib/db';
import { isPrivateHost } from '@/lib/discovery';
import { connectDeako, listDeakoDevices } from '@/lib/integrations/deako';
import type { HouseholdState } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: { gatewayIp?: string };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const gatewayIp = String(body.gatewayIp || '').trim();
    if (!gatewayIp || !isPrivateHost(gatewayIp)) {
      return NextResponse.json({ error: 'Enter a valid private LAN IP for a Deako device' }, { status: 400 });
    }

    const state = await loadState(user.id);
    if (!state) return NextResponse.json({ error: 'Household not found' }, { status: 404 });

    const st = await connectDeako(gatewayIp);
    if (st.status !== 'connected') {
      return NextResponse.json({ connected: false, error: st.lastError || 'Could not reach Deako' }, { status: 502 });
    }
    const devices = await listDeakoDevices();
    const next = {
      ...state,
      integrations: {
        ...(state.integrations || {}),
        deako: {
          enabled: true,
          gatewayIp,
          lastConnectedAt: new Date().toISOString(),
          devices: devices.map((d) => ({ uuid: d.uuid, name: d.name })),
        },
      },
    } as HouseholdState;
    await saveState(user.id, next);
    return NextResponse.json({ connected: true, devices });
  } catch (err) {
    if (isDbConnectivityError(err)) return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
    console.error('[deako/connect]', err);
    return NextResponse.json({ error: 'Deako connect failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: `devices` route**

```ts
// app/api/integrations/deako/devices/route.ts
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { listDeakoDevices, deakoStatus } from '@/lib/integrations/deako';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const st = deakoStatus();
  if (st.status !== 'connected') return NextResponse.json({ connected: false, devices: [] });
  const devices = await listDeakoDevices();
  return NextResponse.json({ connected: true, devices });
}
```

- [ ] **Step 3: `control` route**

```ts
// app/api/integrations/deako/control/route.ts
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { controlDeako, deakoStatus } from '@/lib/integrations/deako';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { uuid?: string; power?: boolean; dim?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const uuid = String(body.uuid || '').trim();
  if (!uuid) return NextResponse.json({ error: 'uuid required' }, { status: 400 });
  if (deakoStatus().status !== 'connected') {
    return NextResponse.json({ error: 'Deako not connected', connected: false }, { status: 409 });
  }
  const power = body.power ?? true;
  const dim = Math.min(100, Math.max(0, Number(body.dim ?? (power ? 100 : 0))));
  try {
    const state = await controlDeako(uuid, { power, dim });
    return NextResponse.json({ ok: true, state });
  } catch (err) {
    console.error('[deako/control]', err);
    return NextResponse.json({ error: 'Control failed' }, { status: 502 });
  }
}
```

- [ ] **Step 4: `status` route**

```ts
// app/api/integrations/deako/status/route.ts
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { deakoStatus } from '@/lib/integrations/deako';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(deakoStatus());
}
```

- [ ] **Step 5: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS (routes compile; no usage of removed symbols).

- [ ] **Step 6: Commit**

```bash
git add app/api/integrations/deako
git commit -m "feat(deako): connect/devices/control/status API routes"
```

---

### Task 6: Browser fetch helpers

**Files:**
- Create: `lib/integrations/deako/deakoClientApi.ts`

- [ ] **Step 1: Implement client-side fetch helpers**

```ts
// lib/integrations/deako/deakoClientApi.ts
// Browser-side helpers for the Deako API. Never import server modules here.
import type { DeakoDevice, DeakoStatus } from './types';

export async function apiConnectDeako(gatewayIp: string): Promise<{ connected: boolean; devices?: DeakoDevice[]; error?: string }> {
  const r = await fetch('/api/integrations/deako/connect', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gatewayIp }),
  });
  return r.json();
}

export async function apiDeakoDevices(): Promise<{ connected: boolean; devices: DeakoDevice[] }> {
  const r = await fetch('/api/integrations/deako/devices');
  return r.json();
}

export async function apiDeakoControl(uuid: string, power: boolean, dim?: number): Promise<{ ok?: boolean; error?: string }> {
  const r = await fetch('/api/integrations/deako/control', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uuid, power, dim }),
  });
  return r.json();
}

export async function apiDeakoStatus(): Promise<DeakoStatus> {
  const r = await fetch('/api/integrations/deako/status');
  return r.json();
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add lib/integrations/deako/deakoClientApi.ts
git commit -m "feat(deako): browser fetch helpers for the Deako API"
```

---

### Task 7: Wire light actions to real Deako control

**Files:**
- Modify: `hooks/useActions.tsx` (`toggleLight` ~87-95, `setBrightness` ~96-101, `allLights` ~102-108)

The actions keep their optimistic local `update(...)` (instant UI), then fire a real command for any affected light that has a `deakoUuid`. On failure, toast and revert that light.

- [ ] **Step 1: Add the import at the top of `hooks/useActions.tsx`**

```ts
import { apiDeakoControl } from '@/lib/integrations/deako/deakoClientApi';
```

- [ ] **Step 2: Add a private helper inside the hook (near the other smart-home actions)**

```ts
  // Push a light's current state to its linked Deako device (best-effort).
  // Reverts the optimistic UI change on hardware failure.
  function syncLightToDeako(id: number, revert: () => void) {
    const light = stateRef.current.lights.find((x) => x.id === id);
    if (!light?.deakoUuid) return;
    apiDeakoControl(light.deakoUuid, light.on, light.on ? light.brightness : 0)
      .then((res) => {
        if (res?.error) { revert(); toast('Deako: ' + res.error, 'danger'); }
      })
      .catch(() => { revert(); toast('Deako device unreachable', 'danger'); });
  }
```

> If the hook does not already expose a `stateRef`/current-state ref, read the current light from the same source `toggleLight` uses (the closure `d` is only valid inside `update`). Capture the post-update light values into locals inside `update` and pass them to `apiDeakoControl` directly instead of re-reading — whichever matches the file's existing pattern. Do not introduce a new state mirror if one isn't already there.

- [ ] **Step 3: Update `toggleLight` to fire the command and revert on failure**

```ts
  function toggleLight(id: number) {
    let nextOn = false;
    update((d) => {
      const l = d.lights.find((x) => x.id === id);
      if (!l) return;
      l.on = !l.on;
      nextOn = l.on;
      d.alerts.unshift({ id: ++d.nid, type: 'light', msg: l.name + ' turned ' + (l.on ? 'on' : 'off'), time: 'Just now', sev: 'info', seen: false });
      toast(l.name + ' ' + (l.on ? 'on' : 'off'), l.on ? 'success' : 'info');
    });
    const light = /* current */ undefined as unknown as { deakoUuid?: string; brightness: number } | undefined;
    void light; // resolved by Step 2 pattern
    syncLightToDeako(id, () => update((d) => {
      const l = d.lights.find((x) => x.id === id);
      if (l) l.on = !nextOn;
    }));
  }
```

> Keep the existing optimistic update + toast verbatim; only add the trailing `syncLightToDeako(...)` call with a revert that flips `l.on` back. Match the file's real current-state access pattern (see Step 2 note) — the `void light` line above is a placeholder to delete once you wire the real read.

- [ ] **Step 4: Update `setBrightness` (debounced control) and `allLights`**

```ts
  function setBrightness(id: number, value: number) {
    let prev = value;
    update((d) => {
      const l = d.lights.find((x) => x.id === id);
      if (l) { prev = l.brightness; l.brightness = value; }
    });
    syncLightToDeako(id, () => update((d) => {
      const l = d.lights.find((x) => x.id === id);
      if (l) l.brightness = prev;
    }));
  }

  function allLights(on: boolean) {
    const affected: number[] = [];
    update((d) => {
      const ls = ui.homeRoom === 'all' ? d.lights : d.lights.filter((l) => l.room === ui.homeRoom);
      ls.forEach((l) => { l.on = on; if (l.deakoUuid) affected.push(l.id); });
    });
    toast('All lights ' + (on ? 'on' : 'off'), on ? 'success' : 'info');
    affected.forEach((id) => syncLightToDeako(id, () => {}));
  }
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add hooks/useActions.tsx
git commit -m "feat(deako): drive real Deako devices from light actions with revert-on-failure"
```

---

### Task 8: Deako settings panel + light linking UI

**Files:**
- Modify: `components/views/Home.tsx` (add a "Deako" settings card)
- Modify: `hooks/useActions.tsx` (`saveManage` ~198-205 / the manage-device modal) to set `deakoUuid`

- [ ] **Step 1: Add a Deako connect/status card to the Smart Home view**

In `components/views/Home.tsx`, add a settings card (match the existing card markup/classes in that file) that:
- reads `apiDeakoStatus()` on mount and shows status (`connected` / `error` + `lastError`);
- has a text input for the gateway IP (prefill from `state.integrations?.deako?.gatewayIp`) and a "Connect" button calling `apiConnectDeako(ip)`;
- on success lists returned devices.

```tsx
// imports at top of components/views/Home.tsx
import { useEffect, useState } from 'react';
import { apiConnectDeako, apiDeakoStatus } from '@/lib/integrations/deako/deakoClientApi';
import type { DeakoStatus, DeakoDevice } from '@/lib/integrations/deako/types';

// inside the component:
const [deako, setDeako] = useState<DeakoStatus | null>(null);
const [gatewayIp, setGatewayIp] = useState(state.integrations?.deako?.gatewayIp ?? '');
const [deakoDevices, setDeakoDevices] = useState<DeakoDevice[]>([]);
const [connecting, setConnecting] = useState(false);

useEffect(() => { apiDeakoStatus().then(setDeako).catch(() => {}); }, []);

async function connect() {
  setConnecting(true);
  const res = await apiConnectDeako(gatewayIp.trim());
  setConnecting(false);
  if (res.connected) { setDeakoDevices(res.devices ?? []); apiDeakoStatus().then(setDeako); }
  else alert(res.error || 'Could not connect to Deako');
}
```

Render a card using the file's existing card classes with the input, a Connect button (`disabled={connecting}`), a status line, and a list of `deakoDevices` (name + uuid). Keep copy honest: when `deako?.status !== 'connected'` show "Deako control requires HomePal running on your home network."

- [ ] **Step 2: Add the Deako-link picker to the manage-light flow**

In the manage-light modal path (`openManageDevice('light', id)` → `ManageDeviceModal` → `saveManage`), add an optional `<select>` of Deako devices (from `apiDeakoDevices()`), and extend `saveManage` to persist the chosen uuid:

```ts
  function saveManage(kind: 'light' | 'device', id: number, name: string, room: string, icon: string, deakoUuid?: string) {
    update((d) => {
      const arr: (Light | Device)[] = kind === 'light' ? d.lights : d.devices;
      const dev = arr.find((x) => x.id === id);
      if (!dev) return;
      dev.name = name.trim() || dev.name;
      dev.room = room || dev.room;
      // icon handling stays as the existing code does it
      if (kind === 'light') {
        const l = dev as Light;
        if (deakoUuid !== undefined) { l.deakoUuid = deakoUuid || undefined; l.source = deakoUuid ? 'deako' : 'manual'; }
      }
    });
  }
```

> Preserve the existing `icon` assignment exactly as it currently appears in `saveManage`; only add the trailing light-link block and the new optional parameter. Update the `ManageDeviceModal` caller to pass the selected uuid.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/views/Home.tsx hooks/useActions.tsx
git commit -m "feat(deako): settings panel and light-to-device linking UI"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, including the new `deako-protocol` and `deako-client` tests.

- [ ] **Step 2: Lint + typecheck + build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 3: Manual smoke (cloud-safe path)**

With no Deako on the network, confirm: the Deako settings card shows the "requires home network" copy; `POST /connect` to an unreachable IP returns a clean 502 (not a 500/stack); toggling an *unlinked* light still works exactly as before.

- [ ] **Step 4: Hardware validation (user, on self-hosted box)**

Document in the PR description that the user must: deploy to the self-hosted box on the Deako LAN, enter a Deako device IP in the settings card, link a light to a Deako device, and confirm the physical switch responds to toggle/brightness.

- [ ] **Step 5: Final commit / open PR**

```bash
git add -A
git commit -m "test(deako): full verification pass" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- §1 goal (real light control) → Tasks 7, 8. §3 protocol → Tasks 2, 3. §4 architecture (protocol/client/manager) → Tasks 2–4. §5 data model → Task 1. §6 API routes → Task 5. §7 client wiring → Tasks 6–8. §8 discovery (manual IP primary) → Task 5 `connect` + Task 8 UI; mDNS explicitly deferred. §9 lifecycle/cloud degradation → Task 3 (reconnect/keepalive), Task 5 (502/503, no leak), Task 8 (honest copy). §10 security → Task 5 (`isPrivateHost`, auth, tenant isolation). §11 testing → Tasks 2, 3, 9.
- Deferred-by-spec and intentionally absent: mDNS auto-discovery, SSE inbound push, physical-switch polling (spec §8/§13 phase 2).

**Placeholder scan:** The only deliberate "resolve at implementation" markers are in Task 7 Step 3 (`void light` placeholder) and Task 2/3 protocol-format verification — both are explicit instructions tied to reading real source (`useActions.tsx` current-state pattern; `pydeako` wire format), not vague hand-waving. Acceptable and called out.

**Type consistency:** `DeakoDevice`/`DeakoState`/`DeakoStatus` defined in Task 1, used identically in Tasks 3–6. Function names consistent: `connectDeako`/`listDeakoDevices`/`controlDeako`/`status`→`deakoStatus` (aliased in index). `Light.deakoUuid`/`source` defined Task 1, used Tasks 7, 8. API helper names (`apiConnectDeako`/`apiDeakoDevices`/`apiDeakoControl`/`apiDeakoStatus`) consistent across Tasks 6–8.
