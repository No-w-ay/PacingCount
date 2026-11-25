// js/alerts-server.js — Alertes de périodes, modes SERVEUR et MIXTE : abonnement Web Push et
// synchronisation des horaires d'alerte avec le Worker Cloudflare. Script classique (pas de module).
// Partie commune (choix du mode, interface) : js/alerts.js ; mode local : js/alerts-local.js.
// Serveur : dossier cf-worker/. Le push est envoyé VIDE : à sa réception, sw.js joue les vagues dues d'après
// le plan stocké dans IndexedDB (textes déjà traduits par la page).
// Le serveur ne reçoit que des horaires (ms) et l'adresse d'abonnement push : jamais de noms ni de données de santé.
// L'envoi lui-même (alertsPushSync), l'état de synchronisation (identifiant d'appareil, numéro de séquence,
// adresse d'abonnement, horaires confirmés : clé 'push' d'IndexedDB) et les constantes du serveur sont dans
// js/alerts-shared-sw.js, partagés avec le service worker qui remet le serveur à jour après un push.

// Clé locale séparée : jamais incluse dans l'export des données (l'identifiant sert d'accès côté serveur).
const PUSH_DEVICE_ID_KEY = 'pushDeviceId';
const PUSH_RETRY_MS = 2 * 60 * 1000; // nouvel essai automatique tant que la synchronisation est en attente
const PUSH_SW_TIMEOUT_MS = 8 * 1000;

let pushBusy = false; // évite les doubles clics pendant la demande d'autorisation / d'abonnement

class PushError extends Error {
    constructor(code, detail) {
        super(code);
        this.code = code;     // 'unsupported' | 'denied' | 'sw' | 'http' | 'network'
        this.detail = detail;
    }
}

function pushIsSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Identifiant aléatoire de l'appareil (16 octets = 22 caractères), créé une fois puis conservé.
function pushGetDeviceId() {
    let id = null;
    try { id = localStorage.getItem(PUSH_DEVICE_ID_KEY); } catch (e) { /* stockage indisponible */ }
    if (id && /^[A-Za-z0-9_-]{22,64}$/.test(id)) return id;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try { localStorage.setItem(PUSH_DEVICE_ID_KEY, id); } catch (e) { /* sera régénéré au prochain appel */ }
    return id;
}

function pushSameKey(existing, wanted) {
    if (!existing) return false;
    const a = new Uint8Array(existing);
    return a.length === wanted.length && a.every((v, i) => v === wanted[i]);
}

// Doit être appelée directement depuis un geste de l'utilisateur (clic) : sur iOS, la demande
// d'autorisation est refusée silencieusement autrement. Aucun « await » avant requestPermission.
async function pushEnsureSubscription() {
    if (!pushIsSupported()) throw new PushError('unsupported');
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new PushError('denied');

    const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new PushError('sw')), PUSH_SW_TIMEOUT_MS))
    ]);
    const wanted = pushUrlBase64ToBytes(PUSH_VAPID_PUBLIC_KEY);
    let sub = await reg.pushManager.getSubscription();
    // Abonnement créé avec une autre clé VAPID : il serait refusé par le serveur, on le refait.
    if (sub && !pushSameKey(sub.options.applicationServerKey, wanted)) {
        await sub.unsubscribe();
        sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
    return sub;
}

// Texte d'erreur (traduit) pour l'utilisateur.
function pushErrorText(e) {
    if (e instanceof PushError && e.code === 'unsupported') return t('pushStatusUnsupported');
    if (e instanceof PushError && e.code === 'denied') return t('pushStatusDenied');
    const detail = e instanceof PushError ? (e.detail ? `${e.code} ${e.detail}` : e.code) : (e && e.name) || 'error';
    return t('pushStatusError', { detail });
}

// ---------- Synchronisation des horaires avec le serveur ----------

// État de la synchronisation : 'unknown' (pas encore tentée) | 'ok' (serveur à jour) | 'pending' (à refaire :
// hors ligne, serveur injoignable) | 'unavailable' (push impossible ici : non pris en charge ou refusé) |
// 'idle' (mode hors ligne, rien à faire).
let pushSyncStatus = 'unknown';
let pushSyncRunning = false;
let pushSyncAgain = false;
let pushRetryTimer = null;

// Horaires à confirmer au serveur : vagues futures pas encore jouées de la période en cours (voir
// alertsPushDesiredTimes). Liste vide en mode hors ligne ou sans période active.
function pushGetDesiredTimes() {
    if (getAlertMode() === 'local') return [];
    if (state.activeType === null || state.startTime === null) return [];
    return alertsPushDesiredTimes(buildServerPlan(state.activeType, state.startTime).waves, isWavePlayed, Date.now());
}

