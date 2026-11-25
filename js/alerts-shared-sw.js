// ============================================================
// ALERTES — CODE PARTAGÉ ENTRE LA PAGE (index.html) ET LE SERVICE WORKER (sw.js)
//
// Ce fichier est chargé à deux endroits :
//   - par la page, via <script src> dans index.html ;
//   - par le service worker, via importScripts() dans sw.js (à partir de la beta.10).
//
// RÈGLE : n'y mettre que des fonctions pures et l'accès à IndexedDB. Aucune référence à
// window, document, localStorage, settings, state, t()… : ils n'existent pas dans un service
// worker, et une seule référence de ce genre ferait échouer le chargement du service worker
// (le push afficherait alors la notification générique du navigateur). Les textes sont donc
// déjà traduits dans le plan, et les constantes passent par ce fichier.
//
// Contenu : constantes de tolérance, stockage IndexedDB (clé → valeur), registre « déjà jouée »
// partagé, et règle commune « quelles vagues afficher, et comment » (alertsSelectDue,
// alertsBuildCatchup), utilisée telle quelle par la page (playDueWaves) et par le service worker.
// Depuis la beta.12 : aussi l'envoi des horaires au serveur d'alertes (alertsPushSync) et son état
// (clé 'push' : identifiant d'appareil, numéro de séquence, adresse d'abonnement, horaires confirmés),
// car la page ET le service worker (qui remet le serveur à jour après un push) écrivent au serveur.
// Le plan lui-même est construit par la page (buildServerPlan, js/alerts.js).
// ============================================================

// Tolérance de retard : une vague seule d'une alerte, en retard d'au plus cette durée, est affichée
// comme un rappel normal ; au-delà (ou si plusieurs vagues sont dues), elle est regroupée dans un
// rattrapage. 60 s = intervalle minimum entre deux rappels, donc une alerte n'a jamais deux vagues
// « dans la tolérance ». Le retard réel est journalisé pour calibrer cette valeur.
const ALERT_LATE_TOLERANCE_MS = 60000;
// Avance acceptée : une minuterie qui se déclenche quelques instants avant l'heure exacte
// (écart d'horloge) joue quand même sa vague.
const ALERT_EARLY_MARGIN_MS = 1000;

// ------------------------------------------------------------
// Stockage IndexedDB (clé → valeur)
// ------------------------------------------------------------

const ALERTS_STORE_DB = 'pacingcount-alerts';
const ALERTS_STORE_NAME = 'kv';
let alertsStoreDbPromise = null;

function alertsStoreOpen() {
    if (alertsStoreDbPromise) return alertsStoreDbPromise;
    alertsStoreDbPromise = new Promise((resolve, reject) => {
        const idb = globalThis.indexedDB;
        if (!idb) { reject(new Error('IndexedDB indisponible')); return; }
        const req = idb.open(ALERTS_STORE_DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(ALERTS_STORE_NAME);
        req.onsuccess = () => {
            const db = req.result;
            // Autre onglet / mise à jour de schéma : on libère la connexion, elle sera rouverte au besoin
            db.onversionchange = () => { db.close(); alertsStoreDbPromise = null; };
            resolve(db);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB bloquée'));
    });
    alertsStoreDbPromise.catch(() => { alertsStoreDbPromise = null; }); // nouvel essai au prochain appel
    return alertsStoreDbPromise;
}

// Exécute une opération sur le magasin et attend la fin de la transaction (données écrites).
async function alertsStoreRun(mode, operation) {
    const db = await alertsStoreOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ALERTS_STORE_NAME, mode);
        const request = operation(tx.objectStore(ALERTS_STORE_NAME));
        tx.oncomplete = () => resolve(request ? request.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('transaction annulée'));
    });
}

function alertsStoreGet(key) { return alertsStoreRun('readonly', store => store.get(key)); }
function alertsStoreSet(key, value) { return alertsStoreRun('readwrite', store => store.put(value, key)); }
function alertsStoreDelete(key) { return alertsStoreRun('readwrite', store => store.delete(key)); }

// Lecture puis écriture dans UNE SEULE transaction : deux écrivains (page et service worker)
// ne peuvent pas s'écraser mutuellement. update(ancienneValeur) retourne la nouvelle valeur.
function alertsStoreUpdate(key, update) {
    return alertsStoreRun('readwrite', store => {
        const read = store.get(key);
        read.onsuccess = () => store.put(update(read.result), key);
        return null;
    });
}

// ------------------------------------------------------------
// Registre « déjà jouée » partagé (clé 'played' : liste d'entrées)
// Entrée : { alertId, runStart, waveIndex, firedAt, source }. Une vague jouée n'est jamais « dé-jouée »
// (sauf nettoyage de fin de séquence) : la fusion des copies de la page et du service worker est une
// simple union, sans conflit possible.
// ------------------------------------------------------------

