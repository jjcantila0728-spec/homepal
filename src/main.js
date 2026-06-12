// Entry point. Wires the inline-handler surface onto window (the generated HTML
// uses onclick="fn()"), sets up keyboard + accessibility, boots the app, and
// registers the service worker.
import * as Views from './views.js';
import * as Actions from './actions.js';
import * as Voice from './voice.js';
import * as Autos from './automations.js';
import { S, hideModal, enhanceA11y, showToast } from './core.js';
import { ART } from './constants.js';
import {
  bootstrap, showAuth, hideBoot, showBootError, ensureAuthScreen, TOKEN,
  logout, authTab, authError, submitLogin, submitRegister, setToken
} from './api.js';

// Expose everything the inline handlers in generated HTML call.
Object.assign(window, Views, Actions, Voice, Autos);
Object.assign(window, { S, hideModal, ART, logout, authTab, authError, submitLogin, submitRegister });

// A render error should never blank the app silently.
window.onerror = function (m, s, l) {
  var c = document.getElementById('content');
  if (c && c.innerHTML.trim() === '') c.innerHTML = '<div class="p-8 text-center"><h2 class="text-xl font-bold text-[var(--red)] mb-2">Something went wrong</h2><p class="text-sm text-[var(--muted)]">' + String(m) + '</p></div>';
};

function appVisible() { var a = document.getElementById('auth-screen'); return !a || a.style.display === 'none'; }

function init() {
  // Keyboard: search shortcut, escape to dismiss, Enter/Space to activate controls.
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (appVisible()) Actions.openSearch(); return; }
    if (e.key === 'Escape') { Actions.closeSearch(); hideModal(); if (S.notifOpen) { S.notifOpen = false; Actions.renderNotifPanel(); } return; }
    if (e.key === 'Enter' || e.key === ' ') {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('role') === 'button' && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) { e.preventDefault(); t.click(); }
    }
  });

  // Keep dynamically-rendered controls keyboard-operable.
  try {
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        for (var j = 0; j < m.addedNodes.length; j++) { var n = m.addedNodes[j]; if (n.nodeType === 1) enhanceA11y(n); }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  } catch (e) {}

  // Boot: hydrate if we have a token, else show auth. Network failure ≠ logout.
  if (TOKEN) {
    bootstrap().catch(function (err) {
      if (err && err.status === 401) { setToken(''); showAuth(); }
      else { showBootError('We couldn’t reach the HomePal server. If you’re offline, reconnect and retry.'); }
    });
  } else {
    showAuth();
  }
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
