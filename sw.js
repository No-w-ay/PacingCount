const cacheName = 'pacingcount-v1';
const assets = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png'
];

// 1. Installation : On met en cache les fichiers essentiels
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(cacheName).then((cache) => {
      console.log('[Service Worker] Mise en cache des ressources');
      return cache.addAll(assets);
    })
  );
});

// 2. Activation : On nettoie les anciens caches si on change de version
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))
      );
    })
  );
});

// 3. Stratégie réseau : On sert le cache en priorité, sinon on va sur internet
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
