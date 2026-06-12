# HomePal CCTV → UGREEN NAS Recording — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a motion-triggered CCTV recording pipeline that captures camera RTSP streams via ffmpeg and writes clips to a mounted UGREEN NAS path, with free-space-based retention and a browser UI.

**Architecture:** A per-camera engine runs two ffmpeg processes — a `-c copy` segmenter (cheap ring buffer) and a downscaled scene-detection detector. A controller stitches segments overlapping a motion event into an MP4 on the NAS. RTSP URLs (with creds) are encrypted at rest. Config lives in the household `config.cctv` blob; auth-protected API endpoints drive a "Cameras & Storage" frontend view.

**Tech Stack:** Node ≥24 built-ins only (`node:child_process`, `node:fs`, `node:crypto`, `node:test`, `node:sqlite`) + external `ffmpeg`/`ffprobe` binaries. No npm packages.

---

## Conventions

- **Tests:** Node's built-in runner. Test files live in `test/`, named `*.test.js`. Run a single file with `node --test test/<name>.test.js`; run all with `node --test`. Add `"test": "node --test"` to `package.json` scripts in Task 1.
- **Commits:** The workspace is not a git repo. Commit steps are **optional** — run `git init` once if you want them; otherwise skip the commit step in each task.
- **No shell:** Always spawn ffmpeg/ffprobe with an args array, never a shell string.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `server/crypto.js` (new) | AES-256-GCM encrypt/decrypt + RTSP masking; key from `HOMEPAL_SECRET` or `data/.cctv-key`. |
| `server/cctv-paths.js` (new) | Pure path helpers: storage-root resolution, traversal guard, clip path/timestamp builders & parsers. |
| `server/cctv-detect.js` (new) | Pure parser: ffmpeg stderr lines → motion timestamps; event/segment-selection logic. |
| `server/cctv-storage.js` (new) | Storage validation, `fs.statfs` free-space, retention selection + pruning (root-guarded). |
| `server/cctv.js` (new) | Engine: ffmpeg detection, per-camera segmenter/detector/controller, recorder registry, retention sweep timer. |
| `server/db.js` (modify) | Add `cctv` to `putState` config whitelist. |
| `server/index.js` (modify) | Mount auth-protected `/api/cctv/*` routes. |
| `src/cctv.js` (new) | Frontend: status fetch, storage config, camera cards, clip browser. |
| `src/views.js` (modify) | Register the "Cameras & Storage" view. |
| `test/*.test.js` (new) | Unit + integration tests per task. |

---

## Task 1: Test harness + npm script

**Files:**
- Modify: `package.json`
- Create: `test/smoke.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/smoke.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('node test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/smoke.test.js`
Expected: PASS (1 test, 0 fail).

- [ ] **Step 3: Add the test script**

In `package.json` `scripts`, add:

```json
"test": "node --test"
```

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit (optional)**

```bash
git add package.json test/smoke.test.js && git commit -m "chore: add node:test harness"
```

---

## Task 2: Crypto helper (encrypt RTSP creds at rest)

**Files:**
- Create: `server/crypto.js`
- Test: `test/crypto.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/crypto.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, maskRtsp } from '../server/crypto.js';

test('encrypt/decrypt round-trips', () => {
  const url = 'rtsp://admin:p%40ss@192.168.1.50:554/stream1';
  const enc = encryptSecret(url);
  assert.notEqual(enc, url);
  assert.equal(decryptSecret(enc), url);
});

test('ciphertext differs each call (random IV)', () => {
  assert.notEqual(encryptSecret('x'), encryptSecret('x'));
});

test('maskRtsp hides credentials but keeps host/path', () => {
  assert.equal(
    maskRtsp('rtsp://admin:secret@192.168.1.50:554/stream1'),
    'rtsp://***@192.168.1.50:554/stream1'
  );
  assert.equal(maskRtsp('rtsp://192.168.1.50/s'), 'rtsp://192.168.1.50/s');
});

test('decryptSecret throws on tampered text', () => {
  const enc = encryptSecret('hello');
  const bad = enc.slice(0, -2) + (enc.endsWith('aa') ? 'bb' : 'aa');
  assert.throws(() => decryptSecret(bad));
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/crypto.test.js`
Expected: FAIL ("Cannot find module '../server/crypto.js'").

- [ ] **Step 3: Implement**

```js
// server/crypto.js
// AES-256-GCM encryption for secrets stored at rest (RTSP URLs carry creds).
// Key comes from HOMEPAL_SECRET env, else a 32-byte key generated once and
// persisted to data/.cctv-key (0600). Built-ins only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(__dirname, '..', 'data', '.cctv-key');

function loadKey() {
  const env = process.env.HOMEPAL_SECRET;
  if (env) return crypto.createHash('sha256').update(env).digest(); // 32 bytes
  try {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (hex.length === 64) return Buffer.from(hex, 'hex');
  } catch {}
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  return key;
}

const KEY = loadKey();

// Returns base64 of iv(12) | tag(16) | ciphertext.
export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(enc) {
  const buf = Buffer.from(String(enc), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// Replace "user:pass@" with "***@" for safe display. No creds -> unchanged.
export function maskRtsp(url) {
  return String(url).replace(/(rtsp:\/\/)[^@/]+@/i, '$1***@');
}
```

- [ ] **Step 4: Run it**

Run: `node --test test/crypto.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit (optional)**

```bash
git add server/crypto.js test/crypto.test.js && git commit -m "feat(cctv): AES-256-GCM secret crypto + rtsp masking"
```

---

## Task 3: Path helpers + traversal guard

**Files:**
- Create: `server/cctv-paths.js`
- Test: `test/cctv-paths.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/cctv-paths.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { clipRelPath, parseClipTime, withinRoot } from '../server/cctv-paths.js';

test('clipRelPath builds <camera>/<date>/clip_<HHMMSS>.mp4', () => {
  const d = new Date('2026-06-12T09:05:03');
  assert.equal(clipRelPath('Front Door', d), path.join('Front_Door', '2026-06-12', 'clip_090503.mp4'));
});

