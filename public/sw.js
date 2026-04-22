/* JJMMC ERP service worker — v1
 *
 * Strategy:
 *   • HTML navigations   → network-first with cache fallback (keeps fresh
 *                          content, still works offline on repeat visits).
 *   • /api/* + POSTs     → always go to the network, never cached.
 *   • Static GET assets  → cache-first with background revalidate.
 */

const CACHE = 'jjmmc-erp-v1';

// Assets that make the landing page usable offline after first visit.
// Everything else fills the cache on demand.
const PRECACHE = [
  '/',
  '/css/landing.css',
  '/css/style.css',
  '/js/landing.js',
  '/images/logo.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.webmanifest',
  '/offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Use addAll but tolerate individual failures (e.g. missing image)
      Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                    // never cache POSTs/etc

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // third-party: ignore
  if (url.pathname.startsWith('/api/')) return;         // always network

  // HTML / navigation → network-first, fall back to cached page or offline shell
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((r) => r || caches.match('/offline.html') || caches.match('/'))
        )
    );
    return;
  }

  // Static assets → cache-first with stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const networked = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || networked;
    })
  );
});
