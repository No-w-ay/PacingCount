//sw.js v0.3 alertes (à partir de index_v0.9.21-x)

const CACHE_NAME = 'PacingCount-v0.9.21-beta.12'; // MANUELLEMENT : synchroniser le numéro qui suit PacingCount-v avec APP_VERSION dans index.html
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './chart.js',  // Ajout : nécessaire pour le mode hors-ligne
  './icon-192.png', // Ajout indispensable idem
  './icon-512.png'  // Ajout indispensable
];

//Petite fonction pour envoyer des Log du SW à index.html
function sendLogToPage(message) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type: 'SW_LOG',
        message: message
      });
    });
  });
}

// Utilisation :
sendLogToPage(`[SW-SLTP] Premier SLTP pour SW ${CACHE_NAME}`);


// Installation du service worker et mise en cache
self.addEventListener('install', event => {
  console.log(`[SW] ⬇️ Installation de la version : ${CACHE_NAME}`);
  sendLogToPage(`[SW-SLTP] ⬇️ Installation de la version : ${CACHE_NAME}`);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  // skipWaiting() désactivé — la mise à jour est gérée manuellement via le bouton "Vérifier mise à jour"
  // self.skipWaiting();
});

// Interception des requêtes pour fonctionner hors-ligne
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});

// Nettoyage des anciens caches si on met à jour la version
self.addEventListener('activate', event => {
  console.log(`[SW] 🚀 Activation réussie : ${CACHE_NAME} est maintenant aux commandes !`);
  sendLogToPage(`[SW-SLTP] 🚀 Activation réussie : ${CACHE_NAME} est maintenant aux commandes !`);
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) return caches.delete(cache);
        })
      )
    )
  );
  // Prend le contrôle immédiatement de tous les clients ouverts
  self.clients.claim();
});



// ============================================================
// ALERTES DE PACING (Version simplifiée)
// Ne gère plus le temps. Reçoit DISPLAY_NOW depuis index.html 
// et affiche immédiatement la notification.
// ============================================================

self.addEventListener('message', event => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'DISPLAY_NOW') {
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      requireInteraction: true, // reste visible jusqu'au tap
      //actions: [{ action: 'dismiss', title: "J'ai compris" }] // Bouton "j'ai compris"
      // 1. Ajoute un pattern de vibration (ça force Android à monter l'importance)
      vibrate: [150, 200, 150], // pattern : vibre 150 ms, silence 200 ms, vibre 150 ms
      // 3. Demande au téléphone de réveiller l'écran
      renotify: true,
      // 4. Catégorie (Expérimental mais aidé par certains navigateurs)
      silent: false
    });

    console.log(`[SW] ${CACHE_NAME} - Notification affichée immédiatement : ${data.tag}`);

    // Essayer d'envoyer le log à la page (si sendLogToPage existe)
    if (typeof sendLogToPage === "function") {
      sendLogToPage(`[SW-SLTP] ${CACHE_NAME} - Notification affichée : ${data.tag}`);
    }
  }

  // Répond avec la version du SW au clic sur "Vérifier mise à jour"
  if (data.type === 'GET_VERSION') {
    event.source.postMessage({ type: 'SW_VERSION', version: CACHE_NAME });
    sendLogToPage(`[SW-SLTP] GET_VERSION reçu — version envoyée : ${CACHE_NAME}`);
  }

  // Déclenche l'activation du nouveau SW (appelé depuis applyUpdate() dans index.html)
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    sendLogToPage(`[SW-SLTP] SKIP_WAITING reçu — activation en cours...`);
  }
});


// BONUS : détection notification push serveur
self.addEventListener('push', function (event) {
  const options = {
    body: 'Ceci est une notification de test push !'   // ,
    //   icon: 'icon.png',
    //  badge: 'badge.png'
  };

  // On demande au système d'afficher la bulle
  event.waitUntil(
    self.registration.showNotification('Ma PWA', options)
  );

  console.log(`[SW] ${CACHE_NAME} - Push reçu !`);
  sendLogToPage(`[SW-SLTP] ${CACHE_NAME} - Push reçu !`);
});