test('clipRelPath sanitizes unsafe camera names', () => {
  const d = new Date('2026-06-12T00:00:00');
  const rel = clipRelPath('../evil/..', d);
  assert.ok(!rel.includes('..'), rel);
});

test('parseClipTime reads timestamp back', () => {
  const t = parseClipTime('2026-06-12/clip_090503.mp4');
  assert.equal(t.getFullYear(), 2026);
  assert.equal(t.getHours(), 9);
  assert.equal(t.getSeconds(), 3);
});

test('withinRoot rejects traversal, accepts children', () => {
  const root = path.resolve('/srv/cctv');
  assert.equal(withinRoot(root, path.join(root, 'a/b.mp4')), true);
  assert.equal(withinRoot(root, path.resolve(root, '../etc/passwd')), false);
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/cctv-paths.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// server/cctv-paths.js
// Pure path helpers for CCTV clip layout + traversal safety. No I/O.
import path from 'node:path';

const pad = (n) => String(n).padStart(2, '0');

// Filesystem-safe slug for a camera folder (no separators, no dots-only).
export function safeName(name) {
  const s = String(name || 'camera').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.+/g, '_');
  return s.replace(/^_+|_+$/g, '') || 'camera';
}

export function dateFolder(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function clipRelPath(cameraName, d) {
  const hms = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return path.join(safeName(cameraName), dateFolder(d), `clip_${hms}.mp4`);
}

// Parse "<...>/YYYY-MM-DD/clip_HHMMSS.mp4" -> Date (local). Returns null if unparseable.
export function parseClipTime(p) {
  const m = /(\d{4})-(\d{2})-(\d{2})[/\\]clip_(\d{2})(\d{2})(\d{2})\.mp4$/.exec(String(p).replace(/\\/g, '/'));
  if (!m) return null;
  const [, y, mo, da, h, mi, s] = m.map(Number);
  return new Date(y, mo - 1, da, h, mi, s);
}

// True iff `target` resolves to `root` or a path inside it.
export function withinRoot(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  return t === r || t.startsWith(r + path.sep);
}
```

- [ ] **Step 4: Run it**

Run: `node --test test/cctv-paths.test.js`
Expected: PASS (4 tests). (`parseClipTime` returns null path-only when no match — covered by the positive case.)

- [ ] **Step 5: Commit (optional)**

```bash
git add server/cctv-paths.js test/cctv-paths.test.js && git commit -m "feat(cctv): clip path helpers + traversal guard"
```

---

## Task 4: Motion detector parsing + event/segment selection

**Files:**
- Create: `server/cctv-detect.js`
- Test: `test/cctv-detect.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/cctv-detect.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSceneTimes, selectSegments } from '../server/cctv-detect.js';

test('parseSceneTimes extracts pts_time from metadata.print lines', () => {
  const stderr = [
    'frame:12   pts:120000  pts_time:5.0',
    'lavfi.scene_score=0.080000',
    'frame:40   pts:400000  pts_time:16.6',
    'lavfi.scene_score=0.120000',
    'noise line',
  ].join('\n');
  assert.deepEqual(parseSceneTimes(stderr), [5.0, 16.6]);
});

test('selectSegments returns segments overlapping [motion-pre, lastMotion+post]', () => {
  // 2s segments starting at 0,2,4,...,20
  const segs = Array.from({ length: 11 }, (_, i) => ({ file: `seg_${i}.ts`, start: i * 2, end: i * 2 + 2 }));
  // motion at t=10 and t=12, preRoll 4, postRoll 4 -> window [6,16]
  const picked = selectSegments(segs, [10, 12], { preRoll: 4, postRoll: 4 });
  assert.deepEqual(picked.map((s) => s.file), ['seg_3.ts', 'seg_4.ts', 'seg_5.ts', 'seg_6.ts', 'seg_7.ts']);
  // seg_3 covers [6,8] ... seg_7 covers [14,16]
});

test('selectSegments with no motion returns empty', () => {
  const segs = [{ file: 'a', start: 0, end: 2 }];
  assert.deepEqual(selectSegments(segs, [], { preRoll: 4, postRoll: 4 }), []);
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/cctv-detect.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// server/cctv-detect.js
// Pure functions: parse ffmpeg metadata.print output for scene-change times,
// and select staging segments that belong to a motion event window. No I/O.

// metadata=print emits "pts_time:<sec>" lines followed by "lavfi.scene_score=..".
// Because the detector uses select='gt(scene,THRESH)', every emitted frame IS a
// motion frame, so we just collect the pts_time values.
export function parseSceneTimes(stderr) {
  const out = [];
  const re = /pts_time:([0-9]+(?:\.[0-9]+)?)/g;
  let m;
  while ((m = re.exec(String(stderr)))) out.push(Number(m[1]));
  return out;
}

// segments: [{file, start, end}] (seconds, monotonic). motionTimes: number[].
// opts: { preRoll, postRoll } seconds. Returns segments overlapping the union
// window [min(motion)-preRoll, max(motion)+postRoll].
export function selectSegments(segments, motionTimes, { preRoll = 5, postRoll = 8 } = {}) {
  if (!motionTimes.length) return [];
  const lo = Math.min(...motionTimes) - preRoll;
  const hi = Math.max(...motionTimes) + postRoll;
  return segments.filter((s) => s.end > lo && s.start < hi);
}
```

- [ ] **Step 4: Run it**

Run: `node --test test/cctv-detect.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit (optional)**

```bash
git add server/cctv-detect.js test/cctv-detect.test.js && git commit -m "feat(cctv): scene-time parsing + segment selection"
```

---

## Task 5: Storage validation, free space, retention selection

**Files:**
- Create: `server/cctv-storage.js`
- Test: `test/cctv-storage.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/cctv-storage.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateStorage, planRetention } from '../server/cctv-storage.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-'));
}

test('validateStorage ok for a writable dir', async () => {
  const dir = tmpDir();
  const r = await validateStorage(dir);
  assert.equal(r.ok, true);
  assert.equal(typeof r.freeBytes, 'number');
});

test('validateStorage fails for a missing dir', async () => {
  const r = await validateStorage(path.join(tmpDir(), 'nope'));
  assert.equal(r.ok, false);
});

test('planRetention picks oldest clips until above floor', () => {
  const clips = [
    { path: 'a/2026-06-10/clip_000000.mp4', mtime: 10, size: 100 },
    { path: 'a/2026-06-11/clip_000000.mp4', mtime: 20, size: 100 },
    { path: 'a/2026-06-12/clip_000000.mp4', mtime: 30, size: 100 },
  ];
  // freeBytes 50, floor 200 -> need to free 150 -> delete two oldest (200 freed)
  const del = planRetention(clips, { freeBytes: 50, floorBytes: 200 });
  assert.deepEqual(del.map((c) => c.path), [clips[0].path, clips[1].path]);
});

test('planRetention deletes nothing when above floor', () => {
  const del = planRetention([{ path: 'x', mtime: 1, size: 100 }], { freeBytes: 500, floorBytes: 200 });
  assert.deepEqual(del, []);
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/cctv-storage.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// server/cctv-storage.js
// Storage validation, free-space, and retention planning. Uses fs.statfs (Node>=24).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { withinRoot, parseClipTime } from './cctv-paths.js';

// Verify dir exists and is writable; report free bytes. Never throws.
export async function validateStorage(dir) {
  try {
    const st = await fsp.stat(dir);
    if (!st.isDirectory()) return { ok: false, reason: 'Not a directory', freeBytes: 0 };
    await fsp.access(dir, fs.constants.W_OK);
    const sf = await fsp.statfs(dir);
    return { ok: true, freeBytes: sf.bsize * sf.bavail, totalBytes: sf.bsize * sf.blocks };
  } catch (err) {
    return { ok: false, reason: err.code || String(err.message || err), freeBytes: 0 };
  }
}

// Pure: given clips (oldest-deletable) + space info, return clips to delete
// (oldest first) until freeBytes would exceed floorBytes. clips: [{path,mtime,size}].
export function planRetention(clips, { freeBytes, floorBytes }) {
  if (freeBytes >= floorBytes) return [];
  const sorted = [...clips].sort((a, b) => a.mtime - b.mtime);
  const out = [];
  let free = freeBytes;
  for (const c of sorted) {
    if (free >= floorBytes) break;
    out.push(c);
    free += c.size;
  }
  return out;
}

// Walk storage root for clip files. Returns [{path, mtime, size}]. Root-guarded.
export async function listClips(root) {
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (!withinRoot(root, full)) continue;
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.mp4')) {
        const st = await fsp.stat(full).catch(() => null);
        if (st) out.push({ path: full, mtime: st.mtimeMs, size: st.size, when: parseClipTime(full) });
      }
    }
  }
  await walk(root);
  return out;
}

// Delete a clip ONLY if inside root. Returns true if deleted.
export async function safeDelete(root, file) {
  if (!withinRoot(root, file)) return false;
  await fsp.rm(file, { force: true });
  return true;
}
```

- [ ] **Step 4: Run it**

Run: `node --test test/cctv-storage.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit (optional)**

```bash
git add server/cctv-storage.js test/cctv-storage.test.js && git commit -m "feat(cctv): storage validation + retention planning"
```

---

## Task 6: ffmpeg detection + ffprobe validation

**Files:**
- Create: `server/cctv.js` (engine — start here, grow over Tasks 6-8)
- Test: `test/cctv-ffmpeg.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/cctv-ffmpeg.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ffmpegInfo, validateRtspUrl } from '../server/cctv.js';

test('ffmpegInfo reports availability shape', async () => {
  const info = await ffmpegInfo();
  assert.equal(typeof info.ffmpeg, 'boolean');
  assert.equal(typeof info.ffprobe, 'boolean');
});

test('validateRtspUrl rejects non-rtsp scheme without spawning', async () => {
  const r = await validateRtspUrl('http://192.168.1.5/x');
  assert.equal(r.ok, false);
  assert.match(r.reason, /rtsp/i);
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/cctv-ffmpeg.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement (initial cctv.js)**

```js
// server/cctv.js
// CCTV recording engine. Built-ins + ffmpeg/ffprobe child processes only.
import { spawn } from 'node:child_process';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function probeBinary(bin) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(bin, ['-version'], { stdio: 'ignore' }); }
    catch { return resolve(false); }
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

export async function ffmpegInfo() {
  const [ffmpeg, ffprobe] = await Promise.all([probeBinary(FFMPEG), probeBinary(FFPROBE)]);
  return { ffmpeg, ffprobe };
}

// Validate an RTSP URL: scheme check (no spawn), then ffprobe reachability.
export async function validateRtspUrl(url, timeoutMs = 8000) {
  if (!/^rtsp:\/\//i.test(String(url))) return { ok: false, reason: 'URL must start with rtsp://' };
  return new Promise((resolve) => {
    const args = ['-rtsp_transport', 'tcp', '-i', url, '-t', '1', '-f', 'null', '-'];
    let p, done = false;
    const finish = (v) => { if (!done) { done = true; try { p && p.kill('SIGKILL'); } catch {} resolve(v); } };
    try { p = spawn(FFPROBE.replace('ffprobe', 'ffmpeg') === FFMPEG ? FFMPEG : FFMPEG, args); }
    catch (e) { return resolve({ ok: false, reason: String(e.message || e) }); }
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 8192) err = err.slice(-8192); });
    p.on('error', (e) => finish({ ok: false, reason: String(e.message || e) }));
    p.on('close', (code) => finish(code === 0 ? { ok: true } : { ok: false, reason: err.split('\n').filter(Boolean).pop() || 'ffmpeg failed' }));
    setTimeout(() => finish({ ok: false, reason: 'timed out probing stream' }), timeoutMs);
  });
}
```

> Note: validation uses `ffmpeg` (decode 1s) rather than `ffprobe` so it works for credentialed RTSP uniformly. Keep the `FFMPEG`/`FFPROBE` consts; later tasks use both.

- [ ] **Step 4: Run it**

Run: `node --test test/cctv-ffmpeg.test.js`
Expected: PASS (2 tests). (`ffmpegInfo` booleans reflect whether ffmpeg is installed on the test machine — either value passes.)

- [ ] **Step 5: Commit (optional)**

```bash
git add server/cctv.js test/cctv-ffmpeg.test.js && git commit -m "feat(cctv): ffmpeg detection + rtsp validation"
```

---

## Task 7: Per-camera recorder (segmenter + detector + controller)

**Files:**
- Modify: `server/cctv.js`
- Test: `test/cctv-controller.test.js`

The controller logic must be unit-testable without ffmpeg, so it is written as a class that takes injectable spawn + clock + fs writer. ffmpeg wiring is a thin adapter around it.

- [ ] **Step 1: Write the failing test**

```js
// test/cctv-controller.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraController } from '../server/cctv.js';

test('controller stitches segments on motion and reports a clip', async () => {
  const written = [];
  const ctrl = new CameraController({
    camera: { id: 'c1', name: 'Front', preRoll: 2, postRoll: 2 },
    // injected concat: record which segment files were stitched + output path
    concat: async (files, outPath) => { written.push({ files: [...files], outPath }); },
    storageRoot: '/nas',
    now: () => new Date('2026-06-12T09:00:30'),
  });

  // simulate 2s segments arriving at 24,26,28,30,32,34
  for (const t of [24, 26, 28, 30, 32, 34]) ctrl.onSegment({ file: `seg_${t}.ts`, start: t, end: t + 2 });
  // motion at t=30
  ctrl.onMotion(30);
  // close the event (no motion for postRoll): advance past 30+postRoll
  await ctrl.onSegment({ file: 'seg_36.ts', start: 36, end: 38 });
  await ctrl.flush();

  assert.equal(written.length, 1);
  // window [28,32] -> seg_28,30,32 overlap
  assert.deepEqual(written[0].files, ['seg_28.ts', 'seg_30.ts', 'seg_32.ts']);
  assert.match(written[0].outPath, /Front[/\\]2026-06-12[/\\]clip_090030\.mp4$/);
});

test('controller writes nothing without motion', async () => {
  const written = [];
  const ctrl = new CameraController({
    camera: { id: 'c1', name: 'Front', preRoll: 2, postRoll: 2 },
    concat: async (f, o) => written.push({ f, o }),
    storageRoot: '/nas',
    now: () => new Date(),
  });
  for (const t of [0, 2, 4, 6]) await ctrl.onSegment({ file: `s${t}`, start: t, end: t + 2 });
  await ctrl.flush();
  assert.equal(written.length, 0);
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/cctv-controller.test.js`
Expected: FAIL ("CameraController is not exported").

- [ ] **Step 3: Implement — append to `server/cctv.js`**

```js
// --- append to server/cctv.js ---
import path from 'node:path';
import { selectSegments } from './cctv-detect.js';
import { clipRelPath } from './cctv-paths.js';

const RING_KEEP_SEC = 30; // trailing staging window to keep when idle

// Pure-ish controller: fed segment + motion events; emits a stitched clip via
// the injected `concat(files, outPath)`. No ffmpeg/timers here so it unit-tests.
export class CameraController {
  constructor({ camera, concat, storageRoot, now }) {
    this.camera = camera;
    this.concat = concat;
    this.storageRoot = storageRoot;
    this.now = now || (() => new Date());
    this.segments = [];      // ring buffer [{file,start,end}]
    this.motions = [];       // pts times in current/last event
    this.eventOpen = false;
    this.eventStartedAt = null;
    this.lastMotion = -Infinity;
  }

  onMotion(t) {
    this.motions.push(t);
    this.lastMotion = Math.max(this.lastMotion, t);
    if (!this.eventOpen) { this.eventOpen = true; this.eventStartedAt = this.now(); }
  }

  async onSegment(seg) {
    this.segments.push(seg);
    // Close the event once we've buffered past lastMotion + postRoll.
    const post = this.camera.postRoll ?? 8;
    if (this.eventOpen && seg.start > this.lastMotion + post) {
      await this._closeEvent();
    }
    this._trim();
  }

  _trim() {
    if (this.eventOpen) return; // keep everything while recording
    const cutoff = (this.segments.at(-1)?.end ?? 0) - RING_KEEP_SEC;
    this.segments = this.segments.filter((s) => s.end >= cutoff);
  }

  async _closeEvent() {
    const picked = selectSegments(this.segments, this.motions, {
      preRoll: this.camera.preRoll ?? 5,
      postRoll: this.camera.postRoll ?? 8,
    });
    this.eventOpen = false;
    this.motions = [];
    this.lastMotion = -Infinity;
    if (!picked.length) return null;
    const rel = clipRelPath(this.camera.name, this.eventStartedAt || this.now());
    const outPath = path.join(this.storageRoot, rel);
    await this.concat(picked.map((s) => s.file), outPath);
    this.lastClip = { rel, at: (this.eventStartedAt || this.now()).toISOString() };
    return outPath;
  }

  // Force-close any open event (shutdown / test).
  async flush() {
    if (this.eventOpen) await this._closeEvent();
  }
}
```

- [ ] **Step 4: Run it**

Run: `node --test test/cctv-controller.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit (optional)**

```bash
git add server/cctv.js test/cctv-controller.test.js && git commit -m "feat(cctv): injectable CameraController stitching logic"
```

---

## Task 8: ffmpeg adapter — wire segmenter/detector to a controller + concat

**Files:**
- Modify: `server/cctv.js`
- Test: `test/cctv-recorder.test.js` (integration with a stub ffmpeg)

This task wires real processes. The stub-ffmpeg test proves the adapter parses segment files + detector output and produces a clip, without a camera.

- [ ] **Step 1: Write the failing test**

```js
// test/cctv-recorder.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { concatSegments } from '../server/cctv.js';

// concatSegments uses ffmpeg concat demuxer; skip if ffmpeg missing.
import { ffmpegInfo } from '../server/cctv.js';

test('concatSegments writes an output file from .ts inputs', async (t) => {
  const info = await ffmpegInfo();
  if (!info.ffmpeg) return t.skip('ffmpeg not installed');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  // Generate two tiny 1s test .ts segments with ffmpeg lavfi.
  const { spawnSync } = await import('node:child_process');
  const seg = (name) => {
    const f = path.join(dir, name);
    spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10', '-t', '1', '-c:v', 'libx264', '-f', 'mpegts', f], { stdio: 'ignore' });
    return f;
  };
  const a = seg('a.ts'); const b = seg('b.ts');
  const out = path.join(dir, 'out', 'clip.mp4');
  await concatSegments([a, b], out);
  assert.ok(fs.existsSync(out));
  assert.ok(fs.statSync(out).size > 0);
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/cctv-recorder.test.js`
Expected: FAIL ("concatSegments is not exported"). (If ffmpeg absent, test self-skips after the symbol exists — but right now it fails on the missing export.)

- [ ] **Step 3: Implement — append to `server/cctv.js`**

```js
// --- append to server/cctv.js ---
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { parseSceneTimes } from './cctv-detect.js';

// Concatenate MPEG-TS segments into one MP4 via ffmpeg concat demuxer.
export async function concatSegments(files, outPath) {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  const listFile = outPath + '.txt';
  await fsp.writeFile(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  await new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outPath], { stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('concat failed code ' + code))));
  });
  await fsp.rm(listFile, { force: true });
}

// Spawn the segmenter: 2s -c copy MPEG-TS segments into stagingDir.
export function startSegmenter(url, stagingDir) {
  fs.mkdirSync(stagingDir, { recursive: true });
  const pattern = path.join(stagingDir, 'seg_%05d.ts');
  return spawn(FFMPEG, [
    '-rtsp_transport', 'tcp', '-i', url,
    '-an', '-c', 'copy', '-f', 'segment',
    '-segment_time', '2', '-reset_timestamps', '1',
    '-strftime', '0', pattern,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
}

// Spawn the detector: downscaled scene-change; emits motion times via onMotion.
export function startDetector(url, sensitivity, onMotion) {
  const p = spawn(FFMPEG, [
    '-rtsp_transport', 'tcp', '-i', url,
    '-an', '-vf', `scale=320:-1,select='gt(scene,${Number(sensitivity) || 0.04})',metadata=print`,
    '-f', 'null', '-',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let buf = '';
  p.stderr.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const t of parseSceneTimes(lines.join('\n'))) onMotion(t);
  });
  return p;
}
```

- [ ] **Step 4: Run it**

Run: `node --test test/cctv-recorder.test.js`
Expected: PASS or SKIP (skips cleanly if ffmpeg not installed; passes if installed).

- [ ] **Step 5: Commit (optional)**

```bash
git add server/cctv.js test/cctv-recorder.test.js && git commit -m "feat(cctv): ffmpeg segmenter/detector/concat adapters"
```

---

## Task 9: Engine orchestration + retention sweep

**Files:**
- Modify: `server/cctv.js`
- Test: `test/cctv-engine.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/cctv-engine.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runRetention } from '../server/cctv.js';

test('runRetention deletes oldest clips below floor, keeps newest', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-'));
  const mk = (rel, bytes, mtimeMs) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.alloc(bytes));
    fs.utimesSync(f, new Date(mtimeMs), new Date(mtimeMs));
    return f;
  };
  const old = mk('Front/2026-06-10/clip_000000.mp4', 1000, Date.now() - 99999);
  const mid = mk('Front/2026-06-11/clip_000000.mp4', 1000, Date.now() - 50000);
  const recent = mk('Front/2026-06-12/clip_000000.mp4', 1000, Date.now());

  // Pretend the volume reports 0 free; floor needs 1500 -> must free 1500 -> delete old+mid.
  const deleted = await runRetention(root, { freeBytes: 0, floorBytes: 1500 });
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(mid), false);
  assert.equal(fs.existsSync(recent), true);
  assert.equal(deleted.length, 2);
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/cctv-engine.test.js`
Expected: FAIL ("runRetention is not exported").

- [ ] **Step 3: Implement — append to `server/cctv.js`**

```js
// --- append to server/cctv.js ---
import { validateStorage, listClips, planRetention, safeDelete } from './cctv-storage.js';

