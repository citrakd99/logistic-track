/* LoGistic Tracking — service worker.
 * File aplikasi: network-first (versi terbaru selalu dipakai saat online), cadangan dari cache saat offline.
 * Data API (script.google.com) TIDAK di-cache di sini; app menyimpan salinan data terakhir sendiri. */
const VERSION = 'lt-v1.2.0';
const SHELL = ['./', './index.html', './assets/style.css', './assets/app.js', './assets/config.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-192.png', './icons/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || /cdnjs\.cloudflare\.com$/.test(url.hostname);
  if (!sameOrigin && !fonts) return; // API & lainnya langsung ke jaringan
  if (fonts) { // jarang berubah: cache-first
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const cp = res.clone(); caches.open(VERSION).then(c => c.put(req, cp)); return res; })));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(VERSION).then(c => c.put(req, cp)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
