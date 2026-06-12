// Smart-home automations + device connection.
//
// AUTOMATION ENGINE: rules are {trigger, actions}. Triggers fire from events
// (security armed/disarmed, presence changes) and from a once-a-minute time tick
// (main.js). Actions mutate household state (scenes, lights, climate, locks,
// security, notifications). The engine runs in the browser while HomePal is open
// on any household device — honest execution model surfaced in the UI.
//
// CONNECT DEVICES: scans the local network for real WiFi/UPnP devices via the
// server's /api/discover (zero-dep SSDP). Found devices are type-detected and
// added with one tap. Works when HomePal runs on the same LAN as the devices.
import { S, esc, showToast, showModal, hideModal, val, emptyState } from './core.js';
import { render } from './views.js';
import { devTypeMeta } from './constants.js';
import { persist, discoverScan, checkDevice } from './api.js';

/* ===================== Engine ===================== */
function nowHM() { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function todayKey() { var d = new Date(); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }

function presenceMatch(mode) {
  var members = S.members || [];
  if (!members.length) return false;
  var away = members.every(function (m) { return m.status === 'out' || m.status === 'work' || m.status === 'school' || m.status === 'gym'; });
  var anyHome = members.some(function (m) { return m.status === 'home'; });
  if (mode === 'everyone_away') return away;
  if (mode === 'someone_home') return anyHome;
  return false;
}

// Apply a scene's action map quietly (no splash) — used by the engine.
function applyScene(sc) {
  var a = sc.actions || {};
  if (a.lightsAllOff) S.lights.forEach(function (l) { l.on = false; });
  if (a.lightsOn) a.lightsOn.forEach(function (rm) { S.lights.filter(function (l) { return l.room === rm; }).forEach(function (l) { l.on = true; l.brightness = 80; }); });
  if (a.lightsDim) S.lights.filter(function (l) { return l.on; }).forEach(function (l) { l.brightness = Math.min(l.brightness, a.lightsDim); });
  if (a.devicesOn) a.devicesOn.forEach(function (id) { var d = S.devices.find(function (x) { return x.id === id; }); if (d) d.status = 'on'; });
  if (a.lockAll) S.devices.filter(function (d) { return d.type === 'lock'; }).forEach(function (d) { d.status = 'locked'; d.icon = 'fa-lock'; });
  if (a.arm) S.securityArmed = true;
  if (a.thermostat) { S.thermostat.target = a.thermostat; S.thermostat.on = true; }
}

function applyActions(auto) {
  (auto.actions || []).forEach(function (ac) {
    if (ac.kind === 'scene') { var sc = S.scenes.find(function (s) { return s.id === ac.scene; }); if (sc) applyScene(sc); }
    else if (ac.kind === 'lights') { var ls = ac.room === 'all' || !ac.room ? S.lights : S.lights.filter(function (l) { return l.room === ac.room; }); ls.forEach(function (l) { l.on = !!ac.on; if (ac.on && l.brightness < 5) l.brightness = 80; }); }
    else if (ac.kind === 'lightsOff') { S.lights.forEach(function (l) { l.on = false; }); }
    else if (ac.kind === 'thermostat') { S.thermostat.target = Math.max(55, Math.min(85, +ac.target || 70)); S.thermostat.on = true; }
    else if (ac.kind === 'security') { S.securityArmed = !!ac.arm; }
    else if (ac.kind === 'lockAll') { S.devices.filter(function (d) { return d.type === 'lock'; }).forEach(function (d) { d.status = 'locked'; d.icon = 'fa-lock'; }); }
  });
}

function fire(auto) {
  applyActions(auto);
  auto.lastRun = 'Just now';
  S.alerts.unshift({ id: ++S.nid, type: 'automation', msg: 'Automation “' + auto.name + '” ran', time: 'Just now', sev: 'info', seen: false });
}

// Event-driven triggers (security/presence). Called from the relevant actions.
export function runAutomations(event) {
  event = event || {};
  var fired = false;
  (S.automations || []).forEach(function (auto) {
    if (!auto.enabled) return;
    var tg = auto.trigger || {};
    if (tg.type !== event.type) return;
    if (tg.type === 'security' && !!tg.armed !== !!event.armed) return;
    if (tg.type === 'presence' && !presenceMatch(tg.mode)) return;
    fire(auto); fired = true;
  });
  if (fired) { persist(); }
  return fired;
}

// Time-driven triggers — called once a minute by main.js.
export function tickAutomations() {
  var hm = nowHM(), tk = todayKey(), fired = false;
  (S.automations || []).forEach(function (auto) {
    if (!auto.enabled) return;
    var tg = auto.trigger || {};
    if (tg.type !== 'time' || tg.at !== hm) return;
    if (auto._fired === tk + ' ' + hm) return; // run once per scheduled minute
    auto._fired = tk + ' ' + hm;
    fire(auto); fired = true;
  });
  if (fired) { render(); persist(); }
}

// Seed sensible defaults for households that have none yet (server also seeds;
// this is a safe fallback for accounts created before automations existed).
export function seedDefaultAutomations() {
  if (S.autoSeeded || (S.automations && S.automations.length)) return;
  S.automations = defaultAutomations();
  S.autoSeeded = true;
  persist();
}
export function defaultAutomations() {
  return [
    { id: ++S.nid, name: 'Good Night', icon: 'fa-moon', enabled: true, trigger: { type: 'time', at: '23:00' }, actions: [{ kind: 'scene', scene: 'bedtime' }], lastRun: null },
    { id: ++S.nid, name: 'Wake Up', icon: 'fa-sun', enabled: true, trigger: { type: 'time', at: '07:00' }, actions: [{ kind: 'scene', scene: 'morning' }], lastRun: null },
    { id: ++S.nid, name: 'Secure When Everyone Leaves', icon: 'fa-shield-halved', enabled: true, trigger: { type: 'presence', mode: 'everyone_away' }, actions: [{ kind: 'lightsOff' }, { kind: 'lockAll' }, { kind: 'security', arm: true }], lastRun: null },
    { id: ++S.nid, name: 'Welcome Home', icon: 'fa-house-chimney-window', enabled: true, trigger: { type: 'presence', mode: 'someone_home' }, actions: [{ kind: 'security', arm: false }, { kind: 'lights', room: 'all', on: true }], lastRun: null },
    { id: ++S.nid, name: 'Lights Out Overnight', icon: 'fa-bolt', enabled: false, trigger: { type: 'time', at: '01:00' }, actions: [{ kind: 'lightsOff' }], lastRun: null }
  ];
}

/* ===================== Automations view ===================== */
var TRIGGER_LABELS = { time: 'At a set time', security: 'When security changes', presence: 'When the family comes/goes' };
function triggerText(tg) {
  if (!tg) return '';
  if (tg.type === 'time') return 'Every day at ' + tg.at;
  if (tg.type === 'security') return tg.armed ? 'When security is armed' : 'When security is disarmed';
  if (tg.type === 'presence') return tg.mode === 'everyone_away' ? 'When everyone leaves home' : 'When someone comes home';
  return '';
}
function actionText(actions) {
  return (actions || []).map(function (ac) {
    if (ac.kind === 'scene') { var sc = S.scenes.find(function (s) { return s.id === ac.scene; }); return 'Run “' + (sc ? sc.name : ac.scene) + '”'; }
    if (ac.kind === 'lights') return 'Turn lights ' + (ac.on ? 'on' : 'off');
    if (ac.kind === 'lightsOff') return 'All lights off';
    if (ac.kind === 'thermostat') return 'Set climate to ' + ac.target + '°';
    if (ac.kind === 'security') return ac.arm ? 'Arm security' : 'Disarm security';
    if (ac.kind === 'lockAll') return 'Lock all doors';
    return '';
  }).filter(Boolean).join(' · ');
}

export function rAutomations() {
  var list = S.automations || [];
  var active = list.filter(function (a) { return a.enabled; }).length;
  var h = '<div class="border-t border-[var(--border)] mt-6 pt-6"><div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4"><div><h3 class="font-semibold flex items-center gap-2"><i class="fa-solid fa-wand-magic-sparkles text-[var(--purple)]"></i>Automations</h3><p class="text-sm text-[var(--muted)] mt-0.5">' + active + ' of ' + list.length + ' active · the home runs itself</p></div><div class="flex gap-2"><button class="btn btn-sm btn-secondary" onclick="seedDefaults()" title="Restore the built-in starter automations"><i class="fa-solid fa-wand-magic-sparkles"></i><span class="hidden sm:inline">Defaults</span></button><button class="btn btn-sm btn-primary" onclick="openAddAutomation()"><i class="fa-solid fa-plus"></i>New Automation</button></div></div>';
  h += '<div class="card mb-5" style="background:linear-gradient(120deg,rgba(16,185,129,.10),rgba(6,182,212,.04));"><div class="flex items-start gap-3"><i class="fa-solid fa-circle-info mt-0.5 text-[var(--accent)]"></i><div class="text-xs text-[var(--muted)] leading-relaxed">Automations run on any household device that has HomePal open, and stay in sync for everyone. For 24/7 triggers, keep a tablet or a self-hosted instance running on your home network — that same instance is what discovers and controls your real WiFi devices.</div></div></div>';
  if (!list.length) { h += emptyState('var(--purple)', 'No automations yet', 'Create one, or tap Defaults for a head start') + '</div>'; return h; }
  h += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">';
  for (var i = 0; i < list.length; i++) {
    var a = list[i];
    h += '<div class="auto-card ' + (a.enabled ? '' : 'off') + '"><div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style="background:rgba(139,92,246,.15);color:var(--purple)"><i class="fa-solid ' + esc(a.icon || 'fa-wand-magic-sparkles') + '"></i></div><div class="flex-1 min-w-0"><div class="flex items-center gap-2"><div class="font-semibold text-sm truncate">' + esc(a.name) + '</div>' + (a.lastRun ? '<span class="chip" style="background:rgba(16,185,129,.12);color:var(--accent)">ran ' + esc(a.lastRun) + '</span>' : '') + '</div><div class="text-[11px] text-[var(--muted)] mt-0.5"><i class="fa-solid fa-bolt text-[9px] mr-1"></i>' + esc(triggerText(a.trigger)) + '</div><div class="text-[11px] text-[var(--muted)] mt-0.5"><i class="fa-solid fa-play text-[9px] mr-1"></i>' + esc(actionText(a.actions)) + '</div><div class="flex gap-2 mt-2"><button class="btn btn-sm btn-ghost" onclick="runAutomationNow(' + a.id + ')"><i class="fa-solid fa-play"></i>Run</button><button class="btn btn-sm btn-ghost" onclick="deleteAutomation(' + a.id + ')" aria-label="Delete ' + esc(a.name) + '"><i class="fa-solid fa-trash-can"></i></button></div></div><div class="toggle ' + (a.enabled ? 'on' : '') + '" style="width:42px;height:24px" onclick="toggleAutomation(' + a.id + ')" aria-label="Enable ' + esc(a.name) + '" aria-pressed="' + (a.enabled ? 'true' : 'false') + '"></div></div>';
  }
  h += '</div></div>'; return h;
}

function sceneOptions() { return (S.scenes || []).map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join(''); }

export function openAddAutomation() {
  showModal('<div class="p-5"><div class="flex items-center justify-between mb-4"><h3 class="font-bold">New Automation</h3><button class="text-[var(--muted)] hover:text-[var(--fg)]" onclick="hideModal()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><div class="space-y-3">'
    + '<div><label>Name</label><input class="input" id="au-name" placeholder="e.g. Movie time"></div>'
    + '<div><label>When… (trigger)</label><select class="input" id="au-trigger" onchange="autoTriggerChange()"><option value="time">At a set time</option><option value="armed">Security gets armed</option><option value="disarmed">Security gets disarmed</option><option value="away">Everyone leaves home</option><option value="home">Someone comes home</option></select></div>'
    + '<div id="au-time-wrap"><label>Time</label><input class="input" id="au-time" type="time" value="07:00"></div>'
    + '<div><label>Do this… (action)</label><select class="input" id="au-action" onchange="autoActionChange()"><option value="scene">Run a scene</option><option value="lightsOn">Turn all lights on</option><option value="lightsOff">Turn all lights off</option><option value="thermostat">Set the thermostat</option><option value="arm">Arm security</option><option value="disarm">Disarm security</option><option value="lockAll">Lock all doors</option></select></div>'
    + '<div id="au-scene-wrap"><label>Scene</label><select class="input" id="au-scene">' + sceneOptions() + '</select></div>'
    + '<div id="au-thermo-wrap" style="display:none"><label>Target temperature (°F)</label><input class="input" id="au-thermo" type="number" min="55" max="85" value="70"></div>'
    + '<button class="btn btn-primary w-full" onclick="saveAutomation()">Create Automation</button></div></div>');
}
export function autoTriggerChange() { var t = val('au-trigger'); var w = document.getElementById('au-time-wrap'); if (w) w.style.display = t === 'time' ? 'block' : 'none'; }
export function autoActionChange() { var a = val('au-action'); var sw = document.getElementById('au-scene-wrap'); var tw = document.getElementById('au-thermo-wrap'); if (sw) sw.style.display = a === 'scene' ? 'block' : 'none'; if (tw) tw.style.display = a === 'thermostat' ? 'block' : 'none'; }
export function saveAutomation() {
  var name = val('au-name').trim(); if (!name) { showToast('Name your automation', 'error'); return; }
  var tSel = val('au-trigger'), trigger;
  if (tSel === 'time') trigger = { type: 'time', at: val('au-time') || '07:00' };
  else if (tSel === 'armed') trigger = { type: 'security', armed: true };
  else if (tSel === 'disarmed') trigger = { type: 'security', armed: false };
  else if (tSel === 'away') trigger = { type: 'presence', mode: 'everyone_away' };
  else trigger = { type: 'presence', mode: 'someone_home' };
  var aSel = val('au-action'), action, icon = 'fa-wand-magic-sparkles';
  if (aSel === 'scene') { action = { kind: 'scene', scene: val('au-scene') }; icon = 'fa-clapperboard'; }
  else if (aSel === 'lightsOn') { action = { kind: 'lights', room: 'all', on: true }; icon = 'fa-lightbulb'; }
  else if (aSel === 'lightsOff') { action = { kind: 'lightsOff' }; icon = 'fa-lightbulb'; }
  else if (aSel === 'thermostat') { action = { kind: 'thermostat', target: +val('au-thermo') || 70 }; icon = 'fa-temperature-half'; }
  else if (aSel === 'arm') { action = { kind: 'security', arm: true }; icon = 'fa-shield-halved'; }
  else if (aSel === 'disarm') { action = { kind: 'security', arm: false }; icon = 'fa-shield-halved'; }
  else { action = { kind: 'lockAll' }; icon = 'fa-lock'; }
  S.automations.push({ id: ++S.nid, name: name, icon: icon, enabled: true, trigger: trigger, actions: [action], lastRun: null });
  hideModal(); render(); showToast('Automation “' + name + '” created', 'success');
}
export function toggleAutomation(id) { var a = (S.automations || []).find(function (x) { return x.id === id; }); if (!a) return; a.enabled = !a.enabled; render(); showToast(a.name + ' ' + (a.enabled ? 'enabled' : 'paused'), a.enabled ? 'success' : 'info'); }
export function deleteAutomation(id) { S.automations = (S.automations || []).filter(function (x) { return x.id !== id; }); render(); showToast('Automation removed', 'warning'); }
export function runAutomationNow(id) { var a = (S.automations || []).find(function (x) { return x.id === id; }); if (!a) return; fire(a); render(); showToast('“' + a.name + '” ran', 'success'); }
export function seedDefaults() { S.automations = defaultAutomations(); S.autoSeeded = true; render(); showToast('Default automations restored', 'success'); }

/* ===================== Connect Devices ===================== */
export function openConnectDevices() {
  S._discovered = S._discovered || [];
  showModal('<div class="p-5"><div class="flex items-center justify-between mb-3"><h3 class="font-bold flex items-center gap-2"><i class="fa-solid fa-wifi text-[var(--accent)]"></i>Connect Devices</h3><button class="text-[var(--muted)] hover:text-[var(--fg)]" onclick="hideModal()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>'
    + '<p class="text-xs text-[var(--muted)] mb-4 leading-relaxed">HomePal scans your local network for smart devices (UPnP / WiFi) and detects what each one is. Discovery works when HomePal runs on the <b>same network</b> as your devices — a cloud-hosted instance can\'t reach gear behind your home router.</p>'
    + '<div class="flex gap-2 mb-4"><button class="btn btn-primary flex-1" id="scan-btn" onclick="scanNetwork()"><i class="fa-solid fa-radar"></i>Scan my network</button><button class="btn btn-secondary" onclick="openManualConnect()"><i class="fa-solid fa-keyboard"></i>Add by IP</button></div>'
    + '<div id="scan-results"><div class="text-center text-xs text-[var(--muted)] py-6"><i class="fa-solid fa-house-signal text-2xl mb-2 block opacity-50"></i>Tap “Scan my network” to find devices nearby.</div></div></div>');
}

export function scanNetwork() {
  var btn = document.getElementById('scan-btn');
  var box = document.getElementById('scan-results');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="boot-spin" style="width:14px;height:14px;border-width:2px"></span>Scanning…'; }
  if (box) box.innerHTML = '<div class="text-center text-xs text-[var(--muted)] py-6"><span class="pulse-dot mx-auto mb-3 block"></span>Listening for devices on your network…</div>';
  discoverScan().then(function (res) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-radar"></i>Scan again'; }
    S._discovered = (res && res.devices) || [];
    renderScanResults(res);
  }).catch(function () {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-radar"></i>Scan again'; }
    renderScanResults({ ok: false, reason: 'Scan failed — the server could not run network discovery.', devices: [] });
  });
}

