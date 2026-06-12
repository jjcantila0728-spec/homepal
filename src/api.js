// API client, auth screens, and server-backed persistence.
import { S, showToast } from './core.js';
import { render, renderNav } from './views.js';
import { ART } from './constants.js';
import { seedDefaultAutomations, tickAutomations } from './automations.js';

var API = '';
export var TOKEN = (typeof localStorage !== 'undefined' ? localStorage.getItem('homepal-token') : '') || '';
var appReady = false, timersStarted = false, persistT = null, authBusy = false;

// The keys that make up household state, synced as a unit.
var SYNC_KEYS = ['householdName', 'members', 'events', 'transactions', 'chores', 'shopping', 'alerts', 'securityArmed', 'thermostat', 'lights', 'devices', 'scenes', 'rooms', 'energy', 'weather', 'budgets', 'savings', 'recurring', 'debts', 'assistants', 'chorePoints', 'automations', 'autoSeeded', 'nid'];

export function setToken(t) { TOKEN = t; if (t) { localStorage.setItem('homepal-token', t); } else { localStorage.removeItem('homepal-token'); } }

export function api(method, path, body) {
  var opts = { method: method, headers: {} };
  if (TOKEN) opts.headers['Authorization'] = 'Bearer ' + TOKEN;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  return fetch(API + path, opts).then(function (r) {
    return r.text().then(function (t) {
      var d = {}; try { d = t ? JSON.parse(t) : {}; } catch (e) {}
      if (!r.ok) { var err = new Error((d && d.error) || ('HTTP ' + r.status)); err.status = r.status; throw err; }
      return d;
    });
  });
}

function stateForSync() { var out = {}; SYNC_KEYS.forEach(function (k) { out[k] = S[k]; }); return out; }
export function syncNow() { if (!appReady) return Promise.resolve(); return api('PUT', '/api/state', stateForSync()).catch(function (e) { if (e && e.status === 401) logout(); }); }
export function persist() { if (!appReady) return; clearTimeout(persistT); persistT = setTimeout(syncNow, 1000); }

export function updateClock() { var el = document.getElementById('live-clock'); if (el) el.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }

export function bootstrap() {
  return api('GET', '/api/state').then(function (d) {
    SYNC_KEYS.forEach(function (k) { if (d[k] !== undefined) S[k] = d[k]; });
    S.userId = d.userId || (S.members[0] && S.members[0].id) || 1;
    appReady = true;
    seedDefaultAutomations();
    hideBoot(); hideAuth(); renderNav(); render();
    if (!timersStarted) {
      timersStarted = true;
      updateClock(); setInterval(updateClock, 1000);
      setInterval(syncNow, 10000);
      setInterval(tickAutomations, 60000);
    }
    window.addEventListener('beforeunload', function () { try { if (appReady && navigator.sendBeacon) { navigator.sendBeacon(API + '/api/state', new Blob([JSON.stringify(stateForSync())], { type: 'application/json' })); } } catch (e) {} });
  });
}

export function logout() { if (appReady) { try { syncNow(); } catch (e) {} } setToken(''); appReady = false; timersStarted = false; location.reload(); }

/* ---- discovery client ---- */
export function discoverScan() { return api('GET', '/api/discover').catch(function (e) { return { ok: false, reason: e && e.message ? e.message : 'Discovery unavailable', devices: [] }; }); }
export function checkDevice(host) { return api('POST', '/api/discover', { check: host }).catch(function () { return { reachable: false }; }); }

/* ---- boot overlay ---- */
export function hideBoot() { var b = document.getElementById('boot'); if (b) b.classList.add('hide'); }
export function showBootError(msg) {
  var b = document.getElementById('boot'); if (!b) return;
  b.classList.remove('hide');
  b.innerHTML = '<div class="boot-logo"><i class="fa-solid fa-house-chimney"></i></div><div style="text-align:center;max-width:320px"><div class="font-semibold text-[var(--fg)] mb-1">Can’t reach HomePal</div><div class="text-xs text-[var(--muted)] mb-4">' + (msg || 'The server is unreachable. Check your connection and try again.') + '</div><button class="btn btn-primary" onclick="location.reload()"><i class="fa-solid fa-rotate-right"></i>Retry</button></div>';
}

