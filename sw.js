//sw.js v0.2 alertes (à partir de index_v0.916)

const CACHE_NAME = 'PacingCount-v0.919'; //gestion timer alertes par index, SW ne fait qu'afficher
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './chart.js',  // Ajout : nécessaire pour le mode hors-ligne
  './icon-192.png', // Ajout indispensable idem
  './icon-512.png'  // Ajout indispensable
];

// Installation du service worker et mise en cache
self.addEventListener('install', event => {
  console.log(`[SW] ⬇️ Installation de la version : ${CACHE_NAME}`);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  // Force l'activation immédiate sans attendre la fermeture des onglets existants
  self.skipWaiting();
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
sendLogToPage(`[SW-SLTP] Version ${CACHE_NAME} active !`);

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
    });
    
    console.log(`[SW] ${CACHE_NAME} - Notification affichée immédiatement : ${data.tag}`);
    
    // Essayer d'envoyer le log à la page (si sendLogToPage existe)
    if (typeof sendLogToPage === "function") {
        sendLogToPage(`[SW-SLTP] ${CACHE_NAME} - Notification affichée : ${data.tag}`);
    }
  }
});


// BONUS : détection notification push serveur
self.addEventListener('push', function(event) {
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
});
