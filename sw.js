const CACHE_NAME = 'mou5ayam-chtee-v1';
const ASSETS = ['./','./index.html','./style.css','./app.js','./manifest.json','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(r => r || caches.match('./index.html'))));
});
