// js/alerts-local.js — Alertes de périodes, mode LOCAL (hors ligne) : minuteries dans la page,
// Wake Lock, pseudo-veille et rattrapage au retour au premier plan.
// Ne fonctionne que si l'app reste ouverte ; le mode serveur (js/alerts-server.js) couvre l'app fermée.
// Partie commune (réglages, interface) : js/alerts.js.
// Script classique : lit settings, state, t()… définis dans index.html, à l'exécution seulement.

// Tolérances de retard (ALERT_LATE_TOLERANCE_MS, ALERT_EARLY_MARGIN_MS) et règle commune d'affichage :
// voir js/alerts-shared-sw.js (partagé avec le service worker).

// Tableau pour stocker les IDs des setTimeout() locaux
let localAlertTimers = [];
let autoReleaseWakeLockTimer = null; // Pour relâcher le Wake Lock

// Annule les minuteries locales (sans toucher au registre « déjà jouée »).
function clearAlertTimers() {
    localAlertTimers.forEach(id => clearTimeout(id));
    localAlertTimers = [];
    clearTimeout(autoReleaseWakeLockTimer); // On annule aussi le relâchement programmé du Wake Lock
}

// Annulation complète : minuteries ET registre « déjà jouée » (plus de période, historique reconstruit…).
function cancelAlerts() {
    clearAlertTimers();
    state.sentAlerts = [];
    mirrorPlayedFilter(() => false); // vide aussi la copie IndexedDB
    saveState();
    refreshAlertPlanStore(null, null); // plan vide : plus de période, plus de vagues
    console.log('[cancelAlerts] 🛑 Toutes les alertes locales annulées.');
}

// RÈGLE UNIQUE d'affichage, appelée par chaque minuterie ET au retour au premier plan : joue toutes
// les vagues dues et pas encore jouées, de toutes les alertes concernées par la période en cours.
// La règle elle-même (alertsSelectDue / alertsBuildCatchup, js/alerts-shared-sw.js) est la même que
// celle du service worker :
// - Alerte dont une seule vague est due, en retard d'au plus ALERT_LATE_TOLERANCE_MS : rappel normal.
// - Autres cas (plusieurs vagues dues, ou retard plus grand) : UN SEUL rattrapage pour toutes les
//   alertes, avec le rang de la dernière vague due de chacune.
// Les vagues sont marquées « jouées » AVANT toute attente d'affichage (le SW peut être lent à répondre) :
// deux appels simultanés (plusieurs minuteries qui se réveillent ensemble, retour visible) ne peuvent donc
// pas jouer deux fois la même vague, ni afficher les vagues dans le désordre. Seule la fusion préalable avec
// le registre d'IndexedDB (mergePlayedFromStore) précède le choix : choix et marquage restent d'un seul tenant.
async function playDueWaves() {
    if (state.activeType === null || state.startTime === null) return;
    await mergePlayedFromStore(); // vagues déjà jouées par le service worker

    // Rien ci-dessous n'attend avant le marquage : choix et marquage forment un bloc synchrone.
    if (state.activeType === null || state.startTime === null) return; // la période a pu s'arrêter pendant l'attente
    const now = Date.now();
    const plan = buildServerPlan(state.activeType, state.startTime);
    const { reminders, catchups } = alertsSelectDue(plan.waves, state.sentAlerts, now);
    if (reminders.length === 0 && catchups.length === 0) return;

    reminders.forEach(w => console.log(`[playDueWaves] ⏱️ ${w.name} : 1 vague due, retard réel ${now - w.fireAt} ms`));
    catchups.forEach(c => console.log(`[playDueWaves] ⏱️ ${c.name} : ${c.waves.length} vague(s) due(s), retard réel de la dernière ${now - c.waves[c.waves.length - 1].fireAt} ms`));

    // Marquage immédiat (synchrone), avant le premier await
    const marked = [];
    reminders.forEach(w => marked.push(markWavePlayed(w.alertId, w.runStart, w.index, 'timer')));
    catchups.forEach(c => c.waves.forEach(w => marked.push(markWavePlayed(w.alertId, w.runStart, w.index, 'catchup'))));
    saveState();
    mirrorPlayedAdd(marked);

    try {
        const registration = await navigator.serviceWorker.ready;
        const worker = navigator.serviceWorker.controller || registration.active; // l'instance aux commandes
        if (!worker) throw new Error('aucun SW actif');

        if (catchups.length > 0) {
            const { title, body } = alertsBuildCatchup(catchups, plan.texts, now);
            worker.postMessage({ type: 'DISPLAY_NOW', title, body, tag: 'pacing-catchup' });
            console.log(`[playDueWaves] 🔔 Rattrapage : ${catchups.length} alerte(s)`);
        }
        for (const w of reminders) {
            worker.postMessage({ type: 'DISPLAY_NOW', title: w.title, body: w.body, tag: w.tag });
            console.log(`[playDueWaves] 🔔 Message envoyé au SW actif : ${w.tag}`);
        }
    } catch (e) {
        console.error('[playDueWaves] ❌ Notification impossible, vagues remises en attente :', e);
        unmarkWavePlayed(marked);
        saveState();
    }
}

