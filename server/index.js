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
});

// graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { db.close(); } catch {} process.exit(0); });
}
