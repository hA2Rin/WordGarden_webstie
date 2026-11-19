const prefix = `word-garden:${self.registration.scope}:`;
const cacheName = `${prefix}10`;
const files = [
  './', './index.html', './styles.css?v=8', './garden.css?v=7', './app.js?v=10',
  './data.js', './store.js?v=6', './store.js', './sync.js', './config.js',
  './chessEngine.js?v=5', './chessOnline.js', './icon.svg', './mascot.png',
  './manifest.webmanifest',
  './editorial.css?v=9', './editorial.js?v=9',
  './arrival.css?v=10', './arrival.js?v=10', './reading-leaf.svg',
];
const assetUrls = new Set(files.map(file => new URL(file, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(prefix) && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.open(cacheName)).match(new URL('./index.html', self.registration.scope))));
  } else if (assetUrls.has(request.url)) {
    event.respondWith(caches.open(cacheName).then(async cache =>
      (await cache.match(request)) || fetch(request)));
  }
});