// Construit et programme les setTimeout en local, pour TOUTES les alertes actives qui
// concernent le type en cours (ensembles de types, éventuellement chevauchants).
// Source de vérité unique pour le Wake Lock : c'est la seule fonction qui sait
// réellement s'il reste des vagues futures à attendre, donc c'est elle qui décide en
// dernier ressort de tenir ou relâcher l'écran (voir la fin de la fonction). Les appelants
// n'ont plus besoin d'appeler requestWakeLock() eux-mêmes après scheduleAlerts().
// Ne vide pas le registre « déjà jouée » : elle ne retire que les entrées des séquences
// terminées. Les vagues déjà passées depuis moins de ALERT_LATE_TOLERANCE_MS sont affichées
// tout de suite (playDueWaves) ; les plus anciennes sont laissées au rattrapage du retour au premier plan.
async function scheduleAlerts(typeId, startTime) {
    clearAlertTimers(); // anciens chronomètres, avant d'en créer de nouveaux
    refreshAlertPlanStore(typeId, startTime); // plan stocké pour le service worker (voir alerts.js)
    if (!('serviceWorker' in navigator)) { releaseWakeLock(); return; }
    if (Notification.permission !== 'granted') { releaseWakeLock(); return; }

    const runs = getAlertRuns(typeId, startTime);
    if (pruneSentAlerts(runs)) saveState();
    if (runs.length === 0) { releaseWakeLock(); return; }

    const now = Date.now();
    let programmedCount = 0;
    let maxDelayMs = 0; // Va mémoriser le moment de la toute dernière alerte

    for (const run of runs) {
        for (const wave of run.plan) {
            if (isWavePlayed(run.config.id, run.runStart, wave.index)) continue;
            const delay = wave.fireAt - now;
            if (delay < -ALERT_LATE_TOLERANCE_MS) {
                console.log(`[scheduleAlerts] ⏳ Vague ${wave.index + 1} ignorée (trop ancienne : rattrapage)`);
                continue;
            }
            const fireDelay = Math.max(delay, 0);
            if (fireDelay > maxDelayMs) maxDelayMs = fireDelay; // délai le plus lointain
            localAlertTimers.push(setTimeout(playDueWaves, fireDelay));
            programmedCount++;
            console.log(`[scheduleAlerts] ⏱️ ${getAlertName(run.config)} vague ${wave.index + 1} programmée dans ${Math.round(fireDelay / 60000)} min`);
        }
    }

    console.log(`[scheduleAlerts] ${programmedCount} vague(s) programmée(s) pour ${runs.length} alerte(s)`);

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
    const hasActiveAlarms = settings.alerts.some(a => a.enabled && a.typeIds.includes(state.activeType));

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

// Rattrapage des alertes en retard + reprogrammation des futures, au retour au premier plan.
// Appelée par l'écouteur visibilitychange d'index.html (qui gère aussi le changement de jour).
// Le rattrapage lui-même est playDueWaves() (règle unique, voir plus haut) ; ici on la lance puis
// on reprogramme les vagues futures. Les vagues couvertes sont marquées « jouées », pour qu'un autre
// canal (serveur) ne les rejoue pas.
async function catchUpAlertsOnVisible() {
    // Pas de réacquisition du Wake Lock ici, volontairement : se fier à l'état de la
    // variable wakeLock à ce stade était fragile (un vrai relâchement système, normal
    // après extinction d'écran, pouvait laisser un état ambigu selon le moment exact).
    // scheduleAlerts() (étape finale) est la seule source de vérité : elle sait
    // réellement s'il reste des vagues futures et décide alors de tenir ou relâcher.

    // Pas de période active → rien à faire, si ce n'est s'assurer que le Wake Lock
    // n'est pas resté tenu par erreur (ex. après suppression de la période en cours).
    if (state.activeType === null || state.startTime === null) {
        releaseWakeLock();
        return;
    }

    await playDueWaves();

    // Reprogrammer les vagues futures (le registre « déjà jouée » est conservé)
    scheduleAlerts(state.activeType, state.startTime);

    console.log(`[visibilitychange] ✅ Alertes futures reprogrammées`);
    console.log(`[visibilitychange] ⏱️ Fin séquence retour visible`);
}