function alertsWaveKey(alertId, runStart, waveIndex) {
    return `${alertId}|${runStart}|${waveIndex}`;
}

// Union de deux listes d'entrées (la première occurrence d'une vague est conservée).
function alertsMergePlayed(a, b) {
    const seen = new Set();
    const merged = [];
    for (const entry of [...(a || []), ...(b || [])]) {
        const key = alertsWaveKey(entry.alertId, entry.runStart, entry.waveIndex);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(entry);
    }
    return merged;
}

async function alertsPlayedRead() {
    return (await alertsStoreGet('played')) || [];
}

// Ajoute des entrées au registre stocké.
function alertsPlayedAdd(entries) {
    return alertsStoreUpdate('played', stored => alertsMergePlayed(stored, entries));
}

// Applique un filtre au registre stocké (nettoyage de fin de séquence, vague remise en attente…).
function alertsPlayedFilter(keep) {
    return alertsStoreUpdate('played', stored => (stored || []).filter(keep));
}

// ------------------------------------------------------------
// Règle commune : quelles vagues afficher, et comment
// ------------------------------------------------------------

// Choisit ce qu'il faut afficher maintenant.
//   waves  : plan.waves (voir buildServerPlan : alertId, alertOrder, name, runStart, index, total, fireAt, title, body, tag)
//   played : registre « déjà jouée »
// Pour chaque alerte, les vagues dues (heure atteinte) et pas encore jouées :
//   - une seule, en retard d'au plus ALERT_LATE_TOLERANCE_MS → rappel normal ;
//   - sinon → rattrapage (un seul pour toutes les alertes, voir alertsBuildCatchup).
// Retourne { reminders: [vague], catchups: [{ alertId, name, runStart, total, waves: [vague] }] },
// dans l'ordre des alertes des réglages (alertOrder).
function alertsSelectDue(waves, played, now) {
    const playedKeys = new Set(played.map(p => alertsWaveKey(p.alertId, p.runStart, p.waveIndex)));
    const groups = new Map();
    for (const wave of waves) {
        if (wave.fireAt > now + ALERT_EARLY_MARGIN_MS) continue;
        if (playedKeys.has(alertsWaveKey(wave.alertId, wave.runStart, wave.index))) continue;
        const groupKey = `${wave.alertId}|${wave.runStart}`;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(wave);
    }

    const reminders = [];
    const catchups = [];
    [...groups.values()]
        .sort((a, b) => a[0].alertOrder - b[0].alertOrder)
        .forEach(due => {
            due.sort((a, b) => a.index - b.index);
            const last = due[due.length - 1];
            if (due.length === 1 && now - due[0].fireAt <= ALERT_LATE_TOLERANCE_MS) {
                reminders.push(due[0]);
            } else {
                catchups.push({ alertId: last.alertId, name: last.name, runStart: last.runStart, total: last.total, waves: due });
            }
        });
    return { reminders, catchups };
}

function alertsFillTemplate(template, vars) {
    let text = template;
    Object.keys(vars).forEach(k => { text = text.replaceAll(`{${k}}`, vars[k]); });
    return text;
}

// Texte du rattrapage commun à toutes les alertes en retard (modèles : plan.texts).
// Une alerte : « Rattrapage : {nom} » / « 53 min (rappel 2/3) ».
// Plusieurs : « Rattrapage : N alertes » / une ligne par alerte, la séquence la plus longue
// d'abord (à durée égale, ordre des alertes dans les réglages : le tri est stable).
// Le rang (n) est celui de la dernière vague due ; la durée est celle écoulée depuis le début de la séquence.
function alertsBuildCatchup(catchups, texts, now) {
    const items = catchups.map(c => ({
        name: c.name,
        mins: Math.floor((now - c.runStart) / 60000),
        n: c.waves[c.waves.length - 1].index + 1,
        total: c.total
    })).sort((a, b) => b.mins - a.mins);
    if (items.length === 1) {
        return {
            title: alertsFillTemplate(texts.catchupTitle1, { name: items[0].name }),
            body: alertsFillTemplate(texts.notifBody, items[0])
        };
    }
    return {
        title: alertsFillTemplate(texts.catchupTitleN, { n: items.length }),
        body: items.map(it => alertsFillTemplate(texts.catchupLine, it)).join('\n')
    };
}

// ------------------------------------------------------------
// Serveur d'alertes (Worker Cloudflare) : envoi des horaires, partagé page / service worker
// ------------------------------------------------------------