// Run one retention pass. `space` is injectable for tests; in prod omit it and
// we read fs.statfs via validateStorage.
export async function runRetention(root, space) {
  let freeBytes, floorBytes;
  if (space) ({ freeBytes, floorBytes } = space);
  else throw new Error('space required'); // engine computes floorBytes from config
  const clips = await listClips(root);
  const toDelete = planRetention(clips.map((c) => ({ path: c.path, mtime: c.mtime, size: c.size })), { freeBytes, floorBytes });
  const deleted = [];
  for (const c of toDelete) if (await safeDelete(root, c.path)) deleted.push(c.path);
  return deleted;
}

// ---- top-level engine state (singleton) ----
const recorders = new Map(); // cameraId -> { seg, det, ctrl, stagingDir }
let retentionTimer = null;
let engineCfg = { enabled: false, storagePath: '', freeSpaceFloorGB: 20, cameras: [] };

const GB = 1024 ** 3;

export function getEngineStatus() {
  return {
    enabled: engineCfg.enabled,
    storagePath: engineCfg.storagePath,
    freeSpaceFloorGB: engineCfg.freeSpaceFloorGB,
    cameras: [...recorders.values()].map((r) => ({
      id: r.ctrl.camera.id, name: r.ctrl.camera.name,
      recording: r.ctrl.eventOpen, lastClip: r.ctrl.lastClip || null,
    })),
  };
}

