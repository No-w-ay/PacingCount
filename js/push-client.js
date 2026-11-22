// js/push-client.js — alertes serveur (POC) : abonnement Web Push + envoi des horaires au Worker.
// Script classique (pas de module). Pour l'instant : mode développeur uniquement (boutons test-push*).
// Serveur : dossier cf-worker/. Le push est envoyé VIDE : le texte affiché vit dans sw.js.

const PUSH_WORKER_URL = 'https://pacingcount-push.pacingcount.workers.dev';
// Clé publique VAPID (publique par nature). La clé privée n'est que dans les secrets Cloudflare.
const PUSH_VAPID_PUBLIC_KEY = 'BLElc13cOdK7B3ophZ0svDndalSZ-sx8NTx1Nmahbjw0Vl7KWYgFUlHg7zrPJwYFol3BelWymrKEbIyqy-PFHns';
// Clé locale séparée : jamais incluse dans l'export des données (l'identifiant sert d'accès côté serveur).
const PUSH_DEVICE_ID_KEY = 'pushDeviceId';
const PUSH_TEST_DELAY_MS = 30 * 1000;
const PUSH_FETCH_TIMEOUT_MS = 10 * 1000;
const PUSH_SW_TIMEOUT_MS = 8 * 1000;

let pushBusy = false; // évite les doubles clics pendant une requête

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

// ---------- Boutons de test (mode développeur) ----------

function pushSetStatus(key, vars) {
    const el = document.getElementById('push-test-status');
    if (el) el.textContent = t(key, vars);
}

function pushShowError(e) {
    console.error('[push]', e);
    if (e instanceof PushError && e.code === 'unsupported') return pushSetStatus('pushStatusUnsupported');
    if (e instanceof PushError && e.code === 'denied') return pushSetStatus('pushStatusDenied');
    const detail = e instanceof PushError ? (e.detail ? `${e.code} ${e.detail}` : e.code) : (e && e.name) || 'error';
    pushSetStatus('pushStatusError', { detail });
}

async function pushTestSchedule() {
    if (pushBusy) return;
    pushBusy = true;
    try {
        // requestPermission est appelé en premier, de façon synchrone dans le geste (voir plus haut).
        const subPromise = pushEnsureSubscription();
        pushSetStatus('pushStatusWorking');
        const sub = await subPromise;
        await pushSchedule(sub, [Date.now() + PUSH_TEST_DELAY_MS]);
        pushSetStatus('pushStatusScheduled', { sec: PUSH_TEST_DELAY_MS / 1000 });
    } catch (e) {
        pushShowError(e);
    } finally {
        pushBusy = false;
    }
}

async function pushTestCancel() {
    if (pushBusy) return;
    pushBusy = true;
    try {
        pushSetStatus('pushStatusWorking');
        await pushCancel();
        pushSetStatus('pushStatusCancelled');
    } catch (e) {
        pushShowError(e);
    } finally {
        pushBusy = false;
    }
}
