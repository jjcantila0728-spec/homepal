// "Cameras & Storage" view: UGREEN NAS storage config, ffmpeg status banner,
// per-camera cards, and a clip browser. Follows the app's existing pattern —
// rCctv() returns skeleton HTML, initCctv() fetches status and fills it, and
// handlers are exposed on window for inline onclick (see main.js).
import { S, esc, showToast } from './core.js';
import { api } from './api.js';

var _status = null; // last /api/cctv/status payload (drives save deltas)

export function rCctv() {
  return '<div class="max-w-3xl mx-auto space-y-5"><div id="cctv-root" class="space-y-5">' +
    '<div class="card p-6 text-center text-[var(--muted)] text-sm">Loading cameras…</div>' +
    '</div></div>';
}

export function initCctv() {
  api('GET', '/api/cctv/status')
    .then(function (s) { _status = s; paintCctv(s); })
    .catch(function (e) {
      var r = document.getElementById('cctv-root');
      if (r) r.innerHTML = '<div class="card p-6 text-sm text-[var(--red)]">Couldn’t load CCTV status: ' + esc(e.message || 'error') + '</div>';
    });
}

function gb(n) { return (n === undefined || n === null) ? '—' : n; }

function paintCctv(s) {
  var root = document.getElementById('cctv-root');
  if (!root) return;
  var html = '';

  // ffmpeg banner
  if (!s.ffmpeg) {
    html += '<div class="card p-4" style="border:1px solid rgba(245,158,11,.4);background:rgba(245,158,11,.08)">' +
      '<div class="flex items-start gap-3"><i class="fa-solid fa-triangle-exclamation" style="color:var(--amber)"></i>' +
      '<div class="text-xs"><div class="font-semibold mb-0.5">ffmpeg not found on the HomePal host</div>' +
      'Recording needs ffmpeg installed on the machine running HomePal. Install it, then reload.</div></div></div>';
  }

  // Storage
  var st = s.storage || {};
  html += '<div class="card p-5"><h3 class="font-bold mb-3 flex items-center gap-2"><i class="fa-solid fa-hard-drive" style="color:var(--accent)"></i>UGREEN Storage</h3>' +
    '<label class="block text-xs text-[var(--muted)] mb-1">Mount path</label>' +
    '<input class="input mb-3" id="cctv-path" value="' + esc(s.storagePath || '') + '" placeholder="Z:\\cctv or /mnt/ugreen/cctv">' +
    '<label class="block text-xs text-[var(--muted)] mb-1">Keep free (GB)</label>' +
    '<input class="input mb-3" id="cctv-floor" type="number" min="1" value="' + gb(s.freeSpaceFloorGB) + '">' +
    '<div class="text-xs mb-3 ' + (st.ok ? 'text-[var(--muted)]' : 'text-[var(--red)]') + '">' +
    (st.ok ? ('Free now: ' + gb(st.freeGB) + ' GB') : ('⚠ ' + esc(st.reason || 'unreachable'))) + '</div>' +
    '<button class="btn btn-primary" onclick="cctvSaveStorage()"><i class="fa-solid fa-floppy-disk"></i>Save storage</button></div>';

  // Cameras
  html += '<div class="card p-5"><div class="flex items-center justify-between mb-3"><h3 class="font-bold flex items-center gap-2"><i class="fa-solid fa-video" style="color:var(--accent)"></i>Cameras</h3>' +
    '<button class="btn btn-sm" onclick="cctvAddCamera()"><i class="fa-solid fa-plus"></i>Add camera</button></div>';
  var cams = s.cameras || [];
  if (!cams.length) {
    html += '<div class="text-sm text-[var(--muted)]">No cameras yet. Add one with its RTSP URL to start motion recording.</div>';
  } else {
    for (var i = 0; i < cams.length; i++) {
      var c = cams[i];
      html += '<div class="rounded-xl p-3 mb-2" style="background:rgba(255,255,255,.04)">' +
        '<div class="flex items-center justify-between"><div class="min-w-0"><div class="font-semibold text-sm truncate">' + esc(c.name) + '</div>' +
        '<div class="text-[11px] text-[var(--muted)] truncate">' + esc(c.rtspMasked || 'no stream set') + '</div></div>' +
        '<label class="text-xs flex items-center gap-1 flex-shrink-0">' + (c.recording ? '<span style="color:var(--accent)">● rec</span>' : '') +
        '<input type="checkbox" ' + (c.enabled ? 'checked' : '') + ' onchange="cctvToggleCamera(\'' + c.id + '\',this.checked)"> on</label></div>' +
        '<div class="flex items-center gap-2 mt-2 text-[11px] text-[var(--muted)]">Sensitivity ' +
        '<input type="range" min="0.01" max="0.2" step="0.01" value="' + (c.sensitivity || 0.04) + '" onchange="cctvSetSensitivity(\'' + c.id + '\',this.value)" style="flex:1">' +
        '<button class="btn btn-sm" onclick="cctvShowClips(\'' + esc(c.name) + '\')">Clips</button></div></div>';
    }
  }
  html += '</div>';

  // Clip browser target
  html += '<div id="cctv-clips" class="space-y-2"></div>';

  root.innerHTML = html;
}

