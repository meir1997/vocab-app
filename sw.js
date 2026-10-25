const CACHE = 'four-words-offline-v20';
const SDK = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'].map(name => 'https://www.gstatic.com/firebasejs/10.14.1/' + name);
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'quiz-content.js', 'firebase-config.js', 'vocab.json', 'details.json', 'book-frequency.json', 'reader.js', 'manifest.webmanifest', 'icon.svg', ...SDK];
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const local = url.origin === self.location.origin;
  if (!local && !SDK.includes(event.request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Fixed-version SDK assets are immutable and must be usable on cold offline opens.
    const cached = await cache.match(event.request);
    if (!local && cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      if (cached) return cached;
      if (event.request.mode === 'navigate' && url.pathname.startsWith(self.registration.scope.replace(url.origin, ''))) return cache.match('index.html');
      // Never return HTML in place of missing JS, JSON or CSS.
      return Response.error();
    }
  })());
});
