// js/alerts-local.js — Alertes de périodes, mode LOCAL (hors ligne) : minuteries dans la page,
// Wake Lock, pseudo-veille et rattrapage au retour au premier plan.
// Ne fonctionne que si l'app reste ouverte ; le mode serveur (js/alerts-server.js) couvre l'app fermée.
// Partie commune (réglages, interface) : js/alerts.js.
// Script classique : lit settings, state, t()… définis dans index.html, à l'exécution seulement.

// Tolérance de retard : au-delà, une vague n'est plus affichée comme un rappel normal mais
// regroupée dans un rattrapage (voir catchUpAlertsOnVisible). 2 min couvre le ralentissement
// des minuteries en arrière-plan (~1 min). Le retard réel est journalisé pour calibrer cette valeur.
const ALERT_LATE_TOLERANCE_MS = 120000;

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
    saveState();
    console.log('[cancelAlerts] 🛑 Toutes les alertes locales annulées.');
}

// Affiche un rappel à l'heure (appelée par la minuterie d'une vague).
async function fireReminder(run, wave) {
    const { config, runStart } = run;
    if (isWavePlayed(config.id, runStart, wave.index)) return; // déjà couverte (rattrapage, autre canal)

    const lateMs = Date.now() - wave.fireAt;
    console.log(`[scheduleAlerts] ⏱️ ${getAlertName(config)} vague ${wave.index + 1} : retard réel ${lateMs} ms`);
    // Trop tardif : le rattrapage (retour au premier plan) s'en charge.
    if (lateMs > ALERT_LATE_TOLERANCE_MS) {
        console.log(`[scheduleAlerts] ⚠️ Vague ${wave.index + 1} abandonnée (>${ALERT_LATE_TOLERANCE_MS / 1000}s de retard)`);
        return;
    }
    const { title, body } = buildReminderText(config, wave);
    const tag = `pacing-${config.id}-w${wave.index}`;

    // On résout le Service Worker pile au moment du déclenchement
    const registration = await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller || registration.active; // l'instance aux commandes
    if (!worker) {
        console.error("[scheduleAlerts] ❌ Impossible de trouver un SW actif pour la notif.");
        return;
    }
    // Un rattrapage a pu couvrir cette vague pendant l'attente du SW
    if (isWavePlayed(config.id, runStart, wave.index)) return;

    worker.postMessage({ type: 'DISPLAY_NOW', title, body, tag });
    console.log(`[scheduleAlerts] 🔔 Message envoyé au SW actif : ${tag}`);
    markWavePlayed(config.id, runStart, wave.index, 'timer');
    saveState();
}

// Construit et programme les setTimeout en local, pour TOUTES les alertes actives qui
// concernent le type en cours (ensembles de types, éventuellement chevauchants).
// Source de vérité unique pour le Wake Lock : c'est la seule fonction qui sait
// réellement s'il reste des vagues futures à attendre, donc c'est elle qui décide en
// dernier ressort de tenir ou relâcher l'écran (voir la fin de la fonction). Les appelants
// n'ont plus besoin d'appeler requestWakeLock() eux-mêmes après scheduleAlerts().
// Ne vide pas le registre « déjà jouée » : elle ne retire que les entrées des séquences
// terminées. Les vagues déjà passées depuis moins de ALERT_LATE_TOLERANCE_MS sont affichées
// tout de suite ; les plus anciennes sont laissées au rattrapage.
async function scheduleAlerts(typeId, startTime) {
    clearAlertTimers(); // anciens chronomètres, avant d'en créer de nouveaux
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
            localAlertTimers.push(setTimeout(() => fireReminder(run, wave), fireDelay));
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
// Un SEUL rattrapage pour toutes les alertes : une notification qui regroupe, pour chaque alerte,
// le rang de son dernier rappel dépassé (voir buildCatchupText). Toutes les vagues couvertes
// sont marquées « jouées », pour qu'un autre canal (serveur) ne les rejoue pas.
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
    const runs = getAlertRuns(state.activeType, state.startTime);
    if (runs.length === 0) {
        scheduleAlerts(state.activeType, state.startTime);
        return;
    }

    const now = Date.now();

    // Vagues dépassées de plus que la tolérance et jamais jouées (les plus récentes sont
    // laissées à scheduleAlerts, qui les affiche tout de suite comme rappels normaux).
    const overdue = [];
    for (const run of runs) {
        const waves = run.plan.filter(w =>
            now - w.fireAt > ALERT_LATE_TOLERANCE_MS && !isWavePlayed(run.config.id, run.runStart, w.index));
        if (waves.length > 0) overdue.push({ run, waves });
    }

    if (overdue.length > 0) {
        const items = overdue.map(({ run, waves }) => ({
            name: getAlertName(run.config),
            mins: Math.floor((now - run.runStart) / 60000),
            n: waves[waves.length - 1].index + 1,
            total: run.config.maxCount
        }));
        const { title, body } = buildCatchupText(items);

        try {
            const registration = await navigator.serviceWorker.ready;
            const worker = navigator.serviceWorker.controller || registration.active;
            if (worker) {
                worker.postMessage({ type: 'DISPLAY_NOW', title, body, tag: 'pacing-catchup' });
                console.log(`[visibilitychange] 🔔 Rattrapage : ${overdue.length} alerte(s) en retard`);
                overdue.forEach(({ run, waves }) =>
                    waves.forEach(w => markWavePlayed(run.config.id, run.runStart, w.index, 'catchup')));
                saveState();

                if (!runs.some(run => run.plan.some(w => w.fireAt > now))) releaseWakeLock();
            }
        } catch (e) {
            console.error('[visibilitychange] ❌ Erreur rattrapage :', e);
        }
    } else {
        console.log(`[visibilitychange] ✅ Retour visible — aucune vague en retard`);
    }

    // Reprogrammer les vagues futures (le registre « déjà jouée » est conservé)
    scheduleAlerts(state.activeType, state.startTime);

    console.log(`[visibilitychange] ✅ Alertes futures reprogrammées`);
    console.log(`[visibilitychange] ⏱️ Fin séquence retour visible`);
}
