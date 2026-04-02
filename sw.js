//sw.js v0.2 alertes (à partir de index_v0.916)

const CACHE_NAME = 'pacingcount-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './chart.js'  // Ajout : nécessaire pour le mode hors-ligne
  './icon-192.png', // Ajout indispensable idem
  './icon-512.png'  // Ajout indispensable
];

// Installation du service worker et mise en cache
self.addEventListener('install', event => {
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
// ALERTES DE PACING
// Reçoit SCHEDULE_ALERTS depuis index.html et programme
// les notifications différées via setTimeout.
// Reçoit CANCEL_ALERTS pour tout annuler proprement.
//
// Structure d'un message SCHEDULE_ALERTS :
// {
//   type: 'SCHEDULE_ALERTS',
//   startTime: <timestamp ms>,   // début de la période active
//   alerts: [                    // tableau des vagues à programmer
//     {
//       fireAt: <timestamp ms>,  // moment exact de la vague
//       count:  <1|2|3...>,      // nombre de notifications dans cette vague
//       title:  <string>,        // titre de la notification
//       body:   <string>         // corps de la notification
//     }, ...
//   ]
// }
// ============================================================

// Stockage des identifiants de timers actifs
let alertTimers = [];

self.addEventListener('message', event => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'SCHEDULE_ALERTS') {
    // Annule toutes les alertes précédentes avant d'en programmer de nouvelles
    cancelAllTimers();

    const now = Date.now();

    data.alerts.forEach((wave, waveIdx) => {
      const delay = wave.fireAt - now;

      // Si le moment est déjà passé (ex: redémarrage app en cours de période), on ignore
      if (delay <= 0) {
        console.log(`[SW] Vague ${waveIdx + 1} ignorée (délai déjà écoulé)`);
        return;
      }

      // Programme chaque notification de la vague avec 1 seconde d'écart
      for (let i = 0; i < wave.count; i++) {
        const notifDelay = delay + (i * 1000);
        const tag = `pacing-w${waveIdx}-n${i}`;

        const timerId = setTimeout(() => {
          self.registration.showNotification(wave.title, {
            body:               wave.body,
            tag:                tag,
            requireInteraction: true,   // reste visible jusqu'au tap
            actions: [
              { action: 'dismiss', title: "J'ai compris" }
            ]
          });
          console.log(`[SW] Notification envoyée : ${tag}`);
        }, notifDelay);

        alertTimers.push(timerId);
      }

      console.log(`[SW] Vague ${waveIdx + 1} (${wave.count}x) programmée dans ${Math.round(delay / 60000)} min`);
    });
  }

  if (data.type === 'CANCEL_ALERTS') {
    cancelAllTimers();
    console.log('[SW] Toutes les alertes annulées');
  }
});

// Annule tous les timers en cours et vide le tableau
function cancelAllTimers() {
  alertTimers.forEach(id => clearTimeout(id));
  alertTimers = [];
}

// Fermeture de la notification au tap (bouton "J'ai compris" ou tap direct)
self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Pas d'ouverture forcée de l'app — l'utilisateur décide
  console.log('[SW] Notification fermée par l\'utilisateur');
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
  
  console.log("Push reçu !");
});
