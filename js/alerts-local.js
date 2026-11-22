// js/alerts-local.js — Alertes de périodes, mode LOCAL (hors ligne) : minuteries dans la page,
// Wake Lock, pseudo-veille et rattrapage au retour au premier plan.
// Ne fonctionne que si l'app reste ouverte ; le mode serveur (js/alerts-server.js) couvre l'app fermée.
// Partie commune (réglages, interface) : js/alerts.js.
// Script classique : lit settings, state, t()… définis dans index.html, à l'exécution seulement.

const LATE_ALERT_THRESHOLD = 15000; // 15s — au-delà, le setTimeout cède la main au visibilitychange

// Tableau pour stocker les IDs des setTimeout() locaux
let localAlertTimers = [];
let autoReleaseWakeLockTimer = null; // NOUVEAU : Pour relâcher le Wake Lock

// Annule toutes les alertes en cours dans l'index (page locale)
function cancelAlerts() {
    localAlertTimers.forEach(id => clearTimeout(id));
    localAlertTimers = [];
    clearTimeout(autoReleaseWakeLockTimer); // NOUVEAU : On annule aussi le relâchement antérieurement programmé du Wake Lock
    state.sentAlerts = [];
    saveState();
    console.log('[cancelAlerts] 🛑 Toutes les alertes locales annulées.');
}

// Construit et programme les setTimeout en local.
// Source de vérité unique pour le Wake Lock : c'est la seule fonction qui sait
// réellement s'il reste des vagues futures à attendre, donc c'est elle qui décide en
// dernier ressort de tenir ou relâcher l'écran (voir la fin de la fonction). Les appelants
// n'ont plus besoin d'appeler requestWakeLock() eux-mêmes après scheduleAlerts().
async function scheduleAlerts(typeId, startTime) {
    if (!('serviceWorker' in navigator)) { releaseWakeLock(); return; }
    if (Notification.permission !== 'granted') { releaseWakeLock(); return; }

    // Cherche la config d'alerte pour ce type (doit être enabled)
    const config = settings.alerts.find(a => a.typeId === typeId && a.enabled);
    if (!config) { releaseWakeLock(); return; }

    const label = getLabelForId(typeId);

    // Annule les potentiels anciens chronomètres avant d'en créer de nouveaux
    cancelAlerts();

    const now = Date.now();
    let programmedCount = 0;
    let maxDelayMs = 0; // NOUVEAU : Va mémoriser le moment de la toute dernière alerte

    // Construit et lance les timers pour chaque vague
    for (let i = 0; i < config.maxCount; i++) {
        const fireAt = startTime
            + config.threshold * 60000          // seuil initial
            + i * config.interval * 60000;      // intervalle entre rappels

        const count = config.wave ? (i + 1) : 1;
        const delay = fireAt - now;

        // Si le moment est déjà passé (ex: reprise après fermeture), on ignore
        if (delay <= 0) {
            console.log(`[scheduleAlerts] ⏳ Vague ${i + 1} ignorée (délai déjà écoulé)`);
            continue;
        }

        // Programme chaque notification de la vague avec 1 seconde d'écart
        for (let j = 0; j < count; j++) {
            const notifDelay = delay + (j * 1000);
            const tag = `pacing-w${i}-n${j}`;

            // On enregistre le délai le plus lointain
            if (notifDelay > maxDelayMs) {
                maxDelayMs = notifDelay;
            }

            const timerId = setTimeout(async () => {
                // Guard : si trop tardif, visibilitychange s'en charge
                if (Date.now() - fireAt > LATE_ALERT_THRESHOLD) {
                    console.log(`[scheduleAlerts] ⚠️ Vague ${i + 1} abandonnée (>${LATE_ALERT_THRESHOLD / 1000}s de retard)`);
                    return;
                }
                //const timerId = setTimeout(async () => {
                const bells = '🔔'.repeat(count);
                const mins = config.threshold + i * config.interval;
                const isLast = (i === config.maxCount - 1);
                const title = isLast
                    ? `${bells} ${label} (${t('alertLastReminder')})`
                    : `${bells} ${label} (${t('alertReminderN', { n: i + 1 })})`;
                const body = t('alertNotifBody', { mins, label, n: i + 1 });

                // 1. On résout le Service Worker pile au moment du déclenchement
                const registration = await navigator.serviceWorker.ready;

                // 2. On cible l'instance aux commandes
                const worker = navigator.serviceWorker.controller || registration.active;

                if (worker) {
                    worker.postMessage({
                        type: 'DISPLAY_NOW',
                        title: title,
                        body: body,
                        tag: tag
                    });
                    console.log(`[scheduleAlerts] 🔔 Message envoyé au SW actif : ${tag}`);

                    // Enregistre la vague envoyée
                    state.sentAlerts.push({
                        waveIndex: i,
                        typeId: typeId,
                        firedAt: Date.now(),
                        mode: 'presence',
                        source: 'timer'
                    });
                    saveState();

                } else {
                    console.error("[scheduleAlerts] ❌ Impossible de trouver un SW actif pour la notif.");
                }
            }, notifDelay);

            localAlertTimers.push(timerId);
        }

        programmedCount++;
        console.log(`[scheduleAlerts] ⏱️ Vague ${i + 1} (${count}x) programmée dans ${Math.round(delay / 60000)} min`);
    }

    console.log(`[scheduleAlerts] ${programmedCount} vague(s) future(s) programmée(s) pour typeId=${typeId}`);

    if (maxDelayMs > 0) {
        // Il reste au moins une vague future à attendre — l'écran doit rester allumé.
        requestWakeLock();
        // Relâchement automatique du Wake Lock après la dernière alerte
        autoReleaseWakeLockTimer = setTimeout(() => {
            console.log("[WakeLock] Dernière alerte terminée, relâchement automatique pour économiser la batterie.");
            releaseWakeLock(); // Cette fonction s'occupe aussi d'éteindre la pseudo-veille
        }, maxDelayMs + 60000); // Se déclenche 60 secondes après la toute dernière notification
    } else {
        // Aucune vague future (toutes déjà passées, ex. rattrapage qui vide tout d'un
        // coup) — plus rien à attendre, l'écran n'a plus besoin d'être retenu.
        releaseWakeLock();
    }
}