function renderScanResults(res) {
  var box = document.getElementById('scan-results'); if (!box) return;
  var devs = (res && res.devices) || [];
  if (!devs.length) {
    box.innerHTML = '<div class="p-4 rounded-xl bg-[var(--bg2)] border border-[var(--border)] text-xs text-[var(--muted)] leading-relaxed"><i class="fa-solid fa-circle-info mr-1 text-[var(--amber)]"></i>' + esc((res && res.reason) || 'No devices found.') + '<div class="mt-2">You can still add a device manually by its IP address.</div></div>';
    return;
  }
  var h = '<div class="flex items-center justify-between mb-2"><span class="text-xs font-semibold">' + devs.length + ' device' + (devs.length > 1 ? 's' : '') + ' found</span><button class="text-[11px] text-[var(--accent)] hover:underline" onclick="addAllDiscovered()">Add all</button></div><div class="space-y-2 max-h-72 overflow-y-auto">';
  for (var i = 0; i < devs.length; i++) {
    var d = devs[i]; var meta = devTypeMeta[d.type] || devTypeMeta.appliance; var added = !!d._added;
    h += '<div class="disc-row"><div class="disc-ic" style="background:rgba(16,185,129,.12);color:var(--accent)"><i class="fa-solid ' + (meta.icon || 'fa-plug') + '"></i></div><div class="flex-1 min-w-0"><div class="text-sm font-medium truncate">' + esc(d.name || 'Unknown device') + '</div><div class="text-[10px] text-[var(--muted)] truncate">' + esc((meta.label || d.type)) + (d.brand ? ' · ' + esc(d.brand) : '') + (d.ip ? ' · ' + esc(d.ip) : '') + '</div></div>' + (added ? '<span class="chip" style="background:rgba(16,185,129,.12);color:var(--accent)"><i class="fa-solid fa-check"></i> Added</span>' : '<button class="btn btn-sm btn-primary" onclick="addDiscovered(' + i + ')">Add</button>') + '</div>';
  }
  h += '</div>';
  box.innerHTML = h;
}

