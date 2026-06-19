# Cameras in Smart Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the standalone CCTV view, fold camera management into Smart Home as a "Cameras" section, and add a brand-aware add flow (Tapo local RTSP; ADT/generic ONVIF best-effort) — reusing the existing recording engine unchanged.

**Architecture:** A pure brand adapter (`lib/cameras/brands.ts`) builds the `rtsp://` URL the engine already consumes; the `config`/`test` routes derive+encrypt it from friendly fields. The standalone `/app/cctv` view is removed (redirect kept), and `components/views/Cctv.tsx` becomes a `CamerasPanel` rendered inside `components/views/Home.tsx`, with a brand-aware modal replacing the `window.prompt` add flow.

**Tech Stack:** TypeScript, Next.js 15 route handlers, existing `lib/cctv/*` ffmpeg engine + `lib/crypto.ts`, `node --test`. No new npm dependencies.

---

## File Structure

- Create `lib/cameras/brands.ts` — pure `buildRtspUrl(fields)` for tapo/onvif/generic.
- Modify `lib/cctv/index.ts` — add `brand`/`host`/`streamQuality` to `Camera` + `SanitizedCamera` + `sanitizeCamerasForClient`.
- Modify `app/api/cctv/config/route.ts` — derive+encrypt rtspUrl from brand fields.
- Modify `app/api/cctv/test/route.ts` — build URL from brand fields before probing.
- Modify `lib/constants.ts` — remove the `cctv` entry from `VIEWS` (line ~84).
- Modify `components/shell/AppShell.tsx` — remove the `/app/cctv` title-map line (~17).
- Replace `app/app/cctv/page.tsx` — redirect to `/app/home`.
- Create `components/views/cameras/CamerasPanel.tsx` — the moved camera UI + brand modal.
- Delete `components/views/Cctv.tsx` (logic moves into the panel).
- Modify `components/views/Home.tsx` — render `<CamerasPanel />` as a Cameras section.
- Modify `lib/entitlements.ts` — relabel `FEATURE_LABELS.cctv` to "Cameras".
- Create `test/camera-brands.test.js`.

---

### Task 1: Brand adapter (pure, TDD)

**Files:**
- Create: `lib/cameras/brands.ts`
- Test: `test/camera-brands.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/camera-brands.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildRtspUrl } = require('../lib/cameras/brands.ts');

test('tapo HD builds stream1 with encoded creds', () => {
  const r = buildRtspUrl({ brand: 'tapo', host: '192.168.1.50', username: 'cam', password: 'p@ss', streamQuality: 'hd' });
  assert.equal(r.rtspUrl, 'rtsp://cam:p%40ss@192.168.1.50:554/stream1');
});

test('tapo SD builds stream2', () => {
  const r = buildRtspUrl({ brand: 'tapo', host: '10.0.0.9', username: 'u', password: 'pw', streamQuality: 'sd' });
  assert.equal(r.rtspUrl, 'rtsp://u:pw@10.0.0.9:554/stream2');
});

test('tapo defaults to HD when streamQuality omitted', () => {
  const r = buildRtspUrl({ brand: 'tapo', host: '10.0.0.9', username: 'u', password: 'pw' });
  assert.ok(r.rtspUrl.endsWith('/stream1'));
});

test('tapo missing host throws', () => {
  assert.throws(() => buildRtspUrl({ brand: 'tapo', username: 'u', password: 'pw' }), /host/i);
});

test('generic passes through a full rtsp url', () => {
  const r = buildRtspUrl({ brand: 'generic', rtspUrl: 'rtsp://x:y@192.168.1.7:554/h264' });
  assert.equal(r.rtspUrl, 'rtsp://x:y@192.168.1.7:554/h264');
  assert.ok(r.warnings.some((w) => /best-effort/i.test(w)));
});

test('generic rejects a non-rtsp url', () => {
  assert.throws(() => buildRtspUrl({ brand: 'generic', rtspUrl: 'http://nope' }), /rtsp:\/\//i);
});

test('onvif builds from host + path', () => {
  const r = buildRtspUrl({ brand: 'onvif', host: '192.168.1.8', username: 'a', password: 'b', rtspPath: 'profile1' });
  assert.equal(r.rtspUrl, 'rtsp://a:b@192.168.1.8:554/profile1');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/camera-brands.test.js`
Expected: FAIL — cannot find `buildRtspUrl`.

> Match the TS-import style used by existing `test/*.test.js` that import `lib/cctv` modules; mirror it exactly.

