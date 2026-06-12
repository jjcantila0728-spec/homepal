// Core runtime: client state, formatting/selector helpers, toasts & modals,
// and the accessibility enhancer. Everything else builds on this module.
import { ART } from './constants.js';

export var NOW = new Date(), CM = NOW.getMonth(), CY = NOW.getFullYear(), CD = NOW.getDate();
export function ds(o) { o = o || 0; var d = new Date(CY, CM, CD + o); return d.toISOString().split('T')[0]; }

// Chart.js instances, keyed by canvas role, so we can destroy before re-render.
export var charts = {};

// Client state. All household data is hydrated from the server on bootstrap();
// these are empty/neutral defaults only — no demo data ships in the client.
export var S = {
  view: 'dashboard', userId: 1, householdName: '', calMonth: CM, calYear: CY, selectedDate: ds(), homeRoom: 'all', tasksTab: 'chores', camAnim: null, notifOpen: false,
  weather: { temp: '--', cond: '', icon: 'fa-cloud', city: '', hi: '--', lo: '--', forecast: [] },
  members: [], events: [], transactions: [], budgets: [], savings: [],
  recurring: [], debts: [],
  securityArmed: false,
  thermostat: { temp: '--', target: 72, mode: 'cool', on: false },
  rooms: [], scenes: [], lights: [], devices: [],
  energy: { today: 0, week: 0, month: 0, items: [] },
  chores: [], chorePoints: {}, shopping: [], alerts: [],
  automations: [], autoSeeded: false,
  assistants: { alexa: false, google: false, siri: false, homekit: false, voiceName: 'HomePal' },
  nid: 100
};

// ---- formatting & escaping ----
// Escape any string before it lands in innerHTML. Every user-controlled value
// (names, notes, brands, stream URLs, search text…) must pass through here.
export function esc(s) {
  return s == null ? '' : String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export var val = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
export function money(n) { return '$' + (Math.round((+n || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
export function fd(ds2) { if (!ds2) return ''; var d = new Date(ds2 + 'T00:00:00'); var t = new Date(CY, CM, CD); var diff = Math.round((d - t) / (86400000)); if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff === -1) return 'Yesterday'; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
export function mKey(dateStr) { return (dateStr || '').slice(0, 7); } // YYYY-MM
// Advance a recurring item's next-due date by its frequency.
export function nextDue(dateStr, freq) { var d = new Date(dateStr + 'T00:00:00'); if (freq === 'weekly') d.setDate(d.getDate() + 7); else if (freq === 'yearly') d.setFullYear(d.getFullYear() + 1); else d.setMonth(d.getMonth() + 1); return d.toISOString().split('T')[0]; }

export function avatar(m, w, h, fs, br) { m = m || {}; w = w || 36; h = h || 36; fs = fs || 13; br = br || 10; return '<div class="avatar" style="background:' + esc(m.color || '#10B981') + ';width:' + w + 'px;height:' + h + 'px;font-size:' + fs + 'px;border-radius:' + br + 'px">' + esc(m.init) + '</div>'; }

// ---- selectors ----
export function gm(id) { return S.members.find(function (m) { return m.id === id; }); }
export function cu() { return gm(S.userId) || S.members[0] || { name: '', role: 'member', color: '#10B981', init: '' }; }
export function ia() { return cu().role === 'admin'; }

// Real money helpers — derived from actual transactions, never hardcoded.
export function txInMonth(y, m) { var key = y + '-' + String(m + 1).padStart(2, '0'); return S.transactions.filter(function (t) { return mKey(t.date) === key; }); }
export function sumType(list, type) { return list.filter(function (t) { return t.type === type; }).reduce(function (s, t) { return s + (+t.amount || 0); }, 0); }
// Live budget spend = this month's expenses in that category (not a stored number).
export function budgetSpent(cat) { return txInMonth(CY, CM).filter(function (t) { return t.type === 'expense' && t.cat === cat; }).reduce(function (s, t) { return s + (+t.amount || 0); }, 0); }
export function totalDebt() { return (S.debts || []).reduce(function (s, d) { return s + (+d.balance || 0); }, 0); }
export function totalMinPay() { return (S.debts || []).reduce(function (s, d) { return s + (+d.minPayment || 0); }, 0); }

// ---- toasts & modals ----
export function showToast(msg, type) {
  type = type || 'info';
  var container = document.getElementById('toast-container');
  if (!container) return;
  var icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.setAttribute('role', 'status');
  el.innerHTML = '<i class="fa-solid ' + (icons[type] || icons.info) + '" aria-hidden="true"></i><span>' + esc(msg) + '</span>';
  container.appendChild(el);
  setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, 3000);
}
export function showModal(html) {
  var box = document.getElementById('modal-box');
  var ov = document.getElementById('modal-overlay');
  box.innerHTML = html;
  ov.classList.add('show');
  enhanceA11y(box);
  // Move focus into the dialog for keyboard & screen-reader users.
  var focusable = box.querySelector('input,select,textarea,button');
  if (focusable) setTimeout(function () { try { focusable.focus(); } catch (e) {} }, 30);
}
export function hideModal() { document.getElementById('modal-overlay').classList.remove('show'); }

export function emptyState(color, title, sub) { return '<div class="empty-state"><div class="empty-art">' + ART.empty(color) + '</div><div class="text-sm font-semibold">' + esc(title) + '</div>' + (sub ? '<div class="text-xs text-[var(--muted)] mt-1">' + esc(sub) + '</div>' : '') + '</div>'; }

// ---- accessibility ----
// Make the app's generated div/span controls keyboard-operable: any element with
// an inline onclick that is not already a native control gets role=button +
// tabindex. A global Enter/Space handler (in main.js) activates them.
export function enhanceA11y(root) {
  if (!root || !root.querySelectorAll) return;
  var apply = function (el) {
    var tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
  };
  if (root.hasAttribute && root.hasAttribute('onclick')) apply(root);
  var nodes = root.querySelectorAll('[onclick]');
  for (var i = 0; i < nodes.length; i++) apply(nodes[i]);
}