// Change l'état, met à jour l'interface et le minuteur de nouvel essai ; en mode mixte, le Wake Lock dépend
// de cet état : scheduleAlerts() est rappelée pour qu'elle le retienne ou le relâche.
function pushSetSyncStatus(status) {
    const changed = status !== pushSyncStatus;
    pushSyncStatus = status;
    clearTimeout(pushRetryTimer);
    pushRetryTimer = null;
    if (status === 'pending') pushRetryTimer = setTimeout(syncServerPlan, PUSH_RETRY_MS);
    if (!changed) return;
    console.log(`[push] Synchronisation serveur : ${status}`);
    renderAlertModeUI();
    if (getAlertMode() === 'mixed' && state.activeType !== null && state.startTime !== null) {
        scheduleAlerts(state.activeType, state.startTime);
    }
}

// Une passe : compare les horaires voulus à ceux déjà confirmés (et l'adresse d'abonnement à celle connue du
// serveur) et n'écrit au serveur qu'en cas de différence. L'état confirmé est dans IndexedDB, partagé avec le
// service worker. Jamais de contact avec le serveur tant que l'utilisateur n'a pas choisi le mode serveur ou mixte.
async function pushSyncOnce() {
    const mode = getAlertMode();
    const settled = mode === 'local' ? 'idle' : 'ok';
    if (mode !== 'local' && (!pushIsSupported() || Notification.permission !== 'granted')) {
        pushSetSyncStatus('unavailable');
        return;
    }
    try {
        const desired = pushGetDesiredTimes();
        let saved;
        try {
            saved = await alertsPushStateGet();
        } catch (e) {
            // IndexedDB illisible : en mode hors ligne rien n'a jamais été envoyé au serveur, rien à faire (et rien
            // à réessayer) ; en mode serveur / mixte, la synchronisation est impossible pour l'instant.
            if (mode === 'local') { pushSetSyncStatus('idle'); return; }
            throw e;
        }
        // Le service worker ne lit pas localStorage : l'identifiant d'appareil est copié dans IndexedDB
        const deviceId = pushGetDeviceId();
        if (saved.deviceId !== deviceId) await alertsPushStateUpdate(() => ({ deviceId }));
        try { localStorage.removeItem('pushSyncedTimes'); } catch (e) { /* ancienne clé des beta.10-11, remplacée par l'état IndexedDB */ }
        if (saved.times === null && desired.length === 0) { // jamais synchronisé et rien à envoyer : rien à annuler non plus
            await alertsPushStateUpdate(() => ({ times: [] }));
            pushSetSyncStatus(settled);
            return;
        }
        const sub = mode === 'local' ? null : await pushEnsureSubscription();
        // Horaires déjà passés : joués par le serveur, on ne les compare pas. Adresse renouvelée par le
        // navigateur : le serveur garde l'ancienne, il faut la lui renvoyer même si les horaires n'ont pas changé.
        const syncedFuture = saved.times === null ? null : saved.times.filter(x => x > Date.now() + 1000);
        const endpointChanged = sub !== null && saved.endpoint !== null && saved.endpoint !== sub.endpoint;
        if (syncedFuture !== null && alertsPushSameTimes(syncedFuture, desired) && !endpointChanged) {
            pushSetSyncStatus(settled);
            return;
        }
        if (navigator.onLine === false) { pushSetSyncStatus('pending'); return; }
        await alertsPushSync(sub, desired);
        pushSetSyncStatus(settled);
    } catch (e) {
        console.warn('[push] Synchronisation impossible :', e);
        const blocked = e instanceof PushError && (e.code === 'unsupported' || e.code === 'denied');
        pushSetSyncStatus(blocked ? 'unavailable' : 'pending');
    }
}

// Point d'entrée : appelée quand le plan change, au changement de mode, au démarrage, au retour au premier
// plan et au retour du réseau. Les appels simultanés sont mis en file : une seule passe à la fois, refaite
// si un nouvel appel est arrivé pendant ce temps.
async function syncServerPlan() {
    if (pushSyncRunning) { pushSyncAgain = true; return; }
    pushSyncRunning = true;
    try {
        do {
            pushSyncAgain = false;
            await pushSyncOnce();
        } while (pushSyncAgain);
    } catch (e) {
        console.error('[push] syncServerPlan :', e);
    } finally {
        pushSyncRunning = false;
    }
}

window.addEventListener('online', syncServerPlan);
