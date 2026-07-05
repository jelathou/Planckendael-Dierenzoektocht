/* Service worker — maakt de Dierenzoektocht volledig offline bruikbaar. */
const CACHE = 'pdz-cache-v3';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'manifest.json',
  'icon.svg',
  'data/animals.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Precache alle lokaal gebundelde dierenfoto's (uit animals.json).
    try {
      const res = await fetch('data/animals.json', { cache: 'no-cache' });
      const animals = await res.json();
      const imgs = animals
        .map((a) => a.afbeelding)
        .filter((u) => u && !/^https?:/i.test(u));
      await Promise.allSettled(imgs.map((u) => cache.add(u)));
    } catch (err) { /* zonder foto-precache blijft de app bruikbaar */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Eigen bestanden: cache-first (offline-proof).
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
        throw err;
      }
    })());
    return;
  }

  // Externe (Wikipedia) noodval-foto's: cache-first, best effort.
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      const cache = await caches.open(CACHE);
      try { cache.put(req, res.clone()); } catch (e2) {}
      return res;
    } catch (err) {
      return cached || Response.error();
    }
  })());
});
