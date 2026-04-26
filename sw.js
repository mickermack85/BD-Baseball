// Self-destructing service worker.
// Replaces the previous SW that was caching an empty root response from early failed deploys.
// On install, it skips waiting; on activate, it deletes ALL caches and unregisters itself.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const regs = await self.registration.unregister();
      const clientList = await self.clients.matchAll({ type: 'window' });
      clientList.forEach((client) => client.navigate(client.url));
    } catch (e) {
      // no-op
    }
  })());
});

// Network-only fetch handler so nothing is served from cache while this SW is alive.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
