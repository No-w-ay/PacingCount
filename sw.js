//sw.js v0.3 alertes (à partir de index_v0.9.21-x)

const CACHE_NAME = 'PacingCount-v0.9.30-beta.12'; // MANUELLEMENT : synchroniser le numéro qui suit PacingCount-v avec APP_VERSION dans index.html
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
  './js/alerts-shared-sw.js', // nouveau 0.9.30-beta.9 (alertes : code partagé page / service worker)
  './js/alerts.js',         // nouveau 0.9.30-beta.3 (alertes : partie commune)
  './js/alerts-local.js',   // nouveau 0.9.30-beta.3 (alertes : mode local)
  './js/alerts-server.js',  // nouveau 0.9.30-beta.3 (alertes : mode serveur)
  './manifest.json',
  './chart.js',     // Ajout bibliotheque pour graphiques (nécessaire pour le mode hors-ligne)
  './inapp-spy.js', // Ajout pour détection webview de réseaux sociaux
  './icon-192.png', // Ajout indispensable
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

// Code partagé avec la page (stockage IndexedDB, registre « déjà jouée », règle d'affichage des alertes).
// try/catch : si le chargement échoue, le service worker doit continuer à fonctionner (cache, messages) ;
// le push affichera alors une notification de repli (voir handlePush).
try {
  importScripts('js/alerts-shared-sw.js');
} catch (e) {
  console.error('[SW] importScripts(alerts-shared-sw.js) a échoué :', e);
}


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

// Affichage d'une notification d'alerte, commun au message DISPLAY_NOW (page) et au push (serveur).
// Même tag pour une même vague : si la page et le serveur la jouent toutes les deux, la seconde remplace la première.
function showAlertNotification(title, body, tag) {
  return self.registration.showNotification(title, {
    body: body,
    tag: tag,
    //requireInteraction: true, // reste visible jusqu'au tap
    //actions: [{ action: 'dismiss', title: "J'ai compris" }] // Bouton "j'ai compris"
    // 1. Ajoute un pattern de vibration (ça force Android à monter l'importance)
    vibrate: [150, 200, 150], // pattern : vibre 150 ms, silence 200 ms, vibre 150 ms
    // 3. Demande au téléphone de réveiller l'écran
    renotify: true,
    // 4. Catégorie (Expérimental mais aidé par certains navigateurs)
    silent: false,
    icon: './icon-192.png'
  });
}