- [ ] **Step 3: Implement `lib/cameras/brands.ts`**

```ts
// lib/cameras/brands.ts
// Pure adapters that turn friendly per-brand camera fields into the rtsp:// URL
// the recording engine consumes. No I/O — fully unit-testable. The caller
// (config/test routes) encrypts the returned URL at rest via lib/crypto.

export type CameraBrand = 'tapo' | 'onvif' | 'generic';

export interface BrandFields {
  brand: CameraBrand;
  host?: string;
  username?: string;
  password?: string;
  streamQuality?: 'hd' | 'sd';
  rtspUrl?: string;
  rtspPath?: string;
}

export interface BuiltStream {
  rtspUrl: string;
  warnings: string[];
}

const EXPERIMENTAL =
  'ADT and other proprietary cameras may not expose RTSP/ONVIF; this is best-effort.';

function creds(username?: string, password?: string): string {
  if (!username) return '';
  const u = encodeURIComponent(username);
  const p = password ? ':' + encodeURIComponent(password) : '';
  return `${u}${p}@`;
}

export function buildRtspUrl(f: BrandFields): BuiltStream {
  if (f.brand === 'tapo') {
    if (!f.host) throw new Error('Tapo camera needs a host/IP');
    if (!f.username || !f.password) throw new Error('Tapo camera needs the camera-account username and password');
    const stream = f.streamQuality === 'sd' ? 'stream2' : 'stream1';
    return { rtspUrl: `rtsp://${creds(f.username, f.password)}${f.host}:554/${stream}`, warnings: [] };
  }

  // generic / onvif (covers ADT best-effort)
  if (f.rtspUrl) {
    const url = f.rtspUrl.trim();
    if (!/^rtsp:\/\//i.test(url)) throw new Error('Stream URL must start with rtsp://');
    return { rtspUrl: url, warnings: [EXPERIMENTAL] };
  }
  if (!f.host) throw new Error('Camera needs a host/IP or a full rtsp:// URL');
  const path = (f.rtspPath || '').replace(/^\/+/, '');
  return { rtspUrl: `rtsp://${creds(f.username, f.password)}${f.host}:554/${path}`, warnings: [EXPERIMENTAL] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/camera-brands.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/cameras/brands.ts test/camera-brands.test.js
git commit -m "feat(cameras): brand adapter for Tapo/ONVIF/generic RTSP URLs with tests"
```

---

### Task 2: Extend Camera config types + sanitization

**Files:**
- Modify: `lib/cctv/index.ts` (`Camera` ~24-32; `SanitizedCamera` ~406-414; `sanitizeCamerasForClient` ~417-440)

- [ ] **Step 1: Add brand metadata to `Camera`**

In `lib/cctv/index.ts`, extend the `Camera` interface:

```ts
export interface Camera {
  id: string;
  name: string;
  rtspUrl: string; // ciphertext at rest
  sensitivity: number;
  preRoll: number;
  postRoll: number;
  enabled: boolean;
  brand?: 'tapo' | 'onvif' | 'generic'; // non-secret display/edit metadata
  host?: string;
  streamQuality?: 'hd' | 'sd';
}
```

- [ ] **Step 2: Echo non-secret brand fields in `SanitizedCamera` + sanitizer**

Extend `SanitizedCamera`:

```ts
export interface SanitizedCamera {
  id: string;
  name: string;
  sensitivity: number;
  preRoll: number;
  postRoll: number;
  enabled: boolean;
  rtspMasked: string;
  brand?: 'tapo' | 'onvif' | 'generic';
  host?: string;
  streamQuality?: 'hd' | 'sd';
}
```

In `sanitizeCamerasForClient`, add the three non-secret fields to the returned
allowlist object (keep `rtspMasked` as the only stream string; never spread `c`):

```ts
    return {
      id: c.id,
      name: c.name,
      sensitivity: c.sensitivity,
      preRoll: c.preRoll,
      postRoll: c.postRoll,
      enabled: c.enabled,
      rtspMasked: masked,
      brand: c.brand,
      host: c.host,
      streamQuality: c.streamQuality,
    };
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/cctv/index.ts
git commit -m "feat(cameras): persist non-secret brand metadata on cameras"
```

---

### Task 3: Brand-aware config + test routes

**Files:**
- Modify: `app/api/cctv/config/route.ts` (`RawCamera` ~17-25; camera loop ~60-90)
- Modify: `app/api/cctv/test/route.ts`

- [ ] **Step 1: Accept brand fields in the config route**

In `app/api/cctv/config/route.ts`, extend `RawCamera`:

```ts
interface RawCamera {
  id?: string;
  name?: string;
  rtspUrl?: string;
  sensitivity?: number;
  preRoll?: number;
  postRoll?: number;
  enabled?: boolean;
  brand?: 'tapo' | 'onvif' | 'generic';
  host?: string;
  username?: string;
  password?: string;
  streamQuality?: 'hd' | 'sd';
}
```

Add the import:

```ts
import { buildRtspUrl } from '@/lib/cameras/brands';
import { isPrivateHost } from '@/lib/discovery';
```

In the camera loop, replace the rtspUrl-resolution block so brand fields derive
the URL when no literal `rtspUrl` is supplied. The new resolution (keeping the
"keep existing ciphertext" and "literal rtsp" branches):

```ts
    let rtspUrl: string;
    const hasLiteral = typeof raw.rtspUrl === 'string' && raw.rtspUrl.trim();
    if (hasLiteral) {
      if (!/^rtsp:\/\//i.test(raw.rtspUrl!.trim())) {
        return NextResponse.json({ error: `Camera "${raw.name || id}" stream URL must start with rtsp://` }, { status: 400 });
      }
      rtspUrl = encryptSecret(raw.rtspUrl!.trim());
    } else if (raw.brand && (raw.host || raw.brand !== 'tapo')) {
      if (raw.host && !isPrivateHost(raw.host)) {
        return NextResponse.json({ error: `Camera "${raw.name || id}" host must be a private LAN address` }, { status: 400 });
      }
      try {
        const built = buildRtspUrl({
          brand: raw.brand, host: raw.host, username: raw.username,
          password: raw.password, streamQuality: raw.streamQuality, rtspPath: undefined,
        });
        rtspUrl = encryptSecret(built.rtspUrl);
      } catch (e) {
        return NextResponse.json({ error: `Camera "${raw.name || id}": ${(e as Error).message}` }, { status: 400 });
      }
    } else if (existing) {
      rtspUrl = existing.rtspUrl; // keep stored ciphertext
    } else {
      return NextResponse.json({ error: `Camera "${raw.name || id}" needs a stream (brand fields or rtsp:// URL)` }, { status: 400 });
    }
```

And include the non-secret brand fields when pushing the camera:

```ts
    cameras.push({
      id,
      name: String(raw.name || 'Camera').slice(0, 60),
      rtspUrl,
      sensitivity: Math.min(0.5, Math.max(0.005, Number(raw.sensitivity) || 0.04)),
      preRoll: Math.min(30, Math.max(0, Number(raw.preRoll) ?? 5)),
      postRoll: Math.min(60, Math.max(0, Number(raw.postRoll) ?? 8)),
      enabled: !!raw.enabled,
      brand: raw.brand ?? (existing?.brand),
      host: raw.host ?? existing?.host,
      streamQuality: raw.streamQuality ?? existing?.streamQuality,
    });
```

- [ ] **Step 2: Build URL from brand fields in the test route**

Read `app/api/cctv/test/route.ts` first. It currently expects `{ rtspUrl }` and
runs `validateRtspUrl`. Add brand support: if the body has `brand` and no
`rtspUrl`, call `buildRtspUrl(...)` to derive the URL, then probe it. Keep the
existing literal-`rtspUrl` path. Example shape (adapt to the file's real handler):

```ts
import { buildRtspUrl } from '@/lib/cameras/brands';
// ...
let url = typeof body.rtspUrl === 'string' ? body.rtspUrl.trim() : '';
if (!url && body.brand) {
  try { url = buildRtspUrl(body).rtspUrl; }
  catch (e) { return NextResponse.json({ ok: false, reason: (e as Error).message }, { status: 400 }); }
}
// then: const result = await validateRtspUrl(url); (existing cloud/gating logic unchanged)
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/cctv/config/route.ts app/api/cctv/test/route.ts
git commit -m "feat(cameras): derive+encrypt rtsp from brand fields in config/test routes"
```

---

### Task 4: Remove the standalone view + nav, add redirect

**Files:**
- Modify: `lib/constants.ts` (`VIEWS` ~79-86)
- Modify: `components/shell/AppShell.tsx` (title map ~17)
- Replace: `app/app/cctv/page.tsx`
- Modify: `lib/entitlements.ts` (`FEATURE_LABELS.cctv` ~14)

- [ ] **Step 1: Remove the CCTV nav entry**

In `lib/constants.ts`, delete this line from the `VIEWS` array (line ~84):

```ts
  { id: 'cctv', icon: 'fa-video', label: 'CCTV', href: '/app/cctv' },
```

- [ ] **Step 2: Remove the title-map entry**

In `components/shell/AppShell.tsx`, delete line ~17:

```ts
  '/app/cctv': 'Cameras & Storage',
```

- [ ] **Step 3: Redirect the old route**

Replace the entire contents of `app/app/cctv/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

// The CCTV view was folded into Smart Home; keep old links working.
export default function CctvPage() {
  redirect('/app/home');
}
```

- [ ] **Step 4: Relabel the entitlement**

In `lib/entitlements.ts`, change the `cctv` label (keep the key):

```ts
  cctv: 'Cameras',
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS. (Build will still reference `components/views/Cctv.tsx` until Task 5; if the import is already gone, ensure no dangling import remains.)

- [ ] **Step 6: Commit**

```bash
git add lib/constants.ts components/shell/AppShell.tsx app/app/cctv/page.tsx lib/entitlements.ts
git commit -m "refactor(cameras): remove standalone CCTV nav/view, redirect to Smart Home"
```

---

### Task 5: Move the camera UI into a CamerasPanel inside Smart Home

**Files:**
- Create: `components/views/cameras/CamerasPanel.tsx`
- Delete: `components/views/Cctv.tsx`
- Modify: `components/views/Home.tsx`

- [ ] **Step 1: Create `CamerasPanel.tsx` from the existing view**

Copy the full body of `components/views/Cctv.tsx` into
`components/views/cameras/CamerasPanel.tsx`, renaming the exported component
`Cctv` → `CamerasPanel`. Keep all logic (status load, saveConfig, toggle,
sensitivity, clips, player) verbatim for now. Update the user-facing copy
"CCTV recording requires self-hosting" → "Camera recording requires
self-hosting" and "Couldn't load CCTV status" → "Couldn't load camera status".
Fix the import depth (`@/store/household`, `@/components/ui/UpgradePrompt` are
absolute, so they are unaffected).

- [ ] **Step 2: Render the panel inside Smart Home**

In `components/views/Home.tsx`, import and render the panel as a new "Cameras"
section, placed consistently with the existing lights/devices/scenes sections:

```tsx
import { CamerasPanel } from '@/components/views/cameras/CamerasPanel';
// ... within the Smart Home view JSX, as its own section:
<section className="mt-6">
  <h2 className="section-title">Cameras</h2>
  <CamerasPanel />
</section>
```

> Match `Home.tsx`'s actual section heading pattern/classes (use whatever the
> lights/devices sections use, not the literal `section-title` above if it differs).

- [ ] **Step 3: Delete the old view**

```bash
git rm components/views/Cctv.tsx
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS, with no remaining references to `components/views/Cctv`.

- [ ] **Step 5: Commit**

```bash
git add components/views/cameras/CamerasPanel.tsx components/views/Home.tsx
git commit -m "feat(cameras): render Cameras panel inside Smart Home"
```

---

### Task 6: Brand-aware Add Camera modal

**Files:**
- Modify: `components/views/cameras/CamerasPanel.tsx` (replace `cctvAddCamera`)

- [ ] **Step 1: Replace the `window.prompt` add flow with an in-app modal**

Remove the two `window.prompt` calls in `cctvAddCamera`. Add modal state and a
form with a brand selector and brand-specific fields. The submit handler sends
brand fields (not a hand-built URL) to `/test` then `/config`:

```tsx
// modal state near the other useState hooks:
const [addOpen, setAddOpen] = useState(false);
const [form, setForm] = useState<{ name: string; brand: 'tapo' | 'adt' | 'generic'; host: string; username: string; password: string; streamQuality: 'hd' | 'sd'; rtspUrl: string }>(
  { name: '', brand: 'tapo', host: '', username: '', password: '', streamQuality: 'hd', rtspUrl: '' },
);

// brand 'adt' maps to the generic/onvif adapter on the wire:
function brandWire(b: 'tapo' | 'adt' | 'generic'): 'tapo' | 'onvif' | 'generic' {
  return b === 'tapo' ? 'tapo' : 'generic';
}

async function submitAddCamera() {
  const wire = brandWire(form.brand);
  const fields = wire === 'tapo'
    ? { brand: wire, host: form.host, username: form.username, password: form.password, streamQuality: form.streamQuality }
    : (form.rtspUrl.trim() ? { brand: wire, rtspUrl: form.rtspUrl.trim() } : { brand: wire, host: form.host, username: form.username, password: form.password });
  toast('Testing stream…', 'info');
  const t = await fetch('/api/cctv/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }).then((r) => r.json()).catch(() => ({ ok: false }));
  if (!t.ok) toast('Stream test failed: ' + (t.reason || 'unreachable') + ' — saving anyway', 'error');
  const cams = camerasPayload();
  cams.push({ name: form.name || 'Camera', sensitivity: 0.04, preRoll: 5, postRoll: 8, enabled: true, ...fields } as CameraPayload);
  await saveConfig({ cameras: cams }).then(() => { toast('Camera added', 'success'); setAddOpen(false); }).catch((e: Error) => toast(e.message || 'Could not add camera', 'error'));
}
```

Extend the `CameraPayload` interface in this file to include the optional brand
fields (`brand?`, `host?`, `username?`, `password?`, `streamQuality?`) so the
spread typechecks. Render a modal (reuse the app's modal markup/classes used
elsewhere) wired to `addOpen`/`setAddOpen`, with:
- a Brand `<select>`: Tapo / ADT (experimental) / Generic ONVIF;
- Tapo → host, camera-account username, password, HD/SD toggle, with helptext
  "Use the camera account you created in the Tapo app, not your Tapo login";
- ADT/Generic → a full `rtsp://` URL field (or host+user+pass), with an
  "Experimental — many ADT cameras don't expose RTSP/ONVIF" note.

Change the "Add camera" button's `onClick` from `cctvAddCamera` to `() => setAddOpen(true)`.

- [ ] **Step 2: Replace the raw enable checkbox with the app toggle (audit nit)**

Swap the `<input type="checkbox">` in the camera card for the app's `.toggle`
switch component/markup used elsewhere in the Smart Home view, wired to
`cctvToggleCamera(c.id, …)`.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/views/cameras/CamerasPanel.tsx
git commit -m "feat(cameras): brand-aware Add Camera modal (Tapo/ADT/generic)"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, including `camera-brands` and all pre-existing CCTV engine tests.

- [ ] **Step 2: Lint + typecheck + build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 3: Manual smoke (cloud-safe)**

Confirm: visiting `/app/cctv` redirects to `/app/home`; the Smart Home view shows
a Cameras section; the sidebar no longer lists CCTV; the Add Camera modal opens
(no `window.prompt`); on a non-self-hosted instance the self-host banner shows and
config still saves; a free-plan user sees the upgrade prompt scoped to the panel.

- [ ] **Step 4: Hardware validation (user, self-hosted box)**

Document in the PR: on the self-hosted box with ffmpeg, add a real Tapo camera via
the modal (host + camera-account creds), confirm the stream test passes and motion
clips record; try the generic/ADT path with a known RTSP URL.

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "test(cameras): full verification pass" --allow-empty
```

---

## Self-Review

**Spec coverage:** §3 reuse-engine → Tasks unchanged engine; §4 brand adapter → Task 1; §5 data model → Task 2; §6 API changes → Task 3; §7 UI restructure (remove view #1, refactor panel #2, brand modal #3, relabel #4) → Tasks 4, 5, 6; §8 security (isPrivateHost, sanitize allowlist) → Tasks 2, 3; §9 testing → Tasks 1, 7. Out-of-scope items (§10: ONVIF discovery, PTZ, device-model merge, ADT cloud, live preview) intentionally absent.

**Placeholder scan:** The "adapt to the file's real handler" notes in Task 3 Step 2 (test route) and Task 5 Step 2 / Task 6 (match existing section + modal markup) are explicit "read the real file and match its pattern" instructions tied to concrete code, not vague hand-waving — acceptable and called out. No TODO/TBD left.

**Type consistency:** `Camera.brand/host/streamQuality` (Task 2) reused identically in `SanitizedCamera` (Task 2), config route push (Task 3), and the panel form (Tasks 5–6). `buildRtspUrl`/`BrandFields`/`BuiltStream` defined Task 1, consumed Tasks 3. UI `brand` union is `tapo|adt|generic` mapped to the wire union `tapo|onvif|generic` via `brandWire()` (Task 6) — the one intentional UI↔wire mapping, documented in spec §7.3.
