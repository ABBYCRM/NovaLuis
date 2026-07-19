// NovaLuis PWA Service Worker
const params = new URLSearchParams(self.location.search);
const RUNTIME_BUILD_ID = (params.get('v') || String(Date.now())).slice(0, 32);
const CACHE_NAME = 'nova-luis-' + RUNTIME_BUILD_ID;
const NAVIGATION_FALLBACK = '/__nova_navigation_shell__';

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
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.url.includes('/api/')) return;

  // Network-first navigation keeps every deploy fresh. Each successful page
  // response replaces the synthetic fallback entry, so an installed PWA can
  // still reopen offline without ever being pinned to an old shell forever.
  if (request.mode === 'navigate' || request.url.endsWith('/') || request.url.endsWith('/index.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put(NAVIGATION_FALLBACK, copy))
            );
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(NAVIGATION_FALLBACK);
          return cached || Response.error();
        })
    );
    return;
  }

  // Versioned assets are cache-first. Only successful responses are stored so
  // a transient 404/500 can never poison an installed user's cache.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          );
        }
        return response;
      });
    })
  );
});
