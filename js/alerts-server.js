// js/alerts-server.js — Alertes de périodes, modes SERVEUR et MIXTE : abonnement Web Push et
// synchronisation des horaires d'alerte avec le Worker Cloudflare. Script classique (pas de module).
// Partie commune (choix du mode, interface) : js/alerts.js ; mode local : js/alerts-local.js.
// Serveur : dossier cf-worker/. Le push est envoyé VIDE : à sa réception, sw.js joue les vagues dues d'après
// le plan stocké dans IndexedDB (textes déjà traduits par la page).
// Le serveur ne reçoit que des horaires (ms) et l'adresse d'abonnement push : jamais de noms ni de données de santé.

const PUSH_WORKER_URL = 'https://pacingcount-push.pacingcount.workers.dev';
// Clé publique VAPID (publique par nature). La clé privée n'est que dans les secrets Cloudflare.
const PUSH_VAPID_PUBLIC_KEY = 'BLElc13cOdK7B3ophZ0svDndalSZ-sx8NTx1Nmahbjw0Vl7KWYgFUlHg7zrPJwYFol3BelWymrKEbIyqy-PFHns';
// Clé locale séparée : jamais incluse dans l'export des données (l'identifiant sert d'accès côté serveur).
const PUSH_DEVICE_ID_KEY = 'pushDeviceId';
// Horaires déjà confirmés par le serveur (liste de ms ; [] = tout annulé ; absent = jamais synchronisé).
// Clé locale, jamais incluse dans l'export des données.
const PUSH_SYNCED_KEY = 'pushSyncedTimes';
// Le Worker refuse un horaire au-delà de 24 h : on s'arrête un peu avant. Les vagues plus lointaines
// sont envoyées à la prochaine ouverture de l'app. Il accepte au plus 50 horaires.
const PUSH_MAX_AHEAD_MS = 23 * 3600 * 1000 + 50 * 60 * 1000;
const PUSH_MAX_TIMES = 50;
const PUSH_RETRY_MS = 2 * 60 * 1000; // nouvel essai automatique tant que la synchronisation est en attente
const PUSH_FETCH_TIMEOUT_MS = 10 * 1000;
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

function pushUrlBase64ToBytes(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
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

async function pushPost(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PUSH_FETCH_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(PUSH_WORKER_URL + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'omit',
            cache: 'no-store',
            signal: controller.signal
        });
    } catch (e) {
        throw new PushError('network', e.name);
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) throw new PushError('http', res.status);
    return res;
}

// Envoie au serveur la liste des horaires absolus (ms) pour cet appareil. Remplace les précédents.
async function pushSchedule(sub, fireAt) {
    const { endpoint, keys } = sub.toJSON();
    const subscription = { endpoint };
    if (keys && keys.p256dh && keys.auth) subscription.keys = { p256dh: keys.p256dh, auth: keys.auth };
    await pushPost('/schedule', { deviceId: pushGetDeviceId(), subscription, clientNow: Date.now(), fireAt });
}

async function pushCancel() {
    await pushPost('/cancel', { deviceId: pushGetDeviceId() });
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

function pushLoadSynced() {
    try {
        const list = JSON.parse(localStorage.getItem(PUSH_SYNCED_KEY));
        return Array.isArray(list) ? list.filter(Number.isFinite) : null;
    } catch (e) { return null; }
}

function pushSaveSynced(list) {
    try { localStorage.setItem(PUSH_SYNCED_KEY, JSON.stringify(list)); } catch (e) { /* stockage indisponible : on resynchronisera */ }
}

// Horaires à confirmer au serveur : vagues futures pas encore jouées de la période en cours (sans doublon,
// triés). Liste vide en mode hors ligne ou sans période active.
function pushGetDesiredTimes() {
    if (getAlertMode() === 'local') return [];
    if (state.activeType === null || state.startTime === null) return [];
    const now = Date.now();
    const times = new Set();
    buildServerPlan(state.activeType, state.startTime).waves.forEach(w => {
        if (isWavePlayed(w.alertId, w.runStart, w.index)) return;
        if (w.fireAt > now + 1000 && w.fireAt <= now + PUSH_MAX_AHEAD_MS) times.add(w.fireAt);
    });
    return [...times].sort((a, b) => a - b).slice(0, PUSH_MAX_TIMES);
}

function pushSameTimes(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
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

// Une passe : compare les horaires voulus à ceux déjà confirmés et n'écrit au serveur qu'en cas de différence.
// Jamais de contact avec le serveur tant que l'utilisateur n'a pas choisi le mode serveur ou mixte.
async function pushSyncOnce() {
    const mode = getAlertMode();
    const settled = mode === 'local' ? 'idle' : 'ok';
    if (mode !== 'local' && (!pushIsSupported() || Notification.permission !== 'granted')) {
        pushSetSyncStatus('unavailable');
        return;
    }
    const desired = pushGetDesiredTimes();
    const synced = pushLoadSynced();
    if (synced === null && desired.length === 0) { // jamais synchronisé et rien à envoyer : rien à annuler non plus
        pushSaveSynced([]);
        pushSetSyncStatus(settled);
        return;
    }
    // Les horaires déjà passés ont été joués par le serveur : on ne les compare pas
    const syncedFuture = synced === null ? null : synced.filter(x => x > Date.now() + 1000);
    if (syncedFuture !== null && pushSameTimes(syncedFuture, desired)) {
        pushSetSyncStatus(settled);
        return;
    }
    if (navigator.onLine === false) { pushSetSyncStatus('pending'); return; }
    try {
        if (desired.length === 0) {
            await pushCancel();
        } else {
            const sub = await pushEnsureSubscription();
            await pushSchedule(sub, desired);
        }
        pushSaveSynced(desired);
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