// ============================================================
// GESTION WAKE LOCK & PSEUDO-VEILLE (après INACTIVITY_DELAY)
// ============================================================

let wakeLock = null;
let inactivityTimer = null;
const INACTIVITY_DELAY = 20000; // 20000 = 20 secondes

// 1. Fonction pour demander le Wake Lock
async function requestWakeLock() {
    // CORRECTION : On cherche correctement dans settings.alerts
    const hasActiveAlarms = settings.alerts.some(a => a.typeId === state.activeType && a.enabled);

    if (!hasActiveAlarms) {
        console.log("[WakeLock] Aucune alarme active, Wake Lock inutile.");
        releaseWakeLock(); // On relâche au cas où une alarme vient d'être désactivée en cours de route
        return;
    }

    // Anti-doublon : un verrou est déjà actif, pas besoin d'en redemander un second —
    // scheduleAlerts() appelle désormais requestWakeLock() à chaque reprogrammation,
    // pas seulement au tout premier démarrage de période.
    if (wakeLock !== null) return;

    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log("[WakeLock] Activé : l'écran restera allumé.");

            // Une fois le Wake Lock acquis, on lance la surveillance de l'inactivité
            startInactivityDetection();

            // Si le système coupe le Wake Lock (batterie faible, etc.)
            wakeLock.addEventListener('release', () => {
                console.log("[WakeLock] Relâché par le système.");
                wakeLock = null; // Sans ça, un retour de veille pouvait réacquérir un verrou fantôme sur l'ancien type actif
                stopInactivityDetection();
            });
        }
    } catch (err) {
        console.error(`[WakeLock] Erreur : ${err.name}, ${err.message}`);
    }
}
// 2. Fonction pour relâcher le Wake Lock
function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release().then(() => {
            wakeLock = null;
            console.log("[WakeLock] Désactivé manuellement.");
        });
    }
    stopInactivityDetection();
}

// 3. Gestion de l'inactivité (Pseudo-Veille)
function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    const sleepOverlay = document.getElementById('sleep-overlay');

    // On n'active l'overlay que si on a un Wake Lock actif
    if (wakeLock && sleepOverlay && sleepOverlay.classList.contains('hidden')) {
        inactivityTimer = setTimeout(() => {
            sleepOverlay.classList.remove('hidden');
            console.log("[Veille] Pseudo-veille activée.");
        }, INACTIVITY_DELAY);
    }
}

function startInactivityDetection() {
    const activities = ['mousedown', 'mousemove', 'keypress', 'touchstart', 'scroll'];
    activities.forEach(type => document.addEventListener(type, resetInactivityTimer, { passive: true }));
    resetInactivityTimer();
}