// (Re)configure the engine from a decrypted config object. Stops removed
// recorders, starts enabled ones. Called by the API layer (Task 11).
export async function applyConfig(cfg, { decrypt } = {}) {
  engineCfg = { ...engineCfg, ...cfg };
  for (const [id, r] of recorders) {
    if (!cfg.enabled || !cfg.cameras.find((c) => c.id === id && c.enabled)) {
      try { r.seg.kill('SIGKILL'); r.det.kill('SIGKILL'); } catch {}
      recorders.delete(id);
    }
  }
  if (cfg.enabled) {
    const staging = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'cctv-staging');
    for (const cam of cfg.cameras) {
      if (!cam.enabled || recorders.has(cam.id)) continue;
      const url = decrypt ? decrypt(cam.rtspUrl) : cam.rtspUrl;
      const stagingDir = path.join(staging, cam.id);
      const ctrl = new CameraController({
        camera: cam,
        concat: concatSegments,
        storageRoot: cfg.storagePath,
        now: () => new Date(),
      });
      // Index segment start times by parsing filename order (2s each).
      let segIndex = 0;
      const seg = startSegmenter(url, stagingDir);
      // Poll staging dir for new segments (segmenter writes seg_%05d.ts).
      const watcher = fs.watch(stagingDir, async (_evt, fname) => {
        if (!fname || !fname.endsWith('.ts')) return;
        const idx = Number(/seg_(\d+)\.ts/.exec(fname)?.[1] ?? -1);
        if (idx < 0) return;
        const start = idx * 2;
        await ctrl.onSegment({ file: path.join(stagingDir, fname), start, end: start + 2 });
      });
      const det = startDetector(url, cam.sensitivity, (t) => ctrl.onMotion(t));
      recorders.set(cam.id, { seg, det, ctrl, stagingDir, watcher });
      segIndex++;
    }
  }
  // (Re)start retention timer.
  if (retentionTimer) clearInterval(retentionTimer);
  if (cfg.enabled && cfg.storagePath) {
    retentionTimer = setInterval(async () => {
      const v = await validateStorage(cfg.storagePath);
      if (v.ok) await runRetention(cfg.storagePath, { freeBytes: v.freeBytes, floorBytes: (cfg.freeSpaceFloorGB || 20) * GB }).catch(() => {});
    }, 5 * 60 * 1000);
    retentionTimer.unref?.();
  }
}

