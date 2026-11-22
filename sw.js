//sw.js v0.3 alertes (à partir de index_v0.9.21-x)

const CACHE_NAME = 'PacingCount-v0.9.30-beta.2'; // MANUELLEMENT : synchroniser le numéro qui suit PacingCount-v avec APP_VERSION dans index.html
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',            // nouveau refactorisation 0.9.29-beta.20
  './js/translations.js',   // nouveau refactorisation 0.9.29-beta.20
  './js/install.js',        // nouveau refactorisation 0.9.29-beta.21
  './js/evolution.js',      // nouveau refactorisation 0.9.29-beta.21
  './js/import-export.js',  // nouveau refactorisation 0.9.29-beta.22
  './js/daily-data.js',     // nouveau refactorisation 0.9.29-beta.22
  './js/results.js',        // nouveau refactorisation 0.9.29-beta.23
  './js/push-client.js',    // nouveau 0.9.30-beta.1 (alertes serveur, POC)
  './manifest.json',
  './chart.js',  // Ajout bibliotheque pour graphiques (nécessaire pour le mode hors-ligne)
  './inapp-spy.js', // Ajout pour détection webview de réseaux sociaux
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
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS_TO_CACHE.map(url =>
        // cache:'reload' = vrai téléchargement serveur, sans passer par le cache HTTP du navigateur
        fetch(new Request(url, { cache: 'reload' })).then(response => {
          // Une 404/500 ne doit jamais être rangée comme fichier valide : l'installation
          // échoue en bloc et l'ancien SW (donc l'ancienne version cohérente) reste actif.
          if (!response.ok) throw new Error(`Échec ${url} (${response.status})`);
          return cache.put(url, response);
        })
      ))
    )
  );
  //event.waitUntil(
  //  caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  //);
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
      //requireInteraction: true, // reste visible jusqu'au tap
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


// ============================================================
// ALERTES SERVEUR (POC) — push reçu depuis le Worker Cloudflare
// Le push est VIDE (aucune donnée reçue) : le texte est fixe, défini ici. Personne ne peut donc
// faire afficher un message arbitraire. Langue : celle du navigateur (le SW ne lit pas les réglages
// de l'app) — à revoir à l'intégration réelle.
// ============================================================
const PUSH_TEXTS = {
  fr: { title: 'PacingCount', body: "Test serveur : si tu vois ceci, le push fonctionne même app fermée." },
  en: { title: 'PacingCount', body: 'Server test: if you see this, push works even with the app closed.' },
  nl: { title: 'PacingCount', body: 'Servertest: als je dit ziet, werkt push ook met de app gesloten.' }
};

self.addEventListener('push', function (event) {
  const lang = (self.navigator.language || 'fr').slice(0, 2);
  const text = PUSH_TEXTS[lang] || PUSH_TEXTS.fr;
  // Toujours afficher une notification (obligatoire avec userVisibleOnly:true).
  event.waitUntil(
    self.registration.showNotification(text.title, {
      body: text.body,
      tag: 'pacing-push',
      renotify: true,
      vibrate: [150, 200, 150],
      icon: './icon-192.png'
    })
  );
  console.log(`[SW] ${CACHE_NAME} - Push reçu !`);
  sendLogToPage(`[SW-SLTP] ${CACHE_NAME} - Push reçu !`);
});

// Au toucher de la notification : ramène l'app au premier plan (ou l'ouvre si elle est fermée).
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
