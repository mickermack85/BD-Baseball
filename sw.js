const CACHE_VERSION = 'bd-baseball-v2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './data/latest.json',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (event.request.url.includes('/data/latest.json')) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('./data/latest.json', copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(event.request)) || caches.match('./index.html'))
  );
});