const PUSH_WORKER_URL = 'https://pacingcount-push.pacingcount.workers.dev';
// Clé publique VAPID (publique par nature). La clé privée n'est que dans les secrets Cloudflare.
const PUSH_VAPID_PUBLIC_KEY = 'BLElc13cOdK7B3ophZ0svDndalSZ-sx8NTx1Nmahbjw0Vl7KWYgFUlHg7zrPJwYFol3BelWymrKEbIyqy-PFHns';
// Le Worker refuse un horaire au-delà de 24 h : on s'arrête un peu avant. Les vagues plus lointaines
// sont envoyées plus tard (à l'ouverture de l'app, ou par le service worker après un push). 50 horaires au plus.
const PUSH_MAX_AHEAD_MS = 23 * 3600 * 1000 + 50 * 60 * 1000;
const PUSH_MAX_TIMES = 50;
const PUSH_FETCH_TIMEOUT_MS = 10 * 1000;

function pushUrlBase64ToBytes(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// Horaires à confirmer au serveur : heures (ms, sans doublon, triées) des vagues du plan futures et pas
// encore jouées, dans la fenêtre acceptée par le Worker. isPlayed(alertId, runStart, waveIndex) → booléen.
function alertsPushDesiredTimes(waves, isPlayed, now) {
    const times = new Set();
    for (const w of waves) {
        if (isPlayed(w.alertId, w.runStart, w.index)) continue;
        if (w.fireAt > now + 1000 && w.fireAt <= now + PUSH_MAX_AHEAD_MS) times.add(w.fireAt);
    }
    return [...times].sort((a, b) => a - b).slice(0, PUSH_MAX_TIMES);
}

function alertsPushSameTimes(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

// État de la synchronisation, clé 'push' d'IndexedDB — SEULE copie, lue et écrite par la page et le service
// worker (le numéro de séquence est incrémenté dans une transaction : pas de doublon possible) :
//   deviceId : identifiant aléatoire de l'appareil (créé par la page ; copié ici car le service worker
//              ne lit pas localStorage) ;
//   seq      : dernier numéro de séquence utilisé pour un envoi ;
//   endpoint : adresse d'abonnement push connue du serveur (détecte un abonnement renouvelé) ;
//   times    : horaires confirmés par le serveur (null = jamais synchronisé ; [] = tout annulé).
function alertsPushStateNormalize(s) {
    return Object.assign({ deviceId: null, seq: 0, endpoint: null, times: null }, s);
}

async function alertsPushStateGet() {
    return alertsPushStateNormalize(await alertsStoreGet('push'));
}

function alertsPushStateUpdate(change) {
    return alertsStoreUpdate('push', s => Object.assign(alertsPushStateNormalize(s), change(alertsPushStateNormalize(s))));
}

// Envoie une requête au Worker. Retourne { status, json } ; lève une erreur (code 'network') si le serveur
// est injoignable. Les réponses HTTP d'erreur sont rendues à l'appelant (alertsPushSync).
async function alertsPushPost(path, body) {
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
        throw Object.assign(new Error('network'), { code: 'network', detail: e.name });
    } finally {
        clearTimeout(timer);
    }
    let json = {};
    try { json = await res.json(); } catch (e) { /* corps absent ou non JSON */ }
    return { status: res.status, ok: res.ok, json };
}

// Remplace les horaires du serveur par `times` (liste vide : annulation) et enregistre le résultat dans l'état
// partagé. `sub` : abonnement push (PushSubscription ou son toJSON()), nécessaire seulement s'il y a des horaires.
// Chaque envoi prend un nouveau numéro de séquence. Réponse « périmé » (409) : le serveur a déjà un numéro plus
// grand (envoi plus récent de l'autre source, ou compteur local perdu) : on se recale dessus et on réessaie une fois.
async function alertsPushSync(sub, times) {
    const subJson = sub ? (typeof sub.toJSON === 'function' ? sub.toJSON() : sub) : null;
    for (let attempt = 0; attempt < 2; attempt++) {
        let cur;
        await alertsPushStateUpdate(s => { cur = { ...s, seq: s.seq + 1 }; return { seq: cur.seq }; });
        if (!cur.deviceId) throw Object.assign(new Error('deviceId'), { code: 'device' });
        let path = '/cancel';
        let body = { deviceId: cur.deviceId, seq: cur.seq };
        if (times.length > 0) {
            const subscription = { endpoint: subJson.endpoint };
            if (subJson.keys && subJson.keys.p256dh && subJson.keys.auth) subscription.keys = { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth };
            path = '/schedule';
            body = { deviceId: cur.deviceId, seq: cur.seq, subscription, clientNow: Date.now(), fireAt: times };
        }
        const res = await alertsPushPost(path, body);
        if (res.status === 409 && Number.isSafeInteger(res.json.seq) && attempt === 0) {
            await alertsPushStateUpdate(s => ({ seq: Math.max(s.seq, res.json.seq) }));
            continue;
        }
        if (!res.ok) throw Object.assign(new Error('http'), { code: 'http', detail: res.status });
        await alertsPushStateUpdate(s => ({ times, endpoint: subJson ? subJson.endpoint : s.endpoint }));
        return;
    }
    throw Object.assign(new Error('http'), { code: 'http', detail: 409 });
}