function ensureRoom() {
  if (S.rooms && S.rooms.length) return S.rooms[0].id;
  var id = 'room' + (++S.nid); S.rooms.push({ id: id, name: 'Smart Devices', icon: 'fa-house-signal' }); return id;
}
export function addDiscovered(i) {
  var d = (S._discovered || [])[i]; if (!d || d._added) return;
  var room = ensureRoom();
  if (d.type === 'light') { S.lights.push({ id: ++S.nid, name: d.name, room: room, on: false, brightness: 80, source: 'discovered', ip: d.ip, brand: d.brand, model: d.model, online: true }); }
  else { var meta = devTypeMeta[d.type] || devTypeMeta.appliance; S.devices.push({ id: ++S.nid, name: d.name, room: room, type: d.type, status: meta.status || 'off', icon: meta.icon || 'fa-plug', source: 'discovered', ip: d.ip, brand: d.brand, model: d.model, online: true }); }
  d._added = true;
  S.alerts.unshift({ id: ++S.nid, type: 'device', msg: d.name + ' connected from the network', time: 'Just now', sev: 'success', seen: false });
  persist(); renderScanResults({ devices: S._discovered }); render();
  showToast(d.name + ' connected', 'success');
}
export function addAllDiscovered() { var list = S._discovered || []; var n = 0; for (var i = 0; i < list.length; i++) { if (!list[i]._added) { addDiscovered(i); n++; } } if (!n) showToast('Nothing new to add', 'info'); }