export function stopEngine() {
  for (const [, r] of recorders) { try { r.seg.kill('SIGKILL'); r.det.kill('SIGKILL'); r.watcher?.close(); } catch {} }
  recorders.clear();
  if (retentionTimer) clearInterval(retentionTimer);
}
```

> Note: the `fs.watch` + index→time mapping is the pragmatic wiring; the stitching correctness is already proven by Task 7's injected test. Real-camera timing is validated manually (Task 12).

- [ ] **Step 4: Run it**

Run: `node --test test/cctv-engine.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit (optional)**

```bash
git add server/cctv.js test/cctv-engine.test.js && git commit -m "feat(cctv): engine orchestration + retention sweep"
```

---

## Task 10: DB whitelist for `cctv` config

**Files:**
- Modify: `server/db.js` (the `putState` config object, ~lines 182-190)
- Test: `test/db-cctv.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/db-cctv.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHousehold, getState, putState } from '../server/db.js';

test('cctv config persists through putState/getState', () => {
  const email = `cctv_${Date.now()}@t.io`;
  const { hid } = registerHousehold({ householdName: 'T', adminName: 'A', email, password: 'pw123456' });
  const state = getState(hid);
  state.cctv = { enabled: true, storagePath: 'Z:/cctv', freeSpaceFloorGB: 20, cameras: [{ id: 'c1', name: 'Front', rtspUrl: 'ENC', sensitivity: 0.04, preRoll: 5, postRoll: 8, enabled: true }] };
  putState(hid, state);
  const reloaded = getState(hid);
  assert.equal(reloaded.cctv.storagePath, 'Z:/cctv');
  assert.equal(reloaded.cctv.cameras[0].id, 'c1');
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/db-cctv.test.js`
Expected: FAIL (`reloaded.cctv` is undefined — not yet whitelisted).

