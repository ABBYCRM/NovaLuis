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
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    // Seed the latest HTML immediately. Without this, a newly installed PWA
    // had no navigation fallback until the user completed a second page load.
    const shell = await fetch('/');
    if (shell.ok) await cache.put(NAVIGATION_FALLBACK, shell.clone());
    await self.skipWaiting();
  })());
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

  if (request.mode === 'navigate' || request.url.endsWith('/') || request.url.endsWith('/index.html')) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(NAVIGATION_FALLBACK, response.clone());
        }
        return response;
      } catch (_) {
        const cached = await caches.match(NAVIGATION_FALLBACK);
        return cached || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