export function openManualConnect() {
  showModal('<div class="p-5"><div class="flex items-center justify-between mb-4"><h3 class="font-bold">Add Device by IP</h3><button class="text-[var(--muted)] hover:text-[var(--fg)]" onclick="hideModal()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><div class="space-y-3"><div><label>Name</label><input class="input" id="mc-name" placeholder="e.g. Living Room TV"></div><div class="grid grid-cols-2 gap-3"><div><label>Type</label><select class="input" id="mc-type"><option value="light">Light</option><option value="lock">Lock</option><option value="camera">Camera</option><option value="sensor">Sensor</option><option value="media">Media</option><option value="appliance" selected>Appliance</option><option value="climate">Climate</option></select></div><div><label>IP address</label><input class="input" id="mc-ip" placeholder="192.168.1.50"></div></div><div id="mc-status" class="text-[11px] text-[var(--muted)]"></div><button class="btn btn-secondary w-full" onclick="testManual()"><i class="fa-solid fa-plug-circle-check"></i>Test reachability</button><button class="btn btn-primary w-full" onclick="saveManual()">Add Device</button></div></div>');
}
export function testManual() {
  var ip = val('mc-ip').trim(); var st = document.getElementById('mc-status'); if (!ip) { if (st) st.textContent = 'Enter an IP first.'; return; }
  if (st) st.innerHTML = '<span class="boot-spin" style="width:11px;height:11px;border-width:2px;display:inline-block;vertical-align:middle"></span> Checking ' + esc(ip) + '…';
  checkDevice(ip).then(function (r) { if (st) st.innerHTML = r && r.reachable ? '<span style="color:var(--accent)"><i class="fa-solid fa-check"></i> ' + esc(ip) + ' is reachable</span>' : '<span style="color:var(--amber)"><i class="fa-solid fa-triangle-exclamation"></i> No response from ' + esc(ip) + ' (it may still work, or be on another network)</span>'; });
}
export function saveManual() {
  var name = val('mc-name').trim(), type = val('mc-type'), ip = val('mc-ip').trim();
  if (!name) { showToast('Enter a device name', 'error'); return; }
  var room = ensureRoom();
  if (type === 'light') S.lights.push({ id: ++S.nid, name: name, room: room, on: false, brightness: 80, source: 'manual', ip: ip || undefined });
  else { var meta = devTypeMeta[type] || devTypeMeta.appliance; S.devices.push({ id: ++S.nid, name: name, room: room, type: type, status: meta.status || 'off', icon: meta.icon || 'fa-plug', source: 'manual', ip: ip || undefined }); }
  hideModal(); render(); showToast(name + ' added', 'success');
}