/* ---- auth ---- */
export function ensureAuthScreen() {
  if (document.getElementById('auth-screen')) return;
  var el = document.createElement('div');
  el.id = 'auth-screen';
  el.style.cssText = 'position:fixed;inset:0;z-index:300;background:var(--bg);display:none;align-items:center;justify-content:center;padding:20px';
  var feat = function (ic, t, s) { return '<div class="flex items-center gap-3"><div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style="background:rgba(255,255,255,.08)"><i class="fa-solid ' + ic + '" style="color:var(--accent)"></i></div><div><div class="text-sm font-semibold">' + t + '</div><div class="text-[11px] text-[var(--muted)]">' + s + '</div></div></div>'; };
  el.innerHTML = '<div class="ambient" style="z-index:0"><div class="ambient-orb" style="width:500px;height:500px;background:var(--accent);top:10%;left:15%"></div><div class="ambient-orb" style="width:400px;height:400px;background:var(--amber);top:55%;right:5%;animation-delay:-8s"></div><div class="ambient-orb" style="width:340px;height:340px;background:var(--purple);bottom:8%;left:40%;animation-delay:-15s"></div></div><div class="card auth-card relative z-10"><div class="auth-art"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center"><i class="fa-solid fa-house-chimney text-white"></i></div><div><h1 class="text-lg font-bold" style="font-family:\'Space Grotesk\'">HomePal</h1><p class="text-xs text-[var(--muted)] -mt-0.5">Your family hub</p></div></div><div style="margin:10px 0 4px">' + ART.home() + '</div><div class="space-y-3">' + feat('fa-calendar-check', 'Shared calendar', 'Everyone in sync') + feat('fa-wallet', 'Finances & budgets', 'Track every dollar') + feat('fa-house-signal', 'Smart home', 'Lights, locks & scenes') + feat('fa-wand-magic-sparkles', 'Automations', 'The home runs itself') + '</div></div><div class="auth-form"><div class="flex items-center gap-3 mb-5"><div class="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center"><i class="fa-solid fa-house-chimney text-white text-sm"></i></div><div><h2 class="text-lg font-bold" style="font-family:\'Space Grotesk\'">Welcome</h2><p class="text-[11px] text-[var(--muted)] -mt-0.5">Sign in to your household</p></div></div><div class="flex gap-2 mb-4"><div class="sec-tab active" id="auth-tab-login" onclick="authTab(\'login\')">Sign in</div><div class="sec-tab" id="auth-tab-reg" onclick="authTab(\'register\')">Create account</div></div><div id="auth-err" class="mb-3 px-3 py-2 rounded-lg text-xs" style="display:none;background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.3)" role="alert"></div><form id="auth-login" onsubmit="return submitLogin(event)"><div class="space-y-3"><div><label>Email</label><input class="input" type="email" id="li-email" autocomplete="email" required></div><div><label>Password</label><input class="input" type="password" id="li-pass" autocomplete="current-password" required></div><button class="btn btn-primary w-full" type="submit">Sign in</button></div></form><form id="auth-register" style="display:none" onsubmit="return submitRegister(event)"><div class="space-y-3"><div><label>Your name</label><input class="input" id="rg-name" placeholder="e.g. Marcus" required></div><div><label>Household name <span class="font-normal text-[var(--muted)]">(optional)</span></label><input class="input" id="rg-house" placeholder="The Cantila Home"></div><div><label>Email</label><input class="input" type="email" id="rg-email" autocomplete="email" required></div><div><label>Password</label><input class="input" type="password" id="rg-pass" autocomplete="new-password" placeholder="At least 6 characters" required></div><button class="btn btn-primary w-full" type="submit">Create account</button></div></form><p class="text-[11px] text-[var(--muted)] text-center mt-4">Register with any email — your hub is stored on this server, ready with starter rooms, scenes & automations to explore.</p></div></div>';
  document.body.appendChild(el);
}
export function showAuth() { hideBoot(); ensureAuthScreen(); document.getElementById('auth-screen').style.display = 'flex'; }
export function hideAuth() { var a = document.getElementById('auth-screen'); if (a) a.style.display = 'none'; }
export function authTab(t) { authError(''); document.getElementById('auth-login').style.display = t === 'login' ? 'block' : 'none'; document.getElementById('auth-register').style.display = t === 'register' ? 'block' : 'none'; document.getElementById('auth-tab-login').classList.toggle('active', t === 'login'); document.getElementById('auth-tab-reg').classList.toggle('active', t === 'register'); }
export function authError(msg) { var e = document.getElementById('auth-err'); if (!e) return; if (!msg) { e.style.display = 'none'; e.textContent = ''; } else { e.style.display = 'block'; e.textContent = msg; } }
export function submitLogin(e) { e.preventDefault(); if (authBusy) return false; authBusy = true; authError(''); api('POST', '/api/auth/login', { email: document.getElementById('li-email').value.trim(), password: document.getElementById('li-pass').value }).then(function (d) { setToken(d.token); return bootstrap(); }).then(function () { showToast('Welcome back', 'success'); }).catch(function (err) { authError(err.message || 'Sign in failed'); }).finally(function () { authBusy = false; }); return false; }
export function submitRegister(e) { e.preventDefault(); if (authBusy) return false; authBusy = true; authError(''); api('POST', '/api/auth/register', { adminName: document.getElementById('rg-name').value.trim(), householdName: document.getElementById('rg-house').value.trim(), email: document.getElementById('rg-email').value.trim(), password: document.getElementById('rg-pass').value }).then(function (d) { setToken(d.token); return bootstrap(); }).then(function () { showToast('Welcome to HomePal', 'success'); }).catch(function (err) { authError(err.message || 'Could not create account'); }).finally(function () { authBusy = false; }); return false; }
