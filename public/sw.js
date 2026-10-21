// שומר רק את מעטפת האפליקציה. נתונים (/api) לעולם לא נשמרים במטמון.
const CACHE = 'kashrut-shell-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/icon.svg', '/manifest.webmanifest', '/vendor/chart.umd.min.js', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // רשת קודם, מטמון כגיבוי
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});