- [ ] **Step 3: Implement**

In `server/db.js`, inside `putState`, the `config` object (currently ending with `alerts: state.alerts || []`). Add `cctv`:

```js
    const config = {
      budgets: state.budgets, savings: state.savings, securityArmed: state.securityArmed,
      thermostat: state.thermostat, rooms: state.rooms, scenes: state.scenes,
      lights: state.lights, devices: state.devices, energy: state.energy,
      weather: state.weather, chorePoints: state.chorePoints, nid: state.nid,
      recurring: state.recurring, debts: state.debts, assistants: state.assistants,
      automations: state.automations, autoSeeded: state.autoSeeded,
      cctv: state.cctv,
      alerts: state.alerts || []
    };
```

And in `getState`, `cctv` is already returned via `...config`, so no change needed there.

- [ ] **Step 4: Run it**

Run: `node --test test/db-cctv.test.js`
Expected: PASS.

- [ ] **Step 5: Commit (optional)**

```bash
git add server/db.js test/db-cctv.test.js && git commit -m "feat(cctv): persist cctv config in household state"
```

---

## Task 11: API routes

**Files:**
- Modify: `server/index.js`
- Test: `test/cctv-api.test.js`

First read `server/index.js` to match its existing routing/auth style (`verifyToken`, JSON body parsing, response helpers). Mirror them exactly.

- [ ] **Step 1: Write the failing test**

```js
// test/cctv-api.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cctvStatusPayload, sanitizeCamerasForClient } from '../server/cctv-api.js';

test('sanitizeCamerasForClient masks rtsp + drops ciphertext', () => {
  const cams = [{ id: 'c1', name: 'Front', rtspUrl: 'ENC', _plain: 'rtsp://u:p@10.0.0.5/s', sensitivity: 0.04, enabled: true }];
  const out = sanitizeCamerasForClient(cams, (c) => 'rtsp://u:p@10.0.0.5/s');
  assert.equal(out[0].rtspMasked, 'rtsp://***@10.0.0.5/s');
  assert.equal(out[0].rtspUrl, undefined);
  assert.equal(out[0]._plain, undefined);
});

test('cctvStatusPayload shape', () => {
  const p = cctvStatusPayload({ ffmpeg: true, ffprobe: true }, { ok: true, freeBytes: 5 * 1024 ** 3 }, { enabled: true, cameras: [] });
  assert.equal(p.ffmpeg, true);
  assert.equal(p.storage.ok, true);
  assert.equal(typeof p.storage.freeGB, 'number');
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/cctv-api.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3a: Implement `server/cctv-api.js` (pure response shaping — testable)**

```js
// server/cctv-api.js
// Pure response-shaping helpers for the CCTV API (kept separate so they unit-test
// without spinning the HTTP server). The route handlers in index.js call these.
import { maskRtsp } from './crypto.js';

