// NovaLuis PWA Service Worker
//
// IMPORTANT: this cache name is stamped from the backend at boot time so
// every new deploy gets a unique cache and the user's previous install is
// evicted automatically. The backend app.ts reads each /assets/* URL and
// the index.html and rewrites them with ?v=BUILD_ID; the service worker
// mirrors that by also deriving its cache name from the same BUILD_ID, so
// cached entries never collide with new code. A second copy of this file
// is also injected at runtime by app.ts into the /assets/sw.js route so
// the change below is picked up without a manual bump.
const params = new URLSearchParams(self.location.search);
const RUNTIME_BUILD_ID =
  (params.get('v') ||
   (self.registration && self.registration.scope ? '' : '') ||
   String(Date.now())).slice(0, 32) || String(Date.now());
const CACHE_NAME = 'nova-luis-' + RUNTIME_BUILD_ID;

// The app shell — only the truly static visual assets. We deliberately
// exclude `/` (index.html) so it is always served fresh from the network.
// This is what stops a user from getting stuck on an old buggy bundle
// after we push a fix.
const APP_SHELL = [
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.webmanifest',
  '/skills.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.url.includes('/api/')) return;

  // NETWORK-FIRST for the SPA root. The app shell is a tiny page that
  // pulls in the real UI as inline scripts; serving a stale copy would
  // freeze the user on an old version after every deploy.
  if (request.mode === 'navigate' || request.url.endsWith('/') || request.url.endsWith('/index.html')) {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(request))
    );
    return;
  }

  // CACHE-FIRST for everything else (icons, manifest, skills page).
  // The backend's `?v=BUILD_ID` cache-busting on /assets/* means each
  // deploy produces new URLs, so a stale cache for the old /assets/foo.js
  // can never satisfy a request for the new one.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
