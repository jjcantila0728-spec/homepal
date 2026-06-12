// HomePal server — zero-dependency HTTP API + static host (built-in http).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  registerHousehold, getUserByEmail, getUserById, getState, putState, emailExists, collection, db
} from './db.js';
import { verifyPassword, signToken, verifyToken } from './auth.js';
import { applyVoiceCommand } from './voice.js';
import { discoverDevices, checkReachable } from './discovery.js';
import { ffmpegInfo, validateRtspUrl, applyConfig, stopEngine } from './cctv.js';
import { validateStorage, listClips } from './cctv-storage.js';
import { withinRoot, safeName } from './cctv-paths.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import { cctvStatusPayload, sanitizeCamerasForClient } from './cctv-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin'
};
const send = (res, status, body, headers = {}) => {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers });
  res.end(payload);
};
const json = (res, status, obj) => send(res, status, obj);
const fail = (res, status, error) => send(res, status, { error });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 8 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); return; }
      data += c;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function authUser(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = getUserById(payload.uid);
  if (!user || user.household_id !== payload.hid) return null;
  return user;
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Lightweight per-IP throttle for auth endpoints (defeats brute-force/flooding).
const authHits = new Map(); // ip -> { count, ts }
function authThrottled(ip) {
  const now = Date.now();
  const w = authHits.get(ip);
  if (!w || now - w.ts > 60_000) { authHits.set(ip, { count: 1, ts: now }); return false; }
  w.count += 1;
  return w.count > 20; // >20 auth attempts/minute/IP
}

// Only IPv4 addresses in private/loopback ranges are probeable (RFC 1918 + localhost).
// Blocks public IPs and link-local (169.254/16, incl. cloud metadata 169.254.169.254).
function isPrivateHost(host) {
  if (!host) return false;
  if (host === 'localhost') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host.trim());
  if (!m) return false;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if ([a, b, c, Number(m[4])].some((n) => n > 255)) return false;
  if (a === 127) return true;                       // loopback
  if (a === 10) return true;                         // 10.0.0.0/8
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
  return false;
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/health') return json(res, 200, { ok: true, time: new Date().toISOString() });

  // ---- auth ----
  if (route === 'POST /api/auth/register' || route === 'POST /api/auth/login') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (authThrottled(ip)) return fail(res, 429, 'Too many attempts — please wait a minute and try again');
  }

  if (route === 'POST /api/auth/register') {
    const b = await readBody(req);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const adminName = String(b.adminName || b.name || '').trim();
    const householdName = String(b.householdName || '').trim();
    if (!adminName) return fail(res, 400, 'Your name is required');
    if (!emailRe.test(email)) return fail(res, 400, 'A valid email is required');
    if (password.length < 6) return fail(res, 400, 'Password must be at least 6 characters');
    if (emailExists(email)) return fail(res, 409, 'An account with that email already exists');
    const { uid, hid, memberId } = registerHousehold({ householdName, adminName, email, password });
    const token = signToken({ uid, hid });
    return json(res, 201, { token, user: { email, memberId, householdId: hid } });
  }

  if (route === 'POST /api/auth/login') {
    const b = await readBody(req);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const user = getUserByEmail(email);
    if (!user || !verifyPassword(password, user.pass_hash)) return fail(res, 401, 'Invalid email or password');
    const token = signToken({ uid: user.id, hid: user.household_id });
    return json(res, 200, { token, user: { email, memberId: user.member_id, householdId: user.household_id } });
  }

  // ---- everything below requires auth ----
  const user = authUser(req);
  if (!user) return fail(res, 401, 'Authentication required');
  const hid = user.household_id;

  if (route === 'GET /api/auth/me') {
    return json(res, 200, { email: user.email, memberId: user.member_id, householdId: hid });
  }

  if (route === 'GET /api/state') {
    const state = getState(hid);
    if (!state) return fail(res, 404, 'Household not found');
    return json(res, 200, { ...state, userId: user.member_id });
  }

  if (route === 'PUT /api/state') {
    const b = await readBody(req);
    putState(hid, b);
    return json(res, 200, { ok: true });
  }

  // Voice-command bridge — an Alexa skill / Google Action / Siri Shortcut (or the
  // in-app mic) POSTs { command } and gets back a spoken reply after applying it.
  if (route === 'POST /api/voice') {
    const b = await readBody(req);
    const state = getState(hid);
    if (!state) return fail(res, 404, 'Household not found');
    const result = applyVoiceCommand(state, b.command || b.text || '');
    if (result.ok) putState(hid, state);
    return json(res, 200, { speech: result.speech, ok: result.ok, action: result.action || null });
  }

  // Real local-network device discovery (zero-dep SSDP/UPnP). GET scans; POST
  // with { check: "host[:port]" } probes a single device for reachability.
  // Discovery only reaches devices on the same LAN as this server.
  if (route === 'GET /api/discover') {
    const result = await discoverDevices({ timeoutMs: 4000 });
    return json(res, 200, result);
  }
  if (route === 'POST /api/discover') {
    const b = await readBody(req);
    if (b.check) {
      const [host, portStr] = String(b.check).split(':');
      // Restrict probes to private/LAN ranges. This is a smart-home feature for
      // devices on your own network — refusing public/link-local hosts prevents
      // the server from being used as an SSRF port-scanner (e.g. cloud metadata).
      if (!isPrivateHost(host)) return json(res, 200, { reachable: false, host, error: 'Only private (LAN) addresses can be probed' });
      const reachable = await checkReachable(host, +portStr || 80);
      return json(res, 200, { reachable, host });
    }
    const result = await discoverDevices({ timeoutMs: 4000 });
    return json(res, 200, result);
  }

  // ---- CCTV → UGREEN NAS recording ----

  // Engine status: ffmpeg availability, storage writability + free space, cameras.
  if (route === 'GET /api/cctv/status') {
    const ff = await ffmpegInfo();
    const cfg = getState(hid)?.cctv || { storagePath: '', freeSpaceFloorGB: 20, cameras: [] };
    const storage = cfg.storagePath ? await validateStorage(cfg.storagePath) : { ok: false, reason: 'not configured', freeBytes: 0 };
    const payload = cctvStatusPayload(ff, storage, {
      enabled: cfg.enabled,
      cameras: sanitizeCamerasForClient(cfg.cameras, decryptSecret),
    });
    payload.storagePath = cfg.storagePath || '';
    payload.freeSpaceFloorGB = cfg.freeSpaceFloorGB || 20;
    return json(res, 200, payload);
  }

  // Probe an RTSP URL before enabling it.
  if (route === 'POST /api/cctv/test') {
    const b = await readBody(req);
    return json(res, 200, await validateRtspUrl(String(b.rtspUrl || '')));
  }

  // Save storage settings + cameras. New plaintext rtsp:// URLs are encrypted at
  // rest; omitted URLs keep the camera's existing ciphertext.
  if (route === 'POST /api/cctv/config') {
    const b = await readBody(req);
    const state = getState(hid);
    if (!state) return fail(res, 404, 'Household not found');
    const prev = state.cctv || { cameras: [] };
    const prevById = new Map((prev.cameras || []).map((c) => [c.id, c]));

    const cameras = [];
    for (const raw of Array.isArray(b.cameras) ? b.cameras : []) {
      const id = String(raw.id || globalThis.crypto.randomUUID());
      const existing = prevById.get(id);
      let rtspUrl;
      if (typeof raw.rtspUrl === 'string' && raw.rtspUrl.trim()) {
        if (!/^rtsp:\/\//i.test(raw.rtspUrl.trim())) return fail(res, 400, `Camera "${raw.name || id}" stream URL must start with rtsp://`);
        rtspUrl = encryptSecret(raw.rtspUrl.trim());
      } else if (existing) {
        rtspUrl = existing.rtspUrl; // keep stored ciphertext
      } else {
        return fail(res, 400, `Camera "${raw.name || id}" needs an rtsp:// stream URL`);
      }
      cameras.push({
        id,
        name: String(raw.name || 'Camera').slice(0, 60),
        rtspUrl,
        sensitivity: Math.min(0.5, Math.max(0.005, Number(raw.sensitivity) || 0.04)),
        preRoll: Math.min(30, Math.max(0, Number(raw.preRoll) ?? 5)),
        postRoll: Math.min(60, Math.max(0, Number(raw.postRoll) ?? 8)),
        enabled: !!raw.enabled,
      });
    }

    const cctv = {
      enabled: b.enabled !== undefined ? !!b.enabled : (prev.enabled ?? true),
      storagePath: String(b.storagePath ?? prev.storagePath ?? '').trim(),
      freeSpaceFloorGB: Math.max(1, Number(b.freeSpaceFloorGB) || prev.freeSpaceFloorGB || 20),
      cameras,
    };
    state.cctv = cctv;
    putState(hid, state);
    // Apply to the live engine (best-effort; never block the response).
    applyConfig(cctv, { decrypt: decryptSecret }).catch(() => {});
    return json(res, 200, { ok: true, cameras: sanitizeCamerasForClient(cameras, decryptSecret) });
  }

  // List recorded clips, optionally filtered by camera name and date.
  if (route === 'GET /api/cctv/clips') {
    const cfg = getState(hid)?.cctv;
    const root = cfg?.storagePath || '';
    if (!root) return json(res, 200, []);
    const cam = url.searchParams.get('camera');
    const date = url.searchParams.get('date');
    const slug = cam ? safeName(cam) : null;
    const clips = (await listClips(root))
      .filter((c) => {
        const p = c.path.replace(/\\/g, '/');
        if (slug && !p.includes(`/${slug}/`)) return false;
        if (date && !p.includes(`/${date}/`)) return false;
        return true;
      })
      .sort((a, b2) => b2.mtime - a.mtime)
      .map((c) => ({ path: c.path, when: c.when ? c.when.toISOString() : null, sizeMB: +(c.size / (1024 * 1024)).toFixed(1) }));
    return json(res, 200, clips);
  }

  // Stream a single clip (Range-aware), path-guarded to the storage root.
  if (route === 'GET /api/cctv/clip') {
    const cfg = getState(hid)?.cctv;
    const root = cfg?.storagePath || '';
    const file = path.resolve(url.searchParams.get('path') || '');
    if (!root || !withinRoot(root, file) || !fs.existsSync(file)) return fail(res, 404, 'Clip not found');
    const stat = fs.statSync(file);
    const range = req.headers.range;
    if (range) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = parseInt(s, 10) || 0;
      const end = e ? parseInt(e, 10) : stat.size - 1;
      res.writeHead(206, {
        ...SECURITY_HEADERS,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': 'video/mp4',
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Length': stat.size, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
    return fs.createReadStream(file).pipe(res);
  }

  // Granular read-only REST over the normalized tables.
  const m = url.pathname.match(/^\/api\/(members|events|transactions|chores|shopping)$/);
  if (req.method === 'GET' && m) return json(res, 200, collection(m[1], hid));

  return fail(res, 404, 'Not found');
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  // prevent path traversal
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) return fail(res, 403, 'Forbidden');
  // never serve server source or data
  const rel = path.relative(ROOT, filePath);
  if (rel.startsWith('server') || rel.startsWith('data') || rel.startsWith('node_modules')) {
    return fail(res, 404, 'Not found');
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // SPA fallback to index.html for unknown non-file routes
      if (req.method === 'GET' && !path.extname(pathname)) {
        return fs.readFile(path.join(ROOT, 'index.html'), (e2, idx) =>
          e2 ? fail(res, 404, 'Not found') : send(res, 200, idx, { 'Content-Type': MIME['.html'] })
        );
      }
      return fail(res, 404, 'Not found');
    }
    const type = MIME[path.extname(filePath)] || 'application/octet-stream';
    send(res, 200, buf, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    return fail(res, 400, err.message || 'Bad request');
  }
});

server.listen(PORT, () => {
  console.log(`HomePal running → http://localhost:${PORT}`);
  // Resume CCTV recording for any household with a saved, enabled config.
  try {
    const rows = db.prepare('SELECT id FROM households').all();
    for (const { id } of rows) {
      const cctv = getState(id)?.cctv;
      if (cctv?.enabled && cctv.storagePath) applyConfig(cctv, { decrypt: decryptSecret }).catch(() => {});
    }
  } catch {}
});

// graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { stopEngine(); } catch {} try { db.close(); } catch {} process.exit(0); });
}
