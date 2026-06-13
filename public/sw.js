/* HomePal service worker — offline-first app shell */
const CACHE = 'homepal-v7';

/* Local app shell — cached on install so the app boots offline. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './src/app.css',
  './src/main.js',
  './src/api.js',
  './src/core.js',
  './src/views.js',
  './src/actions.js',
  './src/components.js',
  './src/constants.js',
  './src/voice.js',
  './src/automations.js'
];

/* Third-party CDNs the app loads. Cached lazily (runtime) since they are
   cross-origin/opaque and may be unavailable at install time. */
const RUNTIME_HOSTS = [
  'cdn.tailwindcss.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  /* Never cache the API — always hit the network so data stays live. */
  if (url.pathname.startsWith('/api/')) return;
  const sameOrigin = url.origin === self.location.origin;
  const isRuntimeCdn = RUNTIME_HOSTS.includes(url.hostname);
  if (!sameOrigin && !isRuntimeCdn) return;

  /* Navigations: network-first, fall back to cached shell (offline). */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  /* Everything else: cache-first, then network (and cache the result). */
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
