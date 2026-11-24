// Campus Store — service worker.
// Always asks GitHub for the newest files when online (so updates show up at once),
// and falls back to the saved copy when offline.
// Change VERSION whenever you upload new files.
const VERSION = 'campus-store-v10';
const SHELL = ['./', 'index.html', 'manifest.json', 'firebase-config.js', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // order submissions go straight to Google
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // newest from the network (revalidated, never a stale browser copy), saved copy if offline
    e.respondWith(
      fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true })
        .then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
    );
  } else if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(req).then(r => r || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
        return res;
      }))
    );
  }
});
