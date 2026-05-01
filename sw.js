// BD Baseball Show Prep service worker.
// Strategy:
//  - Static shell assets: cache-first (fast show-day loads).
//  - /data/latest.json: stale-while-revalidate with a network timeout so
//    flaky Wi-Fi falls back to the cached snapshot quickly instead of
//    hanging the page.
const CACHE_VERSION = 'bd-baseball-v6';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const DATA_CACHE = `${CACHE_VERSION}-data`;
const LATEST_PATH = '/data/latest.json';
const NETWORK_TIMEOUT_MS = 4000;

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/show_generator.js',
  '/manifest.webmanifest',
  '/assets/icon-192.png',
  '/assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((cache) => cache.addAll(CORE_ASSETS)),
      caches.open(DATA_CACHE).then((cache) => cache.add(LATEST_PATH).catch(() => {}))
    ])
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network timeout')), timeoutMs);
    fetch(request).then((res) => { clearTimeout(timer); resolve(res); },
                       (err) => { clearTimeout(timer); reject(err); });
  });
}

// Stale-while-revalidate for the snapshot: serve cached copy immediately if
// present, kick off a network refresh in the background. If no cache yet,
// race the network against the timeout and surface whatever we can.
function handleLatestJson(event) {
  event.respondWith((async () => {
    const cache = await caches.open(DATA_CACHE);
    const cached = await cache.match(LATEST_PATH);
    const networkPromise = fetchWithTimeout(event.request, NETWORK_TIMEOUT_MS)
      .then((response) => {
        if (response && response.ok) {
          cache.put(LATEST_PATH, response.clone()).catch(() => {});
        }
        return response;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(networkPromise);
      return cached;
    }
    const fresh = await networkPromise;
    if (fresh) return fresh;
    return new Response(JSON.stringify({ error: 'snapshot unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  })());
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === LATEST_PATH) {
    handleLatestJson(event);
    return;
  }

  // Cache-first for shell assets, network fallthrough for everything else.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => caches.match('/index.html'));
    })
  );
});