function stopInactivityDetection() {
    clearTimeout(inactivityTimer);
    const activities = ['mousedown', 'mousemove', 'keypress', 'touchstart', 'scroll'];
    activities.forEach(type => document.removeEventListener(type, resetInactivityTimer));
    // On cache la veille si elle était affichée
    document.getElementById('sleep-overlay').classList.add('hidden');
}

// Rattrapage des alertes manquées + reprogrammation des futures, au retour au premier plan.
// Appelée par l'écouteur visibilitychange d'index.html (qui gère aussi le changement de jour).
    // Pas de réacquisition du Wake Lock ici, volontairement : se fier à l'état de la
    // variable wakeLock à ce stade était fragile (un vrai relâchement système, normal
    // après extinction d'écran, pouvait laisser un état ambigu selon le moment exact).
    // scheduleAlerts(), plus bas (étape 6), est la seule source de vérité : elle sait
    // réellement s'il reste des vagues futures et décide alors de tenir ou relâcher.
async function catchUpAlertsOnVisible() {
    // 2. Pas de période active → rien à faire, si ce n'est s'assurer que le Wake Lock
    // n'est pas resté tenu par erreur (ex. après suppression de la période en cours).
    if (state.activeType === null || state.startTime === null) {
        releaseWakeLock();
        return;
    }
    const config = settings.alerts.find(a => a.typeId === state.activeType && a.enabled);
    if (!config) {
        scheduleAlerts(state.activeType, state.startTime);
        return;
    }

    const now = Date.now();

    // 3. Timestamp du dernier catchup envoyé pour ce type (0 si aucun)
    const lastCatchupAt = state.sentAlerts
        .filter(s => s.source === 'catchup' && s.typeId === state.activeType)
        .reduce((max, s) => s.firedAt > max ? s.firedAt : max, 0);

    // 4. Compter les vagues manquées depuis le dernier catchup
    let missed = 0;
    for (let i = 0; i < config.maxCount; i++) {
        const fireAt = state.startTime
            + config.threshold * 60000
            + i * config.interval * 60000;

        const alreadySent = state.sentAlerts.some(
            s => s.waveIndex === i && s.typeId === state.activeType
        );

        if (fireAt < now && !alreadySent && fireAt > lastCatchupAt) missed++;
    }

    // 5. Envoyer UN catchup si des vagues ont été manquées depuis le dernier catchup
    if (missed > 0) {
        const label = getLabelForId(state.activeType);
        const mins = Math.floor((now - state.startTime) / 60000);

        const hasMoreWaves = Array.from({ length: config.maxCount }, (_, i) =>
            state.startTime + config.threshold * 60000 + i * config.interval * 60000
        ).some(fireAt => fireAt > now);

        const title = hasMoreWaves
            ? `🔔 ${label} (${t('alertCatchupN', { n: missed })})`
            : `🔔 ${label} (${t('alertLastCatchup')})`;
        const body = missed === 1
            ? t('alertCatchupBody1', { mins, label })
            : t('alertCatchupBodyN', { mins, label, n: missed });

        try {
            const registration = await navigator.serviceWorker.ready;
            const worker = navigator.serviceWorker.controller || registration.active;
            if (worker) {
                worker.postMessage({ type: 'DISPLAY_NOW', title, body, tag: 'pacing-catchup' });
                console.log(`[visibilitychange] 🔔 Catchup : ${missed} vague(s) manquée(s)`);

                state.sentAlerts.push({
                    waveIndex: -1,
                    typeId: state.activeType,
                    firedAt: now,
                    mode: 'presence',
                    source: 'catchup'
                });
                saveState();

                if (!hasMoreWaves) releaseWakeLock();
            }
        } catch (e) {
            console.error('[visibilitychange] ❌ Erreur catchup :', e);
        }
    } else {
        console.log(`[visibilitychange] ✅ Retour visible — aucune vague manquée`);
    }

    // 6. Reprogrammer les vagues futures
    const savedSentAlerts = [...state.sentAlerts]; // sauvegarde
    scheduleAlerts(state.activeType, state.startTime);
    state.sentAlerts = savedSentAlerts; // restauration après le cancelAlerts interne
    saveState();

    console.log(`[visibilitychange] ✅ Alertes futures reprogrammées`);
    console.log(`[visibilitychange] ⏱️ Fin séquence retour visible`);
}
