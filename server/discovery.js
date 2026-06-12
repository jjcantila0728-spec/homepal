// Zero-dependency, REAL local-network smart-device discovery via SSDP/UPnP.
// Uses ONLY Node built-ins (node:dgram, node:http, node:os, node:url, node:net,
// node:crypto) — no npm packages, no native deps. We multicast an M-SEARCH to
// 239.255.255.250:1900, collect UDP responses, fetch each device's description
// XML, and map results to HomePal device types.
//
// LAN REQUIREMENT: this only works when HomePal runs on the SAME local network
// as your devices. Cloud/hosted environments cannot reach home WiFi devices,
// so discovery will simply find nothing there (it never crashes the API).
import dgram from 'node:dgram';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';
import { URL } from 'node:url';

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;

// ---- helpers ----
const lower = (s) => String(s || '').toLowerCase();
const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);

// Build an M-SEARCH datagram for a given search target.
const mSearch = (st, mx = 2) =>
  Buffer.from(
    'M-SEARCH * HTTP/1.1\r\n' +
    `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
    'MAN: "ssdp:discover"\r\n' +
    `MX: ${mx}\r\n` +
    `ST: ${st}\r\n` +
    '\r\n'
  );

// Non-internal IPv4 addresses we can send from.
function localIPv4s() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

// Parse SSDP/HTTP response headers (case-insensitive) into a plain object.
function parseHeaders(text) {
  const headers = {};
  for (const line of String(text).split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    if (key) headers[key] = line.slice(idx + 1).trim();
  }
  return headers;
}

// SSDP LOCATION urls come from untrusted UDP responses. Only fetch description
// XML from private IPv4 hosts over http: — never public IPs or link-local
// (169.254/16, incl. cloud metadata) — so a spoofed response can't turn the
// scan into an SSRF probe of internal/cloud endpoints.
function isPrivateIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host || '').trim());
  if (!m) return false;
  const [a, b, c, d] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if ([a, b, c, d].some((n) => n > 255)) return false;
  if (a === 127) return true;                       // loopback
  if (a === 10) return true;                         // 10/8
  if (a === 192 && b === 168) return true;           // 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16/12
  return false;                                      // public, 169.254/16, etc.
}
function safeLocation(loc) {
  try { const u = new URL(loc); return u.protocol === 'http:' && isPrivateIPv4(u.hostname); } catch { return false; }
}

const tag = (xml, name) => {
  const m = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'i').exec(xml);
  return m ? m[1].trim() : '';
};

// GET a device description XML (best-effort; resolves '' on any failure).
function fetchXml(location, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let req;
    try {
      req = http.get(location, { timeout: timeoutMs }, (res) => {
        if (!res.statusCode || res.statusCode >= 400) { res.resume(); return finish(''); }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
        res.on('end', () => finish(body));
        res.on('error', () => finish(''));
      });
    } catch {
      return finish('');
    }
    req.on('timeout', () => { req.destroy(); finish(''); });
    req.on('error', () => finish(''));
  });
}

// Map a device to one of HomePal's types from a lowercased descriptor blob.
function inferType(blob) {
  const has = (re) => re.test(blob);
  if (has(/internetgatewaydevice|wfadevice|\brouter\b|\bgateway\b/)) return { type: 'appliance', router: true };
  if (has(/mediarenderer|mediaserver|dial|chromecast|\bcast\b|roku|appletv|firetv|\btv\b|sonos|receiver/)) return { type: 'media' };
  if (has(/doorbell|ipcam|onvif|camera|\bcam\b/)) return { type: 'camera' };
  if (has(/thermostat|nest|ecobee|climate/)) return { type: 'climate' };
  if (has(/lock|august|schlage|yale|deadbolt/)) return { type: 'lock' };
  if (has(/bulb|light|\bhue\b|lifx|lamp/)) return { type: 'light' };
  if (has(/plug|outlet|switch|socket|shelly|kasa|relay/)) return { type: 'appliance' };
  if (has(/sensor|motion|contact|temperature|humidity/)) return { type: 'sensor' };
  return { type: 'appliance' };
}

// Turn a deduped SSDP record (+ optional XML) into a HomePal Device.
function toDevice(rec, xml) {
  const friendlyName = tag(xml, 'friendlyName');
  const manufacturer = tag(xml, 'manufacturer');
  const modelName = tag(xml, 'modelName');
  const deviceType = tag(xml, 'deviceType');

  let ip = '';
  try { ip = new URL(rec.location).hostname; } catch {}

  const blob = lower([deviceType, friendlyName, modelName, manufacturer, rec.st, rec.server].join(' '));
  const { type, router } = inferType(blob);

  let name = friendlyName;
  if (router) name = friendlyName ? `${friendlyName} (Router/Gateway)` : 'Router/Gateway';
  if (!name) name = modelName || rec.server || rec.st || ip || 'Unknown device';

  return {
    id: sha1(rec.usn || rec.location),
    name,
    type,
    brand: manufacturer || '',
    model: modelName || '',
    ip,
    location: rec.location,
    st: rec.st || '',
    server: rec.server || '',
    online: true
  };
}

// ---- public API ----

// Runs SSDP (UPnP) discovery on the local network and returns found devices.
// Never throws — on any error (no network, multicast blocked, cloud host) it
// resolves with { ok:false, reason:'...', devices:[] } so the API stays alive.
export async function discoverDevices({ timeoutMs = 4000 } = {}) {
  const records = new Map(); // location -> { location, st, usn, server }
  const seenUsn = new Set();
  const scannedFrom = [];

  const fail = (reason) => ({ ok: false, reason, devices: [] });

  // Phase 1: multicast M-SEARCH and collect responses.
  const collected = await new Promise((resolve) => {
    let socket;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hardKill);
      clearTimeout(softKill);
      try { socket && socket.close(); } catch {}
      resolve(null);
    };

    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch (err) {
      return resolve(err);
    }

    socket.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(hardKill); clearTimeout(softKill); try { socket.close(); } catch {} resolve(err); }
    });

    socket.on('message', (msg) => {
      const headers = parseHeaders(msg.toString('utf8'));
      const location = headers.location;
      if (!location) return;
      const usn = headers.usn || '';
      if (usn && seenUsn.has(usn)) return;
      if (usn) seenUsn.add(usn);
      if (records.has(location)) return;
      if (records.size >= 128) return; // bound memory against LOCATION flooding
      records.set(location, { location, st: headers.st || headers.nt || '', usn, server: headers.server || '' });
    });

    // Safety nets so we never hang past timeoutMs (+grace).
    const softKill = setTimeout(finish, timeoutMs);
    const hardKill = setTimeout(finish, timeoutMs + 2000);

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        try { socket.setMulticastTTL(2); } catch {}
        const datagrams = [mSearch('ssdp:all'), mSearch('upnp:rootdevice')];
        const targets = localIPv4s();
        const send = (buf, address) => {
          socket.send(buf, 0, buf.length, SSDP_PORT, SSDP_ADDR, () => {});
          if (address) scannedFrom.push(address);
        };
        if (targets.length) {
          for (const addr of targets) {
            try { socket.setMulticastInterface(addr); } catch {}
            for (const buf of datagrams) send(buf, addr);
          }
        } else {
          for (const buf of datagrams) send(buf, '0.0.0.0');
          scannedFrom.push('default');
        }
      } catch (err) {
        if (!settled) { settled = true; clearTimeout(hardKill); clearTimeout(softKill); try { socket.close(); } catch {} resolve(err); }
      }
    });
  });

  if (collected instanceof Error) {
    const code = collected.code;
    if (code === 'EACCES') return fail('Permission denied opening a UDP socket (EACCES).');
    if (code === 'ENETUNREACH') return fail('Network unreachable — no LAN route for multicast (ENETUNREACH).');
    if (code === 'EADDRINUSE') return fail('UDP port already in use (EADDRINUSE).');
    return fail(`Discovery socket error${code ? ` (${code})` : ''}.`);
  }

  if (!records.size) {
    return fail(
      'No devices responded (HomePal must run on the same LAN as your devices; ' +
      'cloud hosting cannot reach home WiFi devices)'
    );
  }

  // Phase 2: fetch description XML for each unique LOCATION (best-effort).
  // Cap the number of fetches and only hit private hosts (SSRF/DoS guard);
  // records that can't be safely fetched still return with header-derived info.
  const recs = [...records.values()].slice(0, 48);
  const xmls = await Promise.all(recs.map((r) => (safeLocation(r.location) ? fetchXml(r.location).catch(() => '') : Promise.resolve(''))));
  const devices = recs.map((r, i) => toDevice(r, xmls[i] || ''));

  // Dedupe by stable id (e.g. same root reachable via multiple URLs).
  const byId = new Map();
  for (const d of devices) if (!byId.has(d.id)) byId.set(d.id, d);

  return { ok: true, devices: [...byId.values()], scannedFrom: [...new Set(scannedFrom)] };
}

// Raw TCP connect check — verifies a manually-added device IP is alive.
export async function checkReachable(host, port = 80, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { socket.destroy(); } catch {} resolve(v); } };
    let socket;
    try {
      socket = net.connect({ host, port });
    } catch {
      return resolve(false);
    }
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