// Build the cameras payload from the last status (no rtspUrl => server keeps
// each camera's stored ciphertext), applying an optional per-camera patch.
function camerasPayload(patchId, patch) {
  var cams = (_status && _status.cameras) || [];
  return cams.map(function (c) {
    var out = { id: c.id, name: c.name, sensitivity: c.sensitivity, preRoll: c.preRoll, postRoll: c.postRoll, enabled: c.enabled };
    if (patchId && c.id === patchId) for (var k in patch) out[k] = patch[k];
    return out;
  });
}

function saveConfig(extra) {
  var body = {
    storagePath: document.getElementById('cctv-path') ? document.getElementById('cctv-path').value : (_status && _status.storagePath),
    freeSpaceFloorGB: document.getElementById('cctv-floor') ? Number(document.getElementById('cctv-floor').value) : (_status && _status.freeSpaceFloorGB),
    enabled: _status ? _status.enabled : true,
    cameras: (extra && extra.cameras) || camerasPayload()
  };
  return api('POST', '/api/cctv/config', body).then(function () { initCctv(); });
}

export function cctvSaveStorage() {
  saveConfig().then(function () { showToast('Storage settings saved', 'success'); })
    .catch(function (e) { showToast(e.message || 'Save failed', 'error'); });
}

export function cctvToggleCamera(id, on) {
  saveConfig({ cameras: camerasPayload(id, { enabled: !!on }) })
    .then(function () { showToast(on ? 'Recording enabled' : 'Recording paused', 'info'); })
    .catch(function (e) { showToast(e.message || 'Save failed', 'error'); });
}

export function cctvSetSensitivity(id, val) {
  saveConfig({ cameras: camerasPayload(id, { sensitivity: Number(val) }) })
    .catch(function (e) { showToast(e.message || 'Save failed', 'error'); });
}

export function cctvAddCamera() {
  var name = window.prompt('Camera name (e.g. Front Door):');
  if (!name) return;
  var rtsp = window.prompt('RTSP URL (e.g. rtsp://user:pass@192.168.1.50:554/stream1):');
  if (!rtsp) return;
  showToast('Testing stream…', 'info');
  api('POST', '/api/cctv/test', { rtspUrl: rtsp }).then(function (r) {
    if (!r.ok) showToast('Stream test failed: ' + (r.reason || 'unreachable') + ' — saving anyway', 'error');
    var cams = camerasPayload();
    cams.push({ name: name, rtspUrl: rtsp, sensitivity: 0.04, preRoll: 5, postRoll: 8, enabled: true });
    return saveConfig({ cameras: cams });
  }).then(function () { showToast('Camera added', 'success'); })
    .catch(function (e) { showToast(e.message || 'Could not add camera', 'error'); });
}

export function cctvShowClips(cameraName) {
  var el = document.getElementById('cctv-clips');
  if (!el) return;
  el.innerHTML = '<div class="card p-4 text-sm text-[var(--muted)]">Loading clips…</div>';
  api('GET', '/api/cctv/clips?camera=' + encodeURIComponent(cameraName)).then(function (clips) {
    var html = '<div class="card p-5"><h3 class="font-bold mb-3">Clips — ' + esc(cameraName) + '</h3>';
    if (!clips.length) { html += '<div class="text-sm text-[var(--muted)]">No recordings yet.</div></div>'; el.innerHTML = html; return; }
    for (var i = 0; i < clips.length; i++) {
      var cl = clips[i];
      var when = cl.when ? new Date(cl.when).toLocaleString() : 'clip';
      html += '<div class="flex items-center justify-between py-1.5 border-t border-[rgba(255,255,255,.06)]">' +
        '<span class="text-sm">' + esc(when) + ' <span class="text-[var(--muted)] text-xs">(' + cl.sizeMB + ' MB)</span></span>' +
        '<button class="btn btn-sm" onclick="cctvPlayClip(\'' + encodeURIComponent(cl.path) + '\')">Play</button></div>';
    }
    html += '<div id="cctv-player" class="mt-3"></div></div>';
    el.innerHTML = html;
  }).catch(function (e) { el.innerHTML = '<div class="card p-4 text-sm text-[var(--red)]">' + esc(e.message || 'error') + '</div>'; });
}

export function cctvPlayClip(encPath) {
  var host = document.getElementById('cctv-player');
  if (!host) return;
  // Auth is header-based; fetch the clip as a blob so the <video> can play it.
  host.innerHTML = '<div class="text-xs text-[var(--muted)]">Loading…</div>';
  var url = '/api/cctv/clip?path=' + encPath;
  var headers = {};
  try { var t = localStorage.getItem('homepal-token'); if (t) headers['Authorization'] = 'Bearer ' + t; } catch (e) {}
  fetch(url, { headers: headers }).then(function (r) { return r.blob(); }).then(function (b) {
    host.innerHTML = '';
    var v = document.createElement('video');
    v.controls = true; v.style.width = '100%'; v.style.borderRadius = '12px';
    v.src = URL.createObjectURL(b);
    host.appendChild(v); v.play().catch(function () {});
  }).catch(function () { host.innerHTML = '<div class="text-xs text-[var(--red)]">Could not load clip.</div>'; });
}