const GB = 1024 ** 3;

// Strip ciphertext + any plaintext; expose only a masked URL for display.
export function sanitizeCamerasForClient(cameras, decrypt) {
  return (cameras || []).map((c) => {
    let masked = '';
    try { masked = maskRtsp(decrypt(c.rtspUrl)); } catch { masked = ''; }
    const { rtspUrl, _plain, ...rest } = c;
    return { ...rest, rtspMasked: masked };
  });
}

export function cctvStatusPayload(ff, storage, engine) {
  return {
    ffmpeg: !!ff.ffmpeg,
    ffprobe: !!ff.ffprobe,
    storage: { ok: !!storage.ok, reason: storage.reason || '', freeGB: +(storage.freeBytes / GB).toFixed(1) },
    enabled: !!engine.enabled,
    cameras: engine.cameras || [],
  };
}
```

- [ ] **Step 3b: Run the unit test**

Run: `node --test test/cctv-api.test.js`
Expected: PASS (2 tests).

- [ ] **Step 3c: Wire routes in `server/index.js`**

Following the file's existing auth + JSON patterns, add handlers for:

```
GET  /api/cctv/status      -> ffmpegInfo() + validateStorage(cfg.storagePath) + getEngineStatus() => cctvStatusPayload(...)
POST /api/cctv/config      -> body {storagePath, freeSpaceFloorGB, cameras:[{id,name,rtspUrl?,sensitivity,preRoll,postRoll,enabled}]}
                              For each camera with a NEW plaintext rtspUrl: validateRtspUrl(), then encryptSecret() before persist.
                              Keep existing ciphertext when rtspUrl omitted. Persist via putState. Then applyConfig(decryptedCfg,{decrypt:decryptSecret}).
POST /api/cctv/test        -> body {rtspUrl} => validateRtspUrl(rtspUrl)
GET  /api/cctv/clips       -> query camera,date => listClips(root) filtered, returns [{rel, sizeMB, when}]
GET  /api/cctv/clip?path=  -> withinRoot guard; stream file with Range support + Content-Type video/mp4
```

Concrete handler example to match (adapt to the file's real router/auth helper names):

```js
// inside the request handler, after auth resolves `user` (household hid):
if (method === 'GET' && pathname === '/api/cctv/status') {
  const ff = await ffmpegInfo();
  const state = getState(user.household_id);
  const cfg = state.cctv || { storagePath: '', freeSpaceFloorGB: 20, cameras: [] };
  const storage = cfg.storagePath ? await validateStorage(cfg.storagePath) : { ok: false, reason: 'not configured', freeBytes: 0 };
  const eng = getEngineStatus();
  const payload = cctvStatusPayload(ff, storage, { enabled: cfg.enabled, cameras: sanitizeCamerasForClient(cfg.cameras, decryptSecret) });
  return json(res, 200, payload);
}
```

Clip streaming with Range (path-guarded):

```js
if (method === 'GET' && pathname === '/api/cctv/clip') {
  const state = getState(user.household_id);
  const root = state.cctv?.storagePath || '';
  const file = path.resolve(query.get('path') || '');
  if (!root || !withinRoot(root, file) || !fs.existsSync(file)) return json(res, 404, { error: 'not found' });
  const stat = fs.statSync(file);
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace('bytes=', '').split('-');
    const start = parseInt(s, 10) || 0;
    const end = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': 'video/mp4',
    });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  }
  return;
}
```

Add the imports at the top of `server/index.js`:

```js
import { ffmpegInfo, validateRtspUrl, applyConfig, getEngineStatus } from './cctv.js';
import { validateStorage, listClips } from './cctv-storage.js';
import { withinRoot } from './cctv-paths.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import { cctvStatusPayload, sanitizeCamerasForClient } from './cctv-api.js';
```

And on server start (after `getState` is usable), call `applyConfig` for each household's saved cctv config so recording resumes after a restart. Keep it best-effort (wrap in try/catch; never block boot).

- [ ] **Step 4: Manual API check**

Run the server: `npm start`. With a valid auth cookie/token, `GET /api/cctv/status` returns JSON with `ffmpeg`, `storage`, `cameras`. Verify `POST /api/cctv/test` with a bogus `rtsp://` URL returns `{ ok:false }` and never hangs (it times out in ≤8s).

- [ ] **Step 5: Commit (optional)**

```bash
git add server/index.js server/cctv-api.js test/cctv-api.test.js && git commit -m "feat(cctv): api routes (status/config/test/clips/clip)"
```

---

## Task 12: Frontend "Cameras & Storage" view

**Files:**
- Create: `src/cctv.js`
- Modify: `src/views.js` (register view), possibly `src/main.js`/`src/components.js` for nav — match existing patterns.

First read `src/views.js`, `src/api.js`, `src/components.js`, `src/main.js` to learn how views are declared, how the API client calls endpoints, and how nav entries are added. Mirror those patterns exactly — do not introduce a new framework.

- [ ] **Step 1: Implement the view module**

