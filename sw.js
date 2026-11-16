const CACHE='word-garden-shell-v4';
const FILES=['./','./index.html','./styles.css','./app.js','./data.js','./store.js','./sync.js','./config.js','./chessEngine.js','./icon.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});