self.addEventListener('message', event => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'DISPLAY_NOW') {
    showAlertNotification(data.title, data.body, data.tag);

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
// ALERTES SERVEUR — push reçu depuis le Worker Cloudflare
// Le push est VIDE (aucune donnée reçue) : il signifie seulement « regarde ton plan ». Le service worker
// décide lui-même, d'après le plan et le registre « déjà jouée » stockés dans IndexedDB par la page, avec
// la même règle que la page (alertsSelectDue, js/alerts-shared-sw.js) : les textes affichés viennent donc
// de l'appareil, personne ne peut faire afficher un message arbitraire.
// ============================================================

// Dernier recours (code partagé non chargé, IndexedDB illisible) : une notification est obligatoire
// (userVisibleOnly), on affiche un texte neutre. Langue : celle du navigateur (le SW ne lit pas les réglages).
const PUSH_FALLBACK_TEXTS = {
  fr: "Une alerte PacingCount est arrivée. Ouvrez l'application.",
  en: 'A PacingCount alert has arrived. Open the app.',
  nl: 'Er is een PacingCount-alert aangekomen. Open de app.'
};

self.addEventListener('push', function (event) {
  console.log(`[SW] ${CACHE_NAME} - Push reçu !`);
  sendLogToPage(`[SW-SLTP] ${CACHE_NAME} - Push reçu !`);
  event.waitUntil(handlePush());
});

async function handlePush() {
  await handlePushDisplay();
  // Remise à jour du serveur, après l'affichage (jamais avant : l'alerte passe en premier)
  await resyncServerAfterPush();
}

async function handlePushDisplay() {
  try {
    const plan = await alertsStoreGet('plan');
    const now = Date.now();
    // Hors mode serveur / mixte (ou plan absent) : le push est périmé, on ne joue rien
    const selection = plan && plan.mode && plan.mode !== 'local'
      ? alertsSelectDue(plan.waves, await alertsPlayedRead(), now)
      : { reminders: [], catchups: [] };

    if (selection.reminders.length === 0 && selection.catchups.length === 0) {
      sendLogToPage(`[SW-SLTP] Push sans vague due (en avance, périmé ou déjà jouée)`);
      await showNothingDue();
      return;
    }

    // Marquage AVANT l'affichage (source 'sw') : la page, au retour, ne rejouera pas ces vagues
    const entries = [];
    selection.reminders.forEach(w => entries.push({ alertId: w.alertId, runStart: w.runStart, waveIndex: w.index, firedAt: now, source: 'sw' }));
    selection.catchups.forEach(c => c.waves.forEach(w => entries.push({ alertId: w.alertId, runStart: w.runStart, waveIndex: w.index, firedAt: now, source: 'sw' })));
    await alertsPlayedAdd(entries);

    if (selection.catchups.length > 0) {
      const text = alertsBuildCatchup(selection.catchups, plan.texts, now);
      await showAlertNotification(text.title, text.body, 'pacing-catchup');
    }
    for (const w of selection.reminders) {
      await showAlertNotification(w.title, w.body, w.tag);
    }
    sendLogToPage(`[SW-SLTP] Push : ${selection.reminders.length} rappel(s), ${selection.catchups.length} rattrapage(s)`);
  } catch (e) {
    console.error('[SW] handlePush a échoué :', e);
    const lang = (self.navigator.language || 'fr').slice(0, 2);
    await self.registration.showNotification('PacingCount', {
      body: PUSH_FALLBACK_TEXTS[lang] || PUSH_FALLBACK_TEXTS.fr,
      tag: 'pacing-push-fallback',
      icon: './icon-192.png'
    });
  }
}

// Après un push, le service worker recalcule les horaires restants d'après le plan et le registre, et les
// renvoie au serveur s'ils diffèrent de ce qu'il connaît (vagues entrées dans la fenêtre de 24 h, envoi
// précédent resté sans réseau…). La chaîne d'alertes continue ainsi, app fermée. Au mieux : une erreur
// (réseau…) est ignorée, la page reprendra la main à sa prochaine ouverture. Sans identifiant d'appareil
// copié dans IndexedDB par la page, on ne fait rien.
async function resyncServerAfterPush() {
  try {
    const plan = await alertsStoreGet('plan');
    if (!plan || !plan.mode || plan.mode === 'local') return;
    const state = await alertsPushStateGet();
    if (!state.deviceId) return;
    const sub = await self.registration.pushManager.getSubscription();
    if (!sub) return;
    const playedKeys = new Set((await alertsPlayedRead()).map(p => alertsWaveKey(p.alertId, p.runStart, p.waveIndex)));
    const desired = alertsPushDesiredTimes(plan.waves, (a, r, i) => playedKeys.has(alertsWaveKey(a, r, i)), Date.now());
    const syncedFuture = state.times === null ? null : state.times.filter(x => x > Date.now() + 1000);
    if (syncedFuture !== null && alertsPushSameTimes(syncedFuture, desired) && state.endpoint === sub.endpoint) return;
    await alertsPushSync(sub, desired);
    sendLogToPage(`[SW-SLTP] Serveur remis à jour après le push (${desired.length} horaire(s))`);
  } catch (e) {
    console.warn('[SW] Remise à jour du serveur impossible :', e);
  }
}

// Le navigateur a renouvelé (ou perdu) l'abonnement push : le serveur garde l'ancienne adresse et ses push
// partiraient dans le vide. On se réabonne avec la même clé et on envoie la nouvelle adresse (support inégal
// selon les navigateurs : la page fait la même vérification à chaque synchronisation).
self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(handleSubscriptionChange());
});

async function handleSubscriptionChange() {
  try {
    const plan = await alertsStoreGet('plan');
    const state = await alertsPushStateGet();
    if (!plan || !plan.mode || plan.mode === 'local' || !state.deviceId) return;
    let sub = await self.registration.pushManager.getSubscription();
    if (!sub) sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushUrlBase64ToBytes(PUSH_VAPID_PUBLIC_KEY) });
    const playedKeys = new Set((await alertsPlayedRead()).map(p => alertsWaveKey(p.alertId, p.runStart, p.waveIndex)));
    const desired = alertsPushDesiredTimes(plan.waves, (a, r, i) => playedKeys.has(alertsWaveKey(a, r, i)), Date.now());
    if (desired.length === 0) {
      await alertsPushStateUpdate(() => ({ endpoint: sub.endpoint })); // rien à envoyer : on retient seulement la nouvelle adresse
      return;
    }
    await alertsPushSync(sub, desired);
    sendLogToPage('[SW-SLTP] Abonnement push renouvelé : nouvelle adresse envoyée au serveur');
  } catch (e) {
    console.warn('[SW] pushsubscriptionchange : échec', e);
  }
}

// Push sans rien à jouer. Le navigateur exige d'afficher quelque chose à chaque push (userVisibleOnly).
// Une fenêtre de l'app visible : Chrome n'exige rien, on n'affiche rien (la page gère ses alertes).
// Sinon : notification sans son, fermée aussitôt (à valider sur appareils, iOS compris).
async function showNothingDue() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (windows.some(c => c.visibilityState === 'visible')) return;
  await self.registration.showNotification('PacingCount', { tag: 'pacing-idle', silent: true, icon: './icon-192.png' });
  const shown = await self.registration.getNotifications({ tag: 'pacing-idle' });
  shown.forEach(n => n.close());
}

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
