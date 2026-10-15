// Service worker: simpan tampilan kiosk dan model wajah di cache tablet.
// Naikkan VERSION setiap kali file di folder docs berubah.
const VERSION = 'v1';
const SHELL = `presensi-shell-${VERSION}`;
const CDN = 'presensi-cdn-v1'; // URL CDN memakai versi tetap, jadi aman disimpan lama

const SHELL_FILES = [
  './', './index.html', './setup.html', './daftar.html', './manifest.json',
  './css/style.css', './icons/icon-192.png', './icons/icon-512.png',
  './js/api.js', './js/face.js', './js/queue.js', './js/search.js',
  './js/kiosk.js', './js/setup.js', './js/daftar.js', './js/pwa.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== CDN).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // API Apps Script (POST) tidak pernah disimpan
  const url = new URL(req.url);

  if (url.hostname === 'cdn.jsdelivr.net') {
    // cache-first: library dan model wajah
    e.respondWith(caches.open(CDN).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin === self.location.origin) {
    // network-first: selalu ambil versi terbaru, pakai cache saat offline
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })),
    );
  }
});