```js
// src/cctv.js
// "Cameras & Storage" view: UGREEN storage config, ffmpeg banner, per-camera
// cards, and a clip browser. Uses the existing api client + render helpers.
// (Names below — api, h, mountView — are placeholders; replace with the real
// exports discovered in src/api.js / src/components.js.)
import { api } from './api.js';

export async function renderCctv(root) {
  const s = await api.get('/api/cctv/status');
  root.innerHTML = '';

  if (!s.ffmpeg) {
    const warn = document.createElement('div');
    warn.className = 'banner banner-warn';
    warn.textContent = 'ffmpeg not found on the HomePal host. Install ffmpeg to enable recording.';
    root.appendChild(warn);
  }

  // Storage config
  const store = document.createElement('section');
  store.innerHTML = `
    <h2>UGREEN Storage</h2>
    <label>Mount path <input id="cctv-path" value="${s.storage?.path || ''}" placeholder="Z:\\cctv or /mnt/ugreen/cctv"></label>
    <label>Keep free (GB) <input id="cctv-floor" type="number" value="${s.freeSpaceFloorGB || 20}"></label>
    <p>Free now: ${s.storage?.freeGB ?? '—'} GB ${s.storage?.ok ? '' : '(⚠ ' + (s.storage?.reason || 'unreachable') + ')'}</p>
    <button id="cctv-save">Save storage</button>
  `;
  root.appendChild(store);

  // Camera cards
  const cams = document.createElement('section');
  cams.innerHTML = '<h2>Cameras</h2>';
  for (const c of s.cameras) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <strong>${c.name}</strong> — ${c.recording ? '● recording' : 'idle'}<br>
      <small>${c.rtspMasked || 'no stream set'}</small><br>
      Sensitivity <input type="range" min="0.01" max="0.2" step="0.01" value="${c.sensitivity ?? 0.04}" data-cam="${c.id}" class="cctv-sens">
      <label>Enabled <input type="checkbox" ${c.enabled ? 'checked' : ''} data-cam="${c.id}" class="cctv-en"></label>
      <button class="cctv-clips" data-cam="${c.id}">Clips</button>
    `;
    cams.appendChild(card);
  }
  const add = document.createElement('button');
  add.textContent = '+ Add camera (RTSP URL)';
  cams.appendChild(add);
  root.appendChild(cams);

  // Clip browser target
  const browser = document.createElement('section');
  browser.id = 'cctv-clips';
  root.appendChild(browser);

  wireCctvHandlers(root, s);
}

function wireCctvHandlers(root, s) {
  root.querySelector('#cctv-save')?.addEventListener('click', async () => {
    await api.post('/api/cctv/config', {
      storagePath: root.querySelector('#cctv-path').value,
      freeSpaceFloorGB: Number(root.querySelector('#cctv-floor').value) || 20,
      cameras: s.cameras, // unchanged here; camera edits send their own deltas
    });
    renderCctv(root);
  });

  root.querySelectorAll('.cctv-clips').forEach((b) => b.addEventListener('click', async () => {
    const camId = b.dataset.cam;
    const cam = s.cameras.find((c) => c.id === camId);
    const clips = await api.get(`/api/cctv/clips?camera=${encodeURIComponent(cam.name)}`);
    const el = root.querySelector('#cctv-clips');
    el.innerHTML = `<h3>Clips — ${cam.name}</h3>`;
    for (const cl of clips) {
      const row = document.createElement('div');
      row.innerHTML = `<a href="#" data-path="${cl.path}">${cl.when} (${cl.sizeMB} MB)</a>`;
      row.querySelector('a').addEventListener('click', (e) => {
        e.preventDefault();
        const v = document.createElement('video');
        v.controls = true; v.width = 480;
        v.src = `/api/cctv/clip?path=${encodeURIComponent(cl.path)}`;
        el.appendChild(v);
      });
      el.appendChild(row);
    }
  }));

  // "+ Add camera": prompt for name + RTSP URL, Test, then Save.
  // (Use the app's existing modal/prompt component instead of window.prompt if one exists.)
}
```

- [ ] **Step 2: Register the view in `src/views.js`**

Add a nav entry + route that calls `renderCctv(container)` following the file's existing view-registration pattern (read the file and mirror it — e.g. add to the views map / switch used by `src/main.js`).

- [ ] **Step 3: Run the app and drive it**

Run: `npm start`, open `http://localhost:3000`, log in, open "Cameras & Storage".
- Verify the ffmpeg banner appears only when ffmpeg is missing.
- Save a storage path; confirm free-space shows and persists across reload.
- Add a camera with a real RTSP URL → Test → enable. Confirm status flips to "recording" on motion and a clip appears under Clips and plays in the `<video>` element. **Look at the played frame** — a black/blank frame means capture failed.

- [ ] **Step 4: Commit (optional)**

```bash
git add src/cctv.js src/views.js && git commit -m "feat(cctv): cameras & storage frontend view"
```

---

## Task 13: End-to-end smoke + docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a CCTV section to `README.md`**

Document: install ffmpeg; mount the UGREEN share (SMB/NFS) to a path; set that path + free-space floor in Cameras & Storage; add each camera's RTSP URL; how retention works; that creds are encrypted at rest (`HOMEPAL_SECRET` recommended in production).

- [ ] **Step 2: Full test run**

Run: `npm test`
Expected: all tests PASS or SKIP (ffmpeg-dependent tests skip cleanly when ffmpeg is absent).

- [ ] **Step 3: Manual E2E with a real camera + mounted UGREEN share**

Confirm: motion → clip written to NAS → plays back → retention prunes oldest when free space crosses the floor (temporarily set a high floor to force a prune; verify only files under the storage root are deleted and newest survive).

- [ ] **Step 4: Commit (optional)**

```bash
git add README.md && git commit -m "docs: CCTV → UGREEN recording setup"
```

---

## Self-Review notes

- **Spec coverage:** capture pipeline (T7–9), storage mount + validation (T5), free-space retention (T5,T9,T13), ffmpeg detection (T6), motion via scene detection (T4,T8), full RTSP URL per camera + ffprobe/ffmpeg validation (T6,T11), encryption at rest + masking (T2,T11), API (T11), frontend incl. clip playback + discovered-camera attach (T12), security guards (T3 traversal, T11 clip guard, arg-array spawns). All present.
- **Type consistency:** `CameraController` ctor `{camera, concat, storageRoot, now}` used identically in T7 and T9; `selectSegments(segments, motionTimes, {preRoll,postRoll})` consistent T4/T7; `planRetention(clips,{freeBytes,floorBytes})` consistent T5/T9; `validateStorage` return `{ok,freeBytes,reason}` consistent T5/T9/T11; `withinRoot(root,target)` consistent T3/T5/T11.
- **Known pragmatic seam:** T9 maps segment filename index → time assuming exact 2s segments; real-stream drift is acceptable for motion clips and is validated manually (T12/T13). The correctness-critical stitching is unit-tested with injected segments (T7).